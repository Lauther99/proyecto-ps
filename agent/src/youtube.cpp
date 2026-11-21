// Ver youtube.hpp.
//
// Marcas de tiempo: las pone el agente, no ffmpeg (ffmpeg no puede asignar la hora del reloj
// a H.264 "crudo" porque al separarlo en fotogramas la mayoría quedan sin hora).
//   - Video: cada fotograma va en una etiqueta FLV con su tiempo en ms desde el inicio (T0).
//     No se recodifica: FLV lleva H.264 con NALs precedidos por su tamaño, igual que WebRTC.
//   - Audio: PCM continuo desde T0. Si la PS4 deja de mandar audio (reconexión), se rellena con
//     silencio para que el audio no se atrase respecto al video.
#include "youtube.hpp"

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>

#include <opus/opus.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <deque>
#include <mutex>
#include <thread>
#include <vector>

namespace agent
{
    namespace
    {
        constexpr unsigned short kVideoPort = 9101;
        constexpr unsigned short kAudioPort = 9102;
        constexpr size_t kMaxVideoQueueBytes = 8 * 1024 * 1024; // ~10 s de video: si se llena, ffmpeg está trabado
        constexpr size_t kMaxAudioQueueBytes = 4 * 1024 * 1024; // ~20 s de PCM
        constexpr int kSampleRate = 48000;
        constexpr int kChannels = 2;
        constexpr int kOpusMaxFrame = 5760;                     // 120 ms a 48 kHz, el máximo de Opus
        constexpr int64_t kMaxAudioLagSamples = kSampleRate / 10; // si el audio se atrasa > 100 ms, silencio

        // Cola de bytes hacia un socket. La llenan los hilos de chiaki y la vacía un hilo propio,
        // para que una red lenta hacia ffmpeg nunca frene la recepción de la PS4.
        // Puede aceptar datos antes de conectarse ("accepting"): se guardan y salen al conectar.
        class SocketPipe
        {
        public:
            explicit SocketPipe(size_t max_bytes) : max_bytes_(max_bytes) {}

            void set_accepting(bool value)
            {
                std::lock_guard<std::mutex> lock(mutex_);
                accepting_ = value;
            }

            // Intenta conectarse a ffmpeg (que escucha en 'port'). true si lo logró.
            bool connect_to(unsigned short port)
            {
                SOCKET s = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
                if (s == INVALID_SOCKET)
                    return false;
                sockaddr_in addr{};
                addr.sin_family = AF_INET;
                addr.sin_port = htons(port);
                inet_pton(AF_INET, "127.0.0.1", &addr.sin_addr);
                if (::connect(s, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) != 0)
                {
                    closesocket(s);
                    return false;
                }
                std::lock_guard<std::mutex> lock(mutex_);
                socket_ = s;
                open_ = true;
                writer_ = std::thread([this]() { write_loop(); });
                cv_.notify_all();
                return true;
            }

            bool is_open() const { return open_; }

            // Encola datos. false si la cola se desbordó (y se vació).
            bool push(std::vector<uint8_t> data)
            {
                std::lock_guard<std::mutex> lock(mutex_);
                if (!accepting_)
                    return true;
                if (queued_bytes_ + data.size() > max_bytes_)
                {
                    queue_.clear();
                    queued_bytes_ = 0;
                    return false;
                }
                queued_bytes_ += data.size();
                queue_.push_back(std::move(data));
                cv_.notify_all();
                return true;
            }

            void close()
            {
                {
                    std::lock_guard<std::mutex> lock(mutex_);
                    accepting_ = false;
                    open_ = false;
                    if (socket_ != INVALID_SOCKET)
                    {
                        ::shutdown(socket_, SD_BOTH); // ffmpeg ve "fin de datos" y cierra bien el archivo
                        closesocket(socket_);
                        socket_ = INVALID_SOCKET;
                    }
                    queue_.clear();
                    queued_bytes_ = 0;
                    cv_.notify_all();
                }
                if (writer_.joinable())
                    writer_.join();
            }

            ~SocketPipe() { close(); }

