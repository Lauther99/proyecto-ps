// Punto de entrada del agente: lee el comando y lo ejecuta.
//   ps4-agent discover            usa PS4_HOST del .env
//   ps4-agent discover <ip>       consulta esa IP
//   ps4-agent discover --all      busca en toda la red (broadcast)
#include "commands.hpp"
#include "env.hpp"

#include <chiaki/common.h>

#include <cstdio>
#include <cstdlib>
#include <string>

namespace
{
    void print_usage()
    {
        std::printf(
            "Uso:\n"
            "  ps4-agent discover          Consulta la PS4 de PS4_HOST (.env)\n"
            "  ps4-agent discover <ip>     Consulta una IP concreta\n"
            "  ps4-agent discover --all    Busca en toda la red\n"
            "  ps4-agent register <codigo> Vincula con la PS4 (codigo de 8 digitos)\n"
            "  ps4-agent stream [seg]      Guarda video en capture.h264 (15 s por defecto)\n"
            "  ps4-agent serve             Transmite al navegador por WebRTC (ws://localhost:8000)\n"
            "  ps4-agent serve --youtube   Ademas transmite a YouTube Live (sin clave: youtube-test.mkv)\n"
            "  ps4-agent serve --room      Ademas se conecta a la sala de Cloudflare (ROOM_URL, AGENT_TOKEN)\n"
            "                              (--youtube y --room se pueden combinar)\n");
    }
}

int main(int argc, char* argv[])
{
    // Sin búfer: los mensajes salen al instante aunque la salida vaya a un archivo.
    std::setvbuf(stdout, nullptr, _IONBF, 0);

    if (argc < 2)
    {
        print_usage();
        return 1;
    }

    // Prepara sockets de Windows y criptografía de chiaki.
    const ChiakiErrorCode init = chiaki_lib_init();
    if (init != CHIAKI_ERR_SUCCESS)
    {
        std::printf("chiaki_lib_init fallo: %s\n", chiaki_error_string(init));
        return 1;
    }

    const agent::EnvMap env = agent::load_env();
    const std::string command = argv[1];

    if (command == "discover")
    {
        std::string target = agent::env_get(env, "PS4_HOST", "255.255.255.255");
        if (argc >= 3)
            target = (std::string(argv[2]) == "--all") ? "255.255.255.255" : argv[2];
        return agent::cmd_discover(target, 2000);
    }

    if (command == "register")
    {
        const std::string host = agent::env_get(env, "PS4_HOST");
        const std::string account = agent::env_get(env, "PSN_ACCOUNT_ID");
        if (host.empty() || account.empty())
        {
            std::printf("Faltan PS4_HOST o PSN_ACCOUNT_ID en .env\n");
            return 1;
        }
        if (argc < 3)
        {
            std::printf("Uso: ps4-agent register <codigo de 8 digitos>\n");
            return 1;
        }
        return agent::cmd_register(host, account, argv[2]);
    }

    if (command == "stream")
    {
        const int seconds = (argc >= 3) ? std::atoi(argv[2]) : 15;
        return agent::cmd_stream("capture.h264", seconds > 0 ? seconds : 15);
    }

    if (command == "serve")
    {
        bool youtube = false, room = false;
        for (int i = 2; i < argc; ++i)
        {
            const std::string flag = argv[i];
            youtube = youtube || flag == "--youtube";
            room = room || flag == "--room";
        }
        return agent::cmd_serve(8000, youtube, room);
    }

    print_usage();
    return 1;
}
