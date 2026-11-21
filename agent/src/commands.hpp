// Declaración de los comandos del agente.
#pragma once

#include <string>

namespace agent
{
    // Envía una búsqueda a 'target' (IP de la PS4 o 255.255.255.255) y muestra las respuestas.
    int cmd_discover(const std::string& target, int timeout_ms);

    // Vincula el agente con la PS4 usando el código de 8 dígitos. Guarda las claves en registration.env.
    int cmd_register(const std::string& ps4_host, const std::string& account_id_b64, const std::string& pin_text);

    // Abre una sesión de Remote Play y guarda 'seconds' segundos de video H.264 en 'output_path'.
    int cmd_stream(const std::string& output_path, int seconds);

    // Mantiene la sesión con la PS4 y reparte el video por WebRTC (señalización WebSocket en 'port').
    int cmd_serve(unsigned short port);
}