        private:
            void write_loop()
            {
                for (;;)
                {
                    std::vector<uint8_t> chunk;
                    SOCKET s;
                    {
                        std::unique_lock<std::mutex> lock(mutex_);
                        cv_.wait(lock, [this]() { return !open_ || !queue_.empty(); });
                        if (!open_)
                            return;
                        chunk = std::move(queue_.front());
                        queue_.pop_front();
                        queued_bytes_ -= chunk.size();
                        s = socket_;
                    }
                    size_t sent = 0;
                    while (sent < chunk.size())
                    {
                        const int n = ::send(s, reinterpret_cast<const char*>(chunk.data() + sent),
                                             static_cast<int>(chunk.size() - sent), 0);
                        if (n <= 0)
                        {
                            open_ = false; // ffmpeg se cerró
                            return;
                        }
                        sent += static_cast<size_t>(n);
                    }
                }
            }

            const size_t max_bytes_;
            std::mutex mutex_;
            std::condition_variable cv_;
            std::deque<std::vector<uint8_t>> queue_;
            size_t queued_bytes_ = 0;
            SOCKET socket_ = INVALID_SOCKET;
            std::atomic<bool> open_{false};
            bool accepting_ = false;
            std::thread writer_;
        };

        // --- FLV (solo lo necesario para un stream de video H.264) ---

        void put_u8(std::vector<uint8_t>& out, uint32_t v) { out.push_back(static_cast<uint8_t>(v)); }
        void put_u16(std::vector<uint8_t>& out, uint32_t v) { put_u8(out, v >> 8); put_u8(out, v); }
        void put_u24(std::vector<uint8_t>& out, uint32_t v) { put_u8(out, v >> 16); put_u16(out, v); }
        void put_u32(std::vector<uint8_t>& out, uint32_t v) { put_u16(out, v >> 16); put_u16(out, v); }

        // Cabecera del archivo FLV: versión 1, solo video.
        std::vector<uint8_t> flv_file_header()
        {
            std::vector<uint8_t> out = {'F', 'L', 'V', 1, 0x01};
            put_u32(out, 9); // tamaño de esta cabecera
            put_u32(out, 0); // "tamaño de la etiqueta anterior" (no hay)
            return out;
        }

        // Una etiqueta de video FLV. 'body' empieza con el byte de tipo de fotograma/códec.
        std::vector<uint8_t> flv_video_tag(uint32_t timestamp_ms, const std::vector<uint8_t>& body)
        {
            std::vector<uint8_t> out;
            out.reserve(body.size() + 15);
            put_u8(out, 9); // 9 = video
            put_u24(out, static_cast<uint32_t>(body.size()));
            put_u24(out, timestamp_ms & 0xffffff);
            put_u8(out, (timestamp_ms >> 24) & 0xff);
            put_u24(out, 0); // stream id
            out.insert(out.end(), body.begin(), body.end());
            put_u32(out, static_cast<uint32_t>(11 + body.size()));
            return out;
        }

        // Configuración del decodificador (AVCDecoderConfigurationRecord) a partir de SPS/PPS.
        std::vector<uint8_t> avc_sequence_header(const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size)
        {
            std::vector<uint8_t> body = {0x17, 0x00, 0, 0, 0}; // fotograma clave + AVC, "sequence header"
            body.push_back(1);      // versión
            body.push_back(sps[1]); // perfil
            body.push_back(sps[2]); // compatibilidad
            body.push_back(sps[3]); // nivel
            body.push_back(0xff);   // NALs con tamaño de 4 bytes
            body.push_back(0xe1);   // 1 SPS
            put_u16(body, static_cast<uint32_t>(sps_size));
            body.insert(body.end(), sps, sps + sps_size);
            body.push_back(1);      // 1 PPS
            put_u16(body, static_cast<uint32_t>(pps_size));
            body.insert(body.end(), pps, pps + pps_size);
            return body;
        }

        // Fotograma H.264 Annex B -> cuerpo FLV con NALs precedidos por su tamaño.
        // Se omiten SPS/PPS/AUD: ffmpeg ya los tiene por la "sequence header".
        std::vector<uint8_t> avc_frame_body(const uint8_t* buf, size_t size, bool keyframe)
        {
            std::vector<uint8_t> body = {static_cast<uint8_t>(keyframe ? 0x17 : 0x27), 0x01, 0, 0, 0};
            std::vector<size_t> starts;
            for (size_t i = 0; i + 2 < size; ++i)
            {
                if (buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1)
                {
                    starts.push_back(i + 3);
                    i += 2;
                }
            }
            for (size_t k = 0; k < starts.size(); ++k)
            {
                size_t end = (k + 1 < starts.size()) ? starts[k + 1] - 3 : size;
                while (end > starts[k] && buf[end - 1] == 0)
                    --end;
                if (end <= starts[k])
                    continue;
                const unsigned type = buf[starts[k]] & 0x1f;
                if (type == 7 || type == 8 || type == 9)
                    continue;
                put_u32(body, static_cast<uint32_t>(end - starts[k]));
                body.insert(body.end(), buf + starts[k], buf + end);
            }
            return body;
        }

