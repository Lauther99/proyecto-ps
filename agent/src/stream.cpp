// Comando "stream": abre una sesión de Remote Play y guarda el video H.264 en un archivo.
// Prueba de la fase 1: si el archivo se ve con ffplay, el agente recibe video de la PS4.
#include "commands.hpp"
#include "env.hpp"

#include <chiaki/base64.h>
#include <chiaki/log.h>
#include <chiaki/session.h>

#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <thread>

namespace agent
{
    namespace
    {
        // Estado compartido entre los hilos de chiaki y el hilo principal.
        struct StreamState
        {
            std::FILE* file = nullptr;
            std::atomic<uint64_t> frames{0};
            std::atomic<uint64_t> bytes{0};
            std::atomic<int64_t> frames_lost{0};
            std::atomic<bool> connected{false};
            std::atomic<bool> quit{false};
        };

        // Convierte "a1b2..." en bytes. Devuelve false si el texto no tiene el largo esperado.
        bool from_hex(const std::string& hex, uint8_t* out, size_t size)
        {
            if (hex.size() != size * 2)
                return false;
            for (size_t i = 0; i < size; ++i)
            {
                unsigned value = 0;
                if (std::sscanf(hex.c_str() + i * 2, "%2x", &value) != 1)
                    return false;
                out[i] = static_cast<uint8_t>(value);
            }
            return true;
        }

        // Llamada por chiaki por cada fotograma de video completo (H.264 en formato Annex B).
        bool on_video_sample(uint8_t* buf, size_t buf_size, int32_t frames_lost, bool /*frame_recovered*/, void* user)
        {
            auto* state = static_cast<StreamState*>(user);
            std::fwrite(buf, 1, buf_size, state->file);
            state->frames++;
            state->bytes += buf_size;
            state->frames_lost += frames_lost;
            return true;
        }

        // Llamada por chiaki ante eventos de la sesión (conectado, cierre, etc.).
        void on_event(ChiakiEvent* event, void* user)
        {
            auto* state = static_cast<StreamState*>(user);
            switch (event->type)
            {
            case CHIAKI_EVENT_CONNECTED:
                std::printf("Conectado. Recibiendo video...\n");
                state->connected = true;
                break;
            case CHIAKI_EVENT_LOGIN_PIN_REQUEST:
                std::printf("La PS4 pide un PIN de inicio de sesion (no soportado todavia).\n");
                break;
            case CHIAKI_EVENT_QUIT:
                std::printf("Sesion terminada: %s%s%s\n",
                    chiaki_quit_reason_string(event->quit.reason),
                    event->quit.reason_str ? " - " : "",
                    event->quit.reason_str ? event->quit.reason_str : "");
                state->quit = true;
                break;
            default:
                break;
            }
        }
    }

    int cmd_stream(const std::string& output_path, int seconds)
    {
        // 1. Leer las claves de registration.env.
        const EnvMap reg = load_env_file("registration.env");
        const std::string host = env_get(reg, "PS4_HOST");
        if (host.empty())
        {
            std::printf("No se encontro registration.env. Ejecuta primero: ps4-agent register <codigo>\n");
            return 1;
        }

        ChiakiConnectInfo info{};
        if (!from_hex(env_get(reg, "RP_REGIST_KEY"), reinterpret_cast<uint8_t*>(info.regist_key), sizeof(info.regist_key))
            || !from_hex(env_get(reg, "RP_KEY"), info.morning, sizeof(info.morning)))
        {
            std::printf("registration.env tiene claves invalidas. Vuelve a registrar.\n");
            return 1;
        }

        // El AccountID viene del .env normal.
        const EnvMap env = load_env();
        const std::string account_b64 = env_get(env, "PSN_ACCOUNT_ID");
        size_t account_size = sizeof(info.psn_account_id);
        if (chiaki_base64_decode(account_b64.c_str(), account_b64.size(), info.psn_account_id, &account_size) != CHIAKI_ERR_SUCCESS
            || account_size != CHIAKI_PSN_ACCOUNT_ID_SIZE)
        {
            std::printf("PSN_ACCOUNT_ID invalido en .env\n");
            return 1;
        }

        // 2. Configuración de la sesión: PS4, 720p a 60 fps (máximo de una PS4 normal), H.264.
        info.ps5 = false;
        info.host = host.c_str();
        chiaki_connect_video_profile_preset(&info.video_profile, CHIAKI_VIDEO_RESOLUTION_PRESET_720p, CHIAKI_VIDEO_FPS_PRESET_60);
        info.video_profile.codec = CHIAKI_CODEC_H264;
        info.video_profile_auto_downgrade = true;
        info.enable_keyboard = false;
        info.enable_dualsense = false;
        info.audio_video_disabled = CHIAKI_AUDIO_DISABLED; // fase 1: solo video
        info.auto_regist = false;
        info.holepunch_session = nullptr;
        info.rudp_sock = nullptr;
        info.packet_loss_max = 0.05;
        info.enable_idr_on_fec_failure = true;

        StreamState state;
        state.file = std::fopen(output_path.c_str(), "wb");
        if (!state.file)
        {
            std::printf("No se pudo crear %s\n", output_path.c_str());
            return 1;
        }

        ChiakiLog log;
        chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO, chiaki_log_cb_print, nullptr);

        // 3. Crear y arrancar la sesión.
        ChiakiSession session;
        ChiakiErrorCode err = chiaki_session_init(&session, &info, &log);
        if (err != CHIAKI_ERR_SUCCESS)
        {
            std::printf("chiaki_session_init fallo: %s\n", chiaki_error_string(err));
            std::fclose(state.file);
            return 1;
        }
        chiaki_session_set_event_cb(&session, on_event, &state);
        chiaki_session_set_video_sample_cb(&session, on_video_sample, &state);

        std::printf("Conectando con %s (%d s de captura)...\n", host.c_str(), seconds);
        err = chiaki_session_start(&session);
        if (err != CHIAKI_ERR_SUCCESS)
        {
            std::printf("chiaki_session_start fallo: %s\n", chiaki_error_string(err));
            chiaki_session_fini(&session);
            std::fclose(state.file);
            return 1;
        }

        // 4. Esperar: hasta 15 s para conectar y luego 'seconds' de captura.
        const auto start = std::chrono::steady_clock::now();
        auto capture_start = start;
        bool was_connected = false;
        while (!state.quit)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
            const auto now = std::chrono::steady_clock::now();
            if (!was_connected && state.connected)
            {
                was_connected = true;
                capture_start = now;
            }
            if (!was_connected && now - start > std::chrono::seconds(15))
            {
                std::printf("No se pudo conectar en 15 s.\n");
                break;
            }
            if (was_connected && now - capture_start > std::chrono::seconds(seconds))
                break;
        }

        // 5. Cerrar la sesión y mostrar estadísticas.
        chiaki_session_stop(&session);
        chiaki_session_join(&session);
        chiaki_session_fini(&session);
        std::fclose(state.file);

        std::printf("\nFotogramas recibidos: %llu\n", static_cast<unsigned long long>(state.frames.load()));
        std::printf("Datos de video:       %.2f MB\n", state.bytes.load() / (1024.0 * 1024.0));
        std::printf("Fotogramas perdidos:  %lld\n", static_cast<long long>(state.frames_lost.load()));
        if (state.frames == 0)
            return 2;

        std::printf("\nVideo guardado en %s. Para verlo:\n  ffplay %s\n", output_path.c_str(), output_path.c_str());
        return 0;
    }
}
