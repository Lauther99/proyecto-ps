// Comando "discover": pregunta a la PS4 si está en la red y en qué estado.
#include "commands.hpp"

#include <chiaki/discovery.h>
#include <chiaki/log.h>

#include <cctype>
#include <chrono>
#include <cstdio>
#include <cstring>
#include <mutex>
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

        bool equals_ignore_case(const std::string& a, const char* b)
        {
            if (!b || a.size() != std::strlen(b))
                return false;
            for (size_t i = 0; i < a.size(); ++i)
                if (std::tolower(static_cast<unsigned char>(a[i])) != std::tolower(static_cast<unsigned char>(b[i])))
                    return false;
            return true;
        }

        // Estado de una búsqueda por ID: lo escribe el hilo de chiaki y lo lee el principal.
        struct FindContext
        {
            std::mutex mutex;
            std::string wanted_id;
            std::string found_ip;
        };

        void on_host_for_find(ChiakiDiscoveryHost* host, void* user)
        {
            auto* ctx = static_cast<FindContext*>(user);
            std::lock_guard<std::mutex> lock(ctx->mutex);
            if (ctx->found_ip.empty() && host->host_addr && equals_ignore_case(ctx->wanted_id, host->host_id))
                ctx->found_ip = host->host_addr;
        }
    }

    std::string find_ps4_ip(const std::string& host_id, const std::string& last_known_ip, int timeout_ms)
    {
        if (host_id.empty())
            return "";

        ChiakiLog log;
        chiaki_log_init(&log, CHIAKI_LOG_ERROR, chiaki_log_cb_print, nullptr);

        ChiakiDiscovery discovery;
        if (chiaki_discovery_init(&discovery, &log, AF_INET) != CHIAKI_ERR_SUCCESS)
            return "";

        FindContext ctx;
        ctx.wanted_id = host_id;
        ChiakiDiscoveryThread thread;
        if (chiaki_discovery_thread_start(&thread, &discovery, on_host_for_find, &ctx) != CHIAKI_ERR_SUCCESS)
        {
            chiaki_discovery_fini(&discovery);
            return "";
        }

        ChiakiDiscoveryPacket packet{};
        packet.cmd = CHIAKI_DISCOVERY_CMD_SRCH;
        packet.protocol_version = const_cast<char*>(CHIAKI_DISCOVERY_PROTOCOL_VERSION_PS4);

        // Preguntamos a toda la red (broadcast) y también a la última IP conocida, por si el
        // router no deja pasar el broadcast entre Wi-Fi y cable.
        for (const std::string& target : { std::string("255.255.255.255"), last_known_ip })
        {
            sockaddr_in addr{};
            addr.sin_family = AF_INET;
            addr.sin_port = htons(CHIAKI_DISCOVERY_PORT_PS4);
            if (!target.empty() && inet_pton(AF_INET, target.c_str(), &addr.sin_addr) == 1)
                chiaki_discovery_send(&discovery, &packet, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
        }

        // Esperamos hasta encontrarla o hasta agotar el tiempo.
        std::string result;
        const auto until = std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);
        while (std::chrono::steady_clock::now() < until)
        {
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
            std::lock_guard<std::mutex> lock(ctx.mutex);
            if (!ctx.found_ip.empty())
            {
                result = ctx.found_ip;
                break;
            }
        }

        chiaki_discovery_thread_stop(&thread);
        chiaki_discovery_fini(&discovery);
        return result;
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
