// Configuración común de la sesión de Remote Play (la usan "stream" y "serve").
#pragma once

#include <chiaki/session.h>

#include <string>

namespace agent
{
    struct SessionConfig
    {
        std::string host;        // dueño del texto al que apunta info.host
        ChiakiConnectInfo info{};
        uint64_t wakeup_credential = 0; // para despertar la PS4 del reposo (0 = no disponible)
    };

    // Lee registration.env y .env, y llena 'config' con PS4, 720p a 60 fps, H.264, sin audio.
    // Devuelve false (y explica el motivo por consola) si falta algún dato.
    // Ojo: no copiar SessionConfig después de llamar, porque info.host apunta a config.host.
    bool load_session_config(SessionConfig& config);
}
