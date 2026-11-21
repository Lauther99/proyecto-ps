// Comando "register": vincula el agente con la PS4 usando el código de 8 dígitos
// que muestra la consola (equivale a "Añadir dispositivo" en la app oficial).
#include "commands.hpp"

#include <chiaki/base64.h>
#include <chiaki/log.h>
#include <chiaki/regist.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <fstream>
#include <future>
#include <string>

namespace agent
{
    namespace
    {
        // Resultado que el hilo de chiaki entrega al hilo principal.
        struct RegistResult
        {
            ChiakiRegistEventType type = CHIAKI_REGIST_EVENT_TYPE_FINISHED_FAILED;
            ChiakiRegisteredHost host{};
        };

        std::string to_hex(const uint8_t* data, size_t size)
        {
            static const char digits[] = "0123456789abcdef";
            std::string out;
            out.reserve(size * 2);
            for (size_t i = 0; i < size; ++i)
            {
                out.push_back(digits[data[i] >> 4]);
                out.push_back(digits[data[i] & 0x0f]);
            }
            return out;
        }

        // chiaki llama a esta función desde su hilo cuando el registro termina.
        // 'registered_host' solo es válido durante la llamada, por eso lo copiamos.
        void on_regist_event(ChiakiRegistEvent* event, void* user)
        {
            auto* promise = static_cast<std::promise<RegistResult>*>(user);
            RegistResult result;
            result.type = event->type;
            if (event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS && event->registered_host)
                result.host = *event->registered_host;
            promise->set_value(result);
        }

        bool save_registration(const std::string& path, const std::string& ps4_host, const ChiakiRegisteredHost& host)
        {
            std::ofstream file(path, std::ios::trunc);
            if (!file)
                return false;

            // rp_regist_key es texto de hasta 16 caracteres relleno con '\0'.
            const std::string regist_key(host.rp_regist_key, strnlen(host.rp_regist_key, sizeof(host.rp_regist_key)));

            file << "# Claves de vinculacion con la PS4. SECRETO: no subir a git ni compartir.\n"
                 << "PS4_HOST=" << ps4_host << "\n"
                 << "TARGET=" << static_cast<int>(host.target) << "\n"
                 << "SERVER_NICKNAME=" << host.server_nickname << "\n"
                 << "SERVER_MAC=" << to_hex(host.server_mac, sizeof(host.server_mac)) << "\n"
                 << "RP_REGIST_KEY=" << to_hex(reinterpret_cast<const uint8_t*>(host.rp_regist_key), sizeof(host.rp_regist_key)) << "\n"
                 << "RP_REGIST_KEY_TEXT=" << regist_key << "\n"
                 << "RP_KEY_TYPE=" << host.rp_key_type << "\n"
                 << "RP_KEY=" << to_hex(host.rp_key, sizeof(host.rp_key)) << "\n"
                 << "CONSOLE_PIN=" << host.console_pin << "\n";
            return static_cast<bool>(file);
        }
    }

    int cmd_register(const std::string& ps4_host, const std::string& account_id_b64, const std::string& pin_text)
    {
        // 1. Validar el código: exactamente 8 dígitos.
        if (pin_text.size() != 8 || pin_text.find_first_not_of("0123456789") != std::string::npos)
        {
            std::printf("El codigo debe tener exactamente 8 digitos.\n");
            return 1;
        }

        // 2. Decodificar el AccountID (base64 -> 8 bytes).
        uint8_t account_id[CHIAKI_PSN_ACCOUNT_ID_SIZE] = {};
        size_t account_id_size = sizeof(account_id);
        if (chiaki_base64_decode(account_id_b64.c_str(), account_id_b64.size(), account_id, &account_id_size) != CHIAKI_ERR_SUCCESS
            || account_id_size != CHIAKI_PSN_ACCOUNT_ID_SIZE)
        {
            std::printf("PSN_ACCOUNT_ID invalido en .env (debe ser base64 de 8 bytes).\n");
            return 1;
        }

        // 3. Datos del registro. PS4 con firmware >= 8.0 usa el AccountID (no el nombre de usuario).
        ChiakiRegistInfo info{};
        info.target = CHIAKI_TARGET_PS4_10;
        info.host = ps4_host.c_str();
        info.broadcast = false;
        info.psn_online_id = nullptr;
        std::memcpy(info.psn_account_id, account_id, CHIAKI_PSN_ACCOUNT_ID_SIZE);
        info.pin = static_cast<uint32_t>(std::stoul(pin_text));
        info.console_pin = 0;
        info.holepunch_info = nullptr;
        info.rudp = nullptr;

        ChiakiLog log;
        chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO, chiaki_log_cb_print, nullptr);

        // 4. Iniciar el registro (corre en un hilo de chiaki) y esperar el resultado.
        std::promise<RegistResult> promise;
        std::future<RegistResult> future = promise.get_future();

        ChiakiRegist regist;
        std::printf("Registrando con la PS4 en %s...\n", ps4_host.c_str());
        if (chiaki_regist_start(&regist, &log, &info, on_regist_event, &promise) != CHIAKI_ERR_SUCCESS)
        {
            std::printf("No se pudo iniciar el registro.\n");
            return 1;
        }

        if (future.wait_for(std::chrono::seconds(30)) != std::future_status::ready)
        {
            std::printf("La PS4 no respondio en 30 s. Cancelando.\n");
            chiaki_regist_stop(&regist);
            future.wait(); // el callback llega con FINISHED_CANCELED
            chiaki_regist_fini(&regist);
            return 2;
        }

        const RegistResult result = future.get();
        chiaki_regist_fini(&regist);

        if (result.type != CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS)
        {
            std::printf("\nEl registro fallo. Causas comunes: codigo vencido o mal escrito,\n"
                        "AccountID de otra cuenta, o la pantalla 'Anadir dispositivo' ya cerrada.\n");
            return 2;
        }

        // 5. Guardar las claves.
        const std::string path = "registration.env";
        if (!save_registration(path, ps4_host, result.host))
        {
            std::printf("Registro correcto, pero no se pudo guardar %s\n", path.c_str());
            return 1;
        }

        std::printf("\nRegistro correcto con '%s'. Claves guardadas en %s\n", result.host.server_nickname, path.c_str());
        return 0;
    }
}
