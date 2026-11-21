#include "session_config.hpp"
#include "env.hpp"

#include <chiaki/base64.h>

#include <cstdio>

namespace agent
{
    namespace
    {
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
    }

    bool load_session_config(SessionConfig& config)
    {
        const EnvMap reg = load_env_file("registration.env");
        config.host = env_get(reg, "PS4_HOST");
        if (config.host.empty())
        {
            std::printf("No se encontro registration.env. Ejecuta primero: ps4-agent register <codigo>\n");
            return false;
        }

        ChiakiConnectInfo& info = config.info;
        info = ChiakiConnectInfo{};
        if (!from_hex(env_get(reg, "RP_REGIST_KEY"), reinterpret_cast<uint8_t*>(info.regist_key), sizeof(info.regist_key))
            || !from_hex(env_get(reg, "RP_KEY"), info.morning, sizeof(info.morning)))
        {
            std::printf("registration.env tiene claves invalidas. Vuelve a registrar.\n");
            return false;
        }

        // Credencial de encendido: la clave de registro en texto, leída como número hexadecimal
        // (igual que hace chiaki-ng). Si no es válida, simplemente no despertamos la consola.
        const std::string regist_text = env_get(reg, "RP_REGIST_KEY_TEXT");
        config.wakeup_credential = 0;
        if (!regist_text.empty() && regist_text.size() <= 8
            && regist_text.find_first_not_of("0123456789abcdefABCDEF") == std::string::npos)
            config.wakeup_credential = std::stoull(regist_text, nullptr, 16);

        const EnvMap env = load_env();
        const std::string account_b64 = env_get(env, "PSN_ACCOUNT_ID");
        size_t account_size = sizeof(info.psn_account_id);
        if (chiaki_base64_decode(account_b64.c_str(), account_b64.size(), info.psn_account_id, &account_size) != CHIAKI_ERR_SUCCESS
            || account_size != CHIAKI_PSN_ACCOUNT_ID_SIZE)
        {
            std::printf("PSN_ACCOUNT_ID invalido en .env\n");
            return false;
        }

        info.ps5 = false;
        info.host = config.host.c_str();
        chiaki_connect_video_profile_preset(&info.video_profile, CHIAKI_VIDEO_RESOLUTION_PRESET_720p, CHIAKI_VIDEO_FPS_PRESET_60);
        info.video_profile.codec = CHIAKI_CODEC_H264;
        info.video_profile_auto_downgrade = true;
        info.enable_keyboard = false;
        info.enable_dualsense = false;
        info.audio_video_disabled = CHIAKI_AUDIO_DISABLED; // fase 2A: solo video
        info.auto_regist = false;
        info.holepunch_session = nullptr;
        info.rudp_sock = nullptr;
        info.packet_loss_max = 0.05;
        info.enable_idr_on_fec_failure = true;
        return true;
    }
}
