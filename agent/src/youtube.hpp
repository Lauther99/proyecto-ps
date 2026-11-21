// Transmisión a YouTube Live (o a un archivo de prueba) con ffmpeg.
//
// El video del jugador NO se toca: aquí recibimos una copia, ffmpeg la decodifica y la vuelve
// a codificar con la GPU (NVENC) a 720p30 con un fotograma completo cada 2 s, como pide YouTube.
// Así la PS4 no tiene que mandar fotogramas completos extra y el jugador no lo nota.
//
//   chiaki --H.264--> push_video() --TCP 127.0.0.1:9101--> ffmpeg --RTMPS--> YouTube
//   chiaki --Opus---> push_audio() --PCM, TCP :9102------->   (o archivo .mkv)
#pragma once

#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>

namespace agent
{
    class YoutubeStreamer
    {
    public:
        // 'output': URL rtmps://... o ruta de archivo. 'display_output': lo que se muestra en
        // pantalla (sin la clave de transmisión). 'encoder': códec de ffmpeg, o "auto" (NVIDIA, AMD, Intel o CPU).
        YoutubeStreamer(std::string output, std::string display_output, std::string ffmpeg_path, std::string encoder);
        ~YoutubeStreamer();

        YoutubeStreamer(const YoutubeStreamer&) = delete;
        YoutubeStreamer& operator=(const YoutubeStreamer&) = delete;

        void start();
        void stop();

        // Un fotograma H.264 Annex B tal como llega de la PS4. 'sps'/'pps' son los últimos
        // conocidos (sin start code): se anteponen al primer IDR que recibe ffmpeg.
        void push_video(const uint8_t* data, size_t size, bool is_idr,
                        const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size);

        // Una trama Opus de la PS4 (48 kHz, estéreo).
        void push_audio(const uint8_t* data, size_t size);

        // ¿ffmpeg está esperando un fotograma completo para empezar? (para pedirlo a la PS4)
        bool wants_keyframe() const;

    private:
        struct Impl;
        std::unique_ptr<Impl> impl_;
    };
}
