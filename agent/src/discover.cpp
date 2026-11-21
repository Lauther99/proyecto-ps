// Comando "discover": pregunta a la PS4 si está en la red y en qué estado.
#include "commands.hpp"

#include <chiaki/discovery.h>
#include <chiaki/log.h>

#include <chrono>
#include <cstdio>
#include <cstring>
#include <thread>

namespace agent
{
    namespace
    {
        // chiaki llama a esta función (desde su propio hilo) por cada consola que responde.
        void on_host_found(ChiakiDiscoveryHost* host, void* user)
        {
            int* found = static_cast<int*>(user);
            ++(*found);

            auto show = [](const char* label, const char* value) {
                if (value)
                    std::printf("  %-22s %s\n", label, value);
            };

            std::printf("\nConsola encontrada:\n");
            show("IP:", host->host_addr);
            show("Nombre:", host->host_name);
            show("Tipo:", host->host_type);
            show("Estado:", chiaki_discovery_host_state_string(host->state));
            show("Version del sistema:", host->system_version);
            show("ID de consola:", host->host_id);
            show("App en ejecucion:", host->running_app_name);
        }
    }

    int cmd_discover(const std::string& target, int timeout_ms)
    {
        // Log de chiaki: solo errores y advertencias, para no ensuciar la salida.
        ChiakiLog log;
        chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, nullptr);

        // Dirección de destino: la IP indicada o broadcast (toda la red).
        sockaddr_in addr{};
        addr.sin_family = AF_INET;
        addr.sin_port = htons(CHIAKI_DISCOVERY_PORT_PS4);
        if (inet_pton(AF_INET, target.c_str(), &addr.sin_addr) != 1)
        {
            std::printf("IP invalida: %s\n", target.c_str());
            return 1;
        }

        ChiakiDiscovery discovery;
        if (chiaki_discovery_init(&discovery, &log, AF_INET) != CHIAKI_ERR_SUCCESS)
        {
            std::printf("No se pudo abrir el socket de descubrimiento\n");
            return 1;
        }

        // Hilo que escucha respuestas y llama a on_host_found.
        int found = 0;
        ChiakiDiscoveryThread thread;
        if (chiaki_discovery_thread_start(&thread, &discovery, on_host_found, &found) != CHIAKI_ERR_SUCCESS)
        {
            std::printf("No se pudo iniciar el hilo de descubrimiento\n");
            chiaki_discovery_fini(&discovery);
            return 1;
        }

        // Paquete "SRCH" (búsqueda) con la versión de protocolo de PS4.
        ChiakiDiscoveryPacket packet{};
        packet.cmd = CHIAKI_DISCOVERY_CMD_SRCH;
        packet.protocol_version = const_cast<char*>(CHIAKI_DISCOVERY_PROTOCOL_VERSION_PS4);

        std::printf("Buscando PS4 en %s (espera %d ms)...\n", target.c_str(), timeout_ms);
        const ChiakiErrorCode err = chiaki_discovery_send(&discovery, &packet,
            reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
        if (err != CHIAKI_ERR_SUCCESS)
            std::printf("Error al enviar: %s\n", chiaki_error_string(err));

        std::this_thread::sleep_for(std::chrono::milliseconds(timeout_ms));

        chiaki_discovery_thread_stop(&thread);
        chiaki_discovery_fini(&discovery);

        if (found == 0)
        {
            std::printf("\nNinguna consola respondio. Revisa que este encendida o en reposo con red,\n"
                        "que el Uso a distancia este habilitado y que estes en la misma red.\n");
            return 2;
        }
        return 0;
    }
}
