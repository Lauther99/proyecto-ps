#include "env.hpp"

#include <filesystem>
#include <fstream>

#ifdef _WIN32
#include <windows.h>
#endif

namespace fs = std::filesystem;

namespace agent
{
    namespace
    {
        // Quita espacios al inicio y al final.
        std::string trim(const std::string& s)
        {
            const auto first = s.find_first_not_of(" \t\r\n");
            if (first == std::string::npos)
                return "";
            const auto last = s.find_last_not_of(" \t\r\n");
            return s.substr(first, last - first + 1);
        }

        fs::path executable_dir()
        {
#ifdef _WIN32
            wchar_t buffer[MAX_PATH];
            const DWORD len = GetModuleFileNameW(nullptr, buffer, MAX_PATH);
            if (len > 0 && len < MAX_PATH)
                return fs::path(buffer).parent_path();
#endif
            return fs::current_path();
        }

        EnvMap parse_file(const fs::path& path)
        {
            EnvMap env;
            std::ifstream file(path);
            std::string line;
            while (std::getline(file, line))
            {
                line = trim(line);
                if (line.empty() || line[0] == '#')
                    continue; // línea vacía o comentario

                const auto eq = line.find('=');
                if (eq == std::string::npos)
                    continue; // línea sin '=': se ignora

                env[trim(line.substr(0, eq))] = trim(line.substr(eq + 1));
            }
            return env;
        }
    }

    EnvMap load_env_file(const std::string& filename)
    {
        for (const fs::path& dir : { fs::current_path(), executable_dir() })
        {
            const fs::path candidate = dir / filename;
            if (fs::exists(candidate))
                return parse_file(candidate);
        }
        return {};
    }

    EnvMap load_env()
    {
        return load_env_file(".env");
    }

    std::string env_get(const EnvMap& env, const std::string& key, const std::string& fallback)
    {
        const auto it = env.find(key);
        if (it == env.end() || it->second.empty())
            return fallback;
        return it->second;
    }
}