        // ¿Este codificador de ffmpeg funciona en esta máquina? (prueba con un fotograma vacío)
        bool encoder_works(const std::string& ffmpeg_path, const std::string& encoder)
        {
            std::string cmd = "\"" + ffmpeg_path + "\" -hide_banner -loglevel quiet -nostdin"
                              " -f lavfi -i color=black:s=1280x720:r=30 -frames:v 5 -c:v " + encoder + " -f null -";
            STARTUPINFOA si{};
            si.cb = sizeof(si);
            PROCESS_INFORMATION pi{};
            if (!CreateProcessA(nullptr, cmd.data(), nullptr, nullptr, FALSE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi))
                return false;
            CloseHandle(pi.hThread);
            DWORD code = 1;
            if (WaitForSingleObject(pi.hProcess, 15000) == WAIT_OBJECT_0)
                GetExitCodeProcess(pi.hProcess, &code);
            else
                TerminateProcess(pi.hProcess, 1);
            CloseHandle(pi.hProcess);
            return code == 0;
        }
    }

    struct YoutubeStreamer::Impl
    {
        std::string output;
        std::string display_output;
        std::string ffmpeg_path;
        std::string encoder;

        std::atomic<bool> running{false};
        std::thread supervisor;
        std::mutex process_mutex;
        HANDLE process = nullptr;

        SocketPipe video{kMaxVideoQueueBytes};
        SocketPipe audio{kMaxAudioQueueBytes};

        // Estado del stream actual hacia ffmpeg (lo tocan los hilos de video y audio de chiaki).
        std::mutex stream_mutex;
        bool need_keyframe = true;     // hay que empezar (o reanudar) por un IDR
        bool started = false;          // ¿ya pasó el primer IDR? (define T0)
        std::chrono::steady_clock::time_point t0;
        std::vector<uint8_t> sent_sps; // SPS de la última "sequence header" enviada
        int64_t audio_samples = 0;     // muestras por canal enviadas desde T0

        std::mutex opus_mutex;
        OpusDecoder* opus = nullptr;
        std::vector<int16_t> pcm = std::vector<int16_t>(kOpusMaxFrame * kChannels);

        std::string build_command() const
        {
            const bool is_url = output.rfind("rtmp", 0) == 0;
            std::string cmd = "\"" + ffmpeg_path + "\"";
            cmd += " -hide_banner -loglevel warning -nostdin";
            // Entrada 0: video FLV (H.264 de la PS4 sin recodificar, con las marcas de tiempo del agente).
            cmd += " -thread_queue_size 1024 -f flv -i tcp://127.0.0.1:" + std::to_string(kVideoPort) + "?listen=1";
            // Entrada 1: audio PCM continuo desde el mismo instante que el video.
            cmd += " -thread_queue_size 1024 -f s16le -ar 48000 -ac 2 -i tcp://127.0.0.1:" + std::to_string(kAudioPort) + "?listen=1";
            cmd += " -map 0:v:0 -map 1:a:0";
            // Video para YouTube: 720p30, 4,5 Mbps, fotograma completo cada 2 s (60 fotogramas).
            cmd += " -vf fps=30 -pix_fmt yuv420p -c:v " + encoder;
            if (encoder.find("nvenc") != std::string::npos)
                cmd += " -preset p4";
            else if (encoder == "libx264")
                cmd += " -preset veryfast";
            cmd += " -profile:v high -b:v 4500k -maxrate 4500k -bufsize 9000k -g 60 -keyint_min 60";
            // Audio: YouTube por RTMP no acepta Opus, así que AAC.
            cmd += " -c:a aac -b:a 128k -ar 48000";
            cmd += is_url ? " -f flv \"" + output + "\"" : " -y \"" + output + "\"";
            return cmd;
        }

