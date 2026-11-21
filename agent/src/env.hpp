// Lectura del archivo .env (líneas CLAVE=valor).
#pragma once

#include <map>
#include <string>

namespace agent
{
    using EnvMap = std::map<std::string, std::string>;

    // Busca .env en la carpeta actual y, si no existe, junto al ejecutable.
    // Devuelve un mapa vacío si no encuentra ninguno.
    EnvMap load_env();

    // Igual que load_env, pero con otro nombre de archivo (por ejemplo "registration.env").
    EnvMap load_env_file(const std::string& filename);

    // Devuelve el valor de una clave o 'fallback' si no existe o está vacía.
    std::string env_get(const EnvMap& env, const std::string& key, const std::string& fallback = "");
}
