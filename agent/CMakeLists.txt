cmake_minimum_required(VERSION 3.20)
project(ps4_agent C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Solo la librería de chiaki: sin GUI, CLI, tests ni extras
set(CHIAKI_ENABLE_GUI              OFF CACHE BOOL   "" FORCE)
set(CHIAKI_ENABLE_CLI              OFF CACHE BOOL   "" FORCE)
set(CHIAKI_ENABLE_TESTS            OFF CACHE BOOL   "" FORCE)
set(CHIAKI_ENABLE_STEAMDECK_NATIVE OFF CACHE STRING "" FORCE)
set(CHIAKI_ENABLE_STEAM_SHORTCUT   OFF CACHE BOOL   "" FORCE)
set(CHIAKI_ENABLE_SETSU            OFF CACHE STRING "" FORCE)
set(CHIAKI_ENABLE_SPEEX            OFF CACHE STRING "" FORCE)
set(CHIAKI_ENABLE_FFMPEG_DECODER   OFF CACHE STRING "" FORCE)  # reenviamos H.264 sin decodificar
set(CHIAKI_ENABLE_RUDP             OFF CACHE STRING "" FORCE)  # Remote Play por internet de Sony: no lo usamos

# curl (submódulo de chiaki): funciones que no usamos
set(CURL_USE_LIBPSL  OFF CACHE BOOL "" FORCE)
set(CURL_USE_LIBSSH2 OFF CACHE BOOL "" FORCE)

add_subdirectory(third_party/chiaki-ng EXCLUDE_FROM_ALL)

add_executable(ps4-agent
    src/main.cpp
    src/env.cpp
    src/discover.cpp
    src/register.cpp
    src/stream.cpp
    src/serve.cpp
    src/session_config.cpp
    src/youtube.cpp
)
find_package(LibDataChannel CONFIG REQUIRED)   # WebRTC + WebSocket
find_package(nlohmann_json CONFIG REQUIRED)    # JSON para la señalización

target_link_libraries(ps4-agent PRIVATE
    chiaki-lib
    LibDataChannel::LibDataChannel
    nlohmann_json::nlohmann_json
)