        bool launch_ffmpeg()
        {
            std::string cmd = build_command();
            // ffmpeg escribe sus avisos en nuestra misma consola (o archivo de log).
            HANDLE out = GetStdHandle(STD_OUTPUT_HANDLE);
            HANDLE err = GetStdHandle(STD_ERROR_HANDLE);
            SetHandleInformation(out, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
            SetHandleInformation(err, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT);
            STARTUPINFOA si{};
            si.cb = sizeof(si);
            si.dwFlags = STARTF_USESTDHANDLES;
            si.hStdInput = nullptr;
            si.hStdOutput = out;
            si.hStdError = err;
            PROCESS_INFORMATION pi{};
            if (!CreateProcessA(nullptr, cmd.data(), nullptr, nullptr, TRUE, 0, nullptr, nullptr, &si, &pi))
            {
                std::printf("[youtube] No se pudo ejecutar ffmpeg (%s). Error %lu.\n", ffmpeg_path.c_str(), GetLastError());
                return false;
            }
            CloseHandle(pi.hThread);
            std::lock_guard<std::mutex> lock(process_mutex);
            process = pi.hProcess;
            return true;
        }

        bool process_alive()
        {
            std::lock_guard<std::mutex> lock(process_mutex);
            return process && WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
        }

        // Cierra las entradas de ffmpeg y espera a que termine (como mucho 5 s).
        void end_ffmpeg()
        {
            video.close();
            audio.close();
            std::lock_guard<std::mutex> lock(process_mutex);
            if (!process)
                return;
            if (WaitForSingleObject(process, 5000) == WAIT_TIMEOUT)
                TerminateProcess(process, 1);
            CloseHandle(process);
            process = nullptr;
        }

        void reset_stream()
        {
            std::lock_guard<std::mutex> lock(stream_mutex);
            need_keyframe = true;
            started = false;
            sent_sps.clear();
            audio_samples = 0;
        }

        // Conecta a un puerto de ffmpeg reintentando mientras ffmpeg siga vivo.
        bool connect_with_retry(SocketPipe& pipe, unsigned short port, std::chrono::seconds timeout)
        {
            const auto until = std::chrono::steady_clock::now() + timeout;
            while (running && process_alive() && std::chrono::steady_clock::now() < until)
            {
                if (pipe.connect_to(port))
                    return true;
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
            }
            return false;
        }

        // Hilo que mantiene ffmpeg vivo: lo lanza, conecta video y audio, y si se cae lo relanza.
        void supervise()
        {
            if (encoder == "auto")
            {
                encoder = "libx264";
                for (const char* candidate : {"h264_nvenc", "h264_amf", "h264_qsv"})
                {
                    if (encoder_works(ffmpeg_path, candidate))
                    {
                        encoder = candidate;
                        break;
                    }
                }
                std::printf("[youtube] Codificador: %s\n", encoder.c_str());
            }

            while (running)
            {
                std::printf("[youtube] Iniciando ffmpeg -> %s\n", display_output.c_str());
                reset_stream();
                if (launch_ffmpeg())
                {
                    // Desde ahora guardamos video y audio aunque ffmpeg todavía no lea el audio
                    // (primero analiza el video y recién después abre la entrada de audio).
                    video.set_accepting(true);
                    audio.set_accepting(true);
                    if (connect_with_retry(video, kVideoPort, std::chrono::seconds(10)) &&
                        connect_with_retry(audio, kAudioPort, std::chrono::seconds(30)))
                    {
                        std::printf("[youtube] Transmitiendo.\n");
                        while (running && process_alive() && video.is_open() && audio.is_open())
                            std::this_thread::sleep_for(std::chrono::milliseconds(200));
                    }
                    else if (running)
                    {
                        std::printf("[youtube] ffmpeg no recibio datos a tiempo (¿la PS4 esta transmitiendo?).\n");
                    }
                }
                end_ffmpeg();
                if (!running)
                    break;
                std::printf("[youtube] ffmpeg se detuvo. Reintentando en 5 s.\n");
                for (int i = 0; i < 50 && running; ++i)
                    std::this_thread::sleep_for(std::chrono::milliseconds(100));
            }
        }

        // Rellena con silencio hasta 'until_samples' (llamar con stream_mutex tomado).
        void pad_silence_locked(int64_t until_samples)
        {
            while (audio_samples < until_samples)
            {
                const int64_t n = (std::min)(until_samples - audio_samples, int64_t{kSampleRate}); // máx. 1 s por bloque
                audio.push(std::vector<uint8_t>(static_cast<size_t>(n) * kChannels * sizeof(int16_t), 0));
                audio_samples += n;
            }
        }
    };

    YoutubeStreamer::YoutubeStreamer(std::string output, std::string display_output, std::string ffmpeg_path, std::string encoder)
        : impl_(std::make_unique<Impl>())
    {
        impl_->output = std::move(output);
        impl_->display_output = std::move(display_output);
        impl_->ffmpeg_path = std::move(ffmpeg_path);
        impl_->encoder = std::move(encoder);
        int err = 0;
        impl_->opus = opus_decoder_create(kSampleRate, kChannels, &err);
        if (err != OPUS_OK)
            impl_->opus = nullptr;
    }

    YoutubeStreamer::~YoutubeStreamer()
    {
        stop();
        if (impl_->opus)
            opus_decoder_destroy(impl_->opus);
    }

    void YoutubeStreamer::start()
    {
        if (impl_->running.exchange(true))
            return;
        WSADATA wsa;
        WSAStartup(MAKEWORD(2, 2), &wsa);
        impl_->supervisor = std::thread([this]() { impl_->supervise(); });
    }

    void YoutubeStreamer::stop()
    {
        if (!impl_->running.exchange(false))
            return;
        if (impl_->supervisor.joinable())
            impl_->supervisor.join();
        std::printf("[youtube] Detenido.\n");
    }

    bool YoutubeStreamer::wants_keyframe() const
    {
        if (!impl_->running || !impl_->process_alive())
            return false;
        std::lock_guard<std::mutex> lock(impl_->stream_mutex);
        return impl_->need_keyframe;
    }

    void YoutubeStreamer::push_video(const uint8_t* data, size_t size, bool is_idr,
                                     const uint8_t* sps, size_t sps_size, const uint8_t* pps, size_t pps_size)
    {
        Impl& d = *impl_;
        if (!d.running || !d.process_alive())
            return;
        std::lock_guard<std::mutex> lock(d.stream_mutex);
        if (d.need_keyframe)
        {
            // ffmpeg solo puede empezar a decodificar desde un IDR con su SPS/PPS.
            if (!is_idr || sps_size < 4 || pps_size == 0)
                return;
            d.need_keyframe = false;
            if (!d.started)
            {
                d.started = true;
                d.t0 = std::chrono::steady_clock::now();
                d.video.push(flv_file_header());
            }
        }
        const auto now = std::chrono::steady_clock::now();
        const auto ms = static_cast<uint32_t>(std::chrono::duration_cast<std::chrono::milliseconds>(now - d.t0).count());

        // Nueva configuración del decodificador si cambió el SPS (por ejemplo, nueva sesión).
        if (is_idr && std::vector<uint8_t>(sps, sps + sps_size) != d.sent_sps)
        {
            d.video.push(flv_video_tag(ms, avc_sequence_header(sps, sps_size, pps, pps_size)));
            d.sent_sps.assign(sps, sps + sps_size);
        }
        if (!d.video.push(flv_video_tag(ms, avc_frame_body(data, size, is_idr))))
        {
            std::printf("[youtube] ffmpeg va atrasado: se descarto video, esperando fotograma completo.\n");
            d.need_keyframe = true;
        }
    }

    void YoutubeStreamer::push_audio(const uint8_t* data, size_t size)
    {
        Impl& d = *impl_;
        if (!d.opus || !d.running)
            return;
        std::vector<uint8_t> bytes;
        {
            std::lock_guard<std::mutex> lock(d.opus_mutex);
            const int samples = opus_decode(d.opus, data, static_cast<opus_int32>(size), d.pcm.data(), kOpusMaxFrame, 0);
            if (samples <= 0)
                return;
            const auto* raw = reinterpret_cast<const uint8_t*>(d.pcm.data());
            bytes.assign(raw, raw + static_cast<size_t>(samples) * kChannels * sizeof(int16_t));
        }
        const int64_t samples = static_cast<int64_t>(bytes.size() / (kChannels * sizeof(int16_t)));

        std::lock_guard<std::mutex> lock(d.stream_mutex);
        if (!d.started)
            return; // el audio empieza en T0, junto con el primer fotograma de video
        // ¿Cuántas muestras deberían haberse enviado según el reloj? Si faltan (la PS4 dejó de
        // mandar audio un rato), rellenamos con silencio para no atrasarnos respecto al video.
        const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - d.t0).count();
        const auto expected = static_cast<int64_t>(elapsed * kSampleRate);
        if (expected - (d.audio_samples + samples) > kMaxAudioLagSamples)
            d.pad_silence_locked(expected - samples);
        d.audio.push(std::move(bytes));
        d.audio_samples += samples;
    }
}
