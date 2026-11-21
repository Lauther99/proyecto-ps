// Comando "serve": mantiene una sesión de Remote Play con la PS4 y reenvía el video
// a cada navegador que se conecte por WebRTC, sin volver a codificarlo.
//
//   PS4 --Remote Play--> agente --WebRTC (H.264)--> navegador
//                          ^                          |
//                          +-- WebSocket :8000 -------+   (señalización, solo red local)
//
// Señalización:
//   agente -> navegador: {"type":"offer","sdp":"..."}
//   navegador -> agente: {"type":"answer","sdp":"..."}
#include "commands.hpp"
#include "session_config.hpp"

#include <chiaki/discovery.h>
#include <chiaki/log.h>
#include <chiaki/session.h>

#include <rtc/rtc.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <csignal>
#include <cstdio>
#include <functional>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

using json = nlohmann::json;

namespace agent
{
    namespace
    {
        // Datos fijos del track de video que anunciamos a los navegadores.
        constexpr uint8_t kPayloadType = 102;
        constexpr uint32_t kSsrc = 42;
        const char* const kCname = "ps4-video";
        // El SPS de la PS4 dice perfil Main (4d), restricciones 40, nivel 4.0 (28). Lo anunciamos tal cual.
        const char* const kH264Profile = "profile-level-id=4d4028;packetization-mode=1;level-asymmetry-allowed=1";

        // Un navegador conectado.
        struct Viewer
        {
            std::shared_ptr<rtc::WebSocket> ws;
            std::shared_ptr<rtc::PeerConnection> pc;
            std::shared_ptr<rtc::Track> track;
            std::shared_ptr<rtc::RtpPacketizationConfig> rtp_config;
            std::shared_ptr<rtc::RtcpSrReporter> sr_reporter;
        };

        // Estado compartido entre hilos (chiaki, libdatachannel y el principal).
        struct ServerState
        {
            std::mutex mutex;
            std::vector<std::shared_ptr<Viewer>> viewers;
            ChiakiSession* session = nullptr;
            std::chrono::steady_clock::time_point start = std::chrono::steady_clock::now();
            std::atomic<bool> ps4_connected{false};
            std::atomic<bool> session_ended{false};
            std::atomic<uint64_t> frames{0};
            std::atomic<uint64_t> idr_frames{0};
            // Última copia de SPS y PPS. La PS4 los manda solo al inicio de la sesión, pero cada
            // navegador que llega después los necesita antes de poder decodificar un IDR.
            // Solo los toca el hilo de video de chiaki, así que no necesitan mutex.
            std::vector<uint8_t> sps;
            std::vector<uint8_t> pps;
            std::mutex idr_mutex;
            std::chrono::steady_clock::time_point last_idr_request{};
        };

        std::atomic<bool> g_stop{false};

        // Elemento de la cadena de libdatachannel que detecta pedidos de fotograma completo
        // del navegador (RTCP PLI o FIR) y avisa con 'on_request'.
        class KeyframeRequestHandler final : public rtc::MediaHandlerElement
        {
        public:
            explicit KeyframeRequestHandler(std::function<void()> on_request)
                : on_request_(std::move(on_request)) {}

            rtc::ChainedIncomingControlProduct processIncomingControlMessage(rtc::message_ptr message) override
            {
                size_t offset = 0;
                // Un mensaje RTCP puede traer varios paquetes seguidos (paquete "compuesto").
                while (offset + sizeof(rtc::RtcpHeader) <= message->size())
                {
                    auto* header = reinterpret_cast<rtc::RtcpHeader*>(message->data() + offset);
                    const size_t length = header->lengthInBytes();
                    if (length == 0 || offset + length > message->size())
                        break;
                    // PT 206 = feedback de video; FMT (reportCount) 1 = PLI, 4 = FIR.
                    if (header->payloadType() == 206 && (header->reportCount() == 1 || header->reportCount() == 4))
                    {
                        on_request_();
                        break;
                    }
                    offset += length;
                }
                return {message, std::nullopt};
            }

        private:
            std::function<void()> on_request_;
        };

        // Un NAL dentro del búfer de chiaki (sin el start code).
        struct Nal
        {
            const uint8_t* data;
            size_t size;
            unsigned type() const { return data[0] & 0x1f; } // 1 = P, 5 = IDR, 7 = SPS, 8 = PPS
        };

        // Separa H.264 Annex B (NALs separados por 00 00 01 / 00 00 00 01) en NALs.
        std::vector<Nal> split_nals(const uint8_t* buf, size_t size)
        {
            std::vector<size_t> starts;
            for (size_t i = 0; i + 2 < size; ++i)
            {
                if (buf[i] == 0 && buf[i + 1] == 0 && buf[i + 2] == 1)
                {
                    starts.push_back(i + 3);
                    i += 2;
                }
            }
            std::vector<Nal> nals;
            for (size_t k = 0; k < starts.size(); ++k)
            {
                size_t end = (k + 1 < starts.size()) ? starts[k + 1] - 3 : size;
                // Si el siguiente start code era largo (00 00 00 01), su primer 00 no es parte de este NAL.
                while (end > starts[k] && buf[end - 1] == 0)
                    --end;
                if (end > starts[k])
                    nals.push_back({buf + starts[k], end - starts[k]});
            }
            return nals;
        }

        // Añade un NAL precedido por su tamaño en 4 bytes big-endian (formato que espera el empaquetador).
        void append_length_prefixed(rtc::binary& out, const uint8_t* data, size_t size)
        {
            const auto len = static_cast<uint32_t>(size);
            out.push_back(std::byte(len >> 24));
            out.push_back(std::byte(len >> 16));
            out.push_back(std::byte(len >> 8));
            out.push_back(std::byte(len));
            const auto* bytes = reinterpret_cast<const std::byte*>(data);
            out.insert(out.end(), bytes, bytes + size);
        }

        void on_ctrl_c(int)
        {
            g_stop = true;
        }

        // Pide a la PS4 un fotograma completo (IDR). Como mucho uno cada 500 ms, porque el
        // navegador repite el pedido (PLI) varias veces por segundo mientras espera.
        // 'idr_mutex' también protege 'state.session', que cambia en cada reconexión.
        void request_keyframe(ServerState& state)
        {
            const auto now = std::chrono::steady_clock::now();
            std::lock_guard<std::mutex> lock(state.idr_mutex);
            if (!state.session || !state.ps4_connected)
                return;
            if (now - state.last_idr_request < std::chrono::milliseconds(500))
                return;
            state.last_idr_request = now;
            chiaki_session_request_idr(state.session);
            std::printf("[ps4] Pedido fotograma completo (IDR).\n");
        }

        // Crea la conexión WebRTC para un navegador recién conectado y le envía la oferta.
        void add_viewer(ServerState& state, std::shared_ptr<rtc::WebSocket> ws)
        {
            auto viewer = std::make_shared<Viewer>();
            viewer->ws = ws;
            viewer->pc = std::make_shared<rtc::PeerConnection>(rtc::Configuration{});

            // Track de video de solo envío con H.264.
            rtc::Description::Video media(kCname, rtc::Description::Direction::SendOnly);
            media.addH264Codec(kPayloadType, std::string(kH264Profile));
            media.addSSRC(kSsrc, std::string(kCname), std::string("ps4-stream"), std::string(kCname));
            viewer->track = viewer->pc->addTrack(media);

            // Cadena de procesamiento: H.264 -> paquetes RTP, + informes RTCP y reenvío de perdidos.
            viewer->rtp_config = std::make_shared<rtc::RtpPacketizationConfig>(
                kSsrc, kCname, kPayloadType, rtc::H264RtpPacketizer::defaultClockRate);
            // Le pasamos cada NAL precedido por su tamaño (4 bytes); ver to_length_prefixed().
            auto packetizer = std::make_shared<rtc::H264RtpPacketizer>(
                rtc::NalUnit::Separator::Length, viewer->rtp_config);
            auto handler = std::make_shared<rtc::H264PacketizationHandler>(packetizer);
            viewer->sr_reporter = std::make_shared<rtc::RtcpSrReporter>(viewer->rtp_config);
            handler->addToChain(viewer->sr_reporter);
            handler->addToChain(std::make_shared<rtc::RtcpNackResponder>());
            handler->addToChain(std::make_shared<KeyframeRequestHandler>([&state]() { request_keyframe(state); }));
            viewer->track->setMediaHandler(handler);

            std::weak_ptr<Viewer> weak = viewer;

            viewer->track->onOpen([&state]() {
                std::printf("[web] Track de video abierto. Pidiendo fotograma completo a la PS4.\n");
                request_keyframe(state);
            });

            viewer->pc->onStateChange([](rtc::PeerConnection::State s) {
                std::printf("[web] Estado WebRTC: %d\n", static_cast<int>(s));
            });

            // Sin trickle ICE: cuando terminamos de reunir candidatos, enviamos la oferta completa.
            viewer->pc->onGatheringStateChange([weak](rtc::PeerConnection::GatheringState gs) {
                auto v = weak.lock();
                if (!v || gs != rtc::PeerConnection::GatheringState::Complete)
                    return;
                if (auto desc = v->pc->localDescription())
                {
                    json offer = {{"type", "offer"}, {"sdp", std::string(*desc)}};
                    v->ws->send(offer.dump());
                    std::printf("[web] Oferta enviada al navegador.\n");
                }
            });

            ws->onMessage([weak](rtc::message_variant data) {
                auto v = weak.lock();
                if (!v || !std::holds_alternative<std::string>(data))
                    return;
                try
                {
                    const json message = json::parse(std::get<std::string>(data));
                    if (message.value("type", "") == "answer")
                    {
                        v->pc->setRemoteDescription(rtc::Description(message.at("sdp").get<std::string>(), "answer"));
                        std::printf("[web] Respuesta recibida del navegador.\n");
                    }
                }
                catch (const std::exception& e)
                {
                    std::printf("[web] Mensaje invalido: %s\n", e.what());
                }
            });

            ws->onClosed([&state, weak]() {
                std::lock_guard<std::mutex> lock(state.mutex);
                auto v = weak.lock();
                std::erase_if(state.viewers, [&](const auto& item) { return item == v; });
                std::printf("[web] Navegador desconectado. Quedan %zu.\n", state.viewers.size());
            });

            {
                std::lock_guard<std::mutex> lock(state.mutex);
                state.viewers.push_back(viewer);
            }

            viewer->pc->setLocalDescription(); // genera la oferta y empieza a reunir candidatos
        }

        // chiaki: un fotograma de video completo (H.264 Annex B). Se reenvía a todos los navegadores.
        bool on_video_sample(uint8_t* buf, size_t buf_size, int32_t /*frames_lost*/, bool /*recovered*/, void* user)
        {
            auto* state = static_cast<ServerState*>(user);
            state->frames++;

            const std::vector<Nal> nals = split_nals(buf, buf_size);
            bool has_idr = false, has_sps = false;
            for (const Nal& nal : nals)
            {
                if (nal.type() == 7) { state->sps.assign(nal.data, nal.data + nal.size); has_sps = true; }
                if (nal.type() == 8) state->pps.assign(nal.data, nal.data + nal.size);
                if (nal.type() == 5) has_idr = true;
            }
            if (has_idr)
                state->idr_frames++;

            // Fotograma para el empaquetador: si es IDR y no trae SPS/PPS, se los anteponemos.
            rtc::binary frame;
            frame.reserve(buf_size + 64);
            if (has_idr && !has_sps && !state->sps.empty() && !state->pps.empty())
            {
                append_length_prefixed(frame, state->sps.data(), state->sps.size());
                append_length_prefixed(frame, state->pps.data(), state->pps.size());
            }
            for (const Nal& nal : nals)
                append_length_prefixed(frame, nal.data, nal.size);

            const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - state->start).count();

            std::lock_guard<std::mutex> lock(state->mutex);
            for (const auto& viewer : state->viewers)
            {
                if (!viewer->track || !viewer->track->isOpen())
                    continue;
                auto& cfg = *viewer->rtp_config;
                cfg.timestamp = cfg.startTimestamp + cfg.secondsToTimestamp(elapsed);
                // Un informe de emisor (RTCP SR) por segundo ayuda al navegador a sincronizar.
                const uint32_t since_report = cfg.timestamp - viewer->sr_reporter->lastReportedTimestamp();
                if (cfg.timestampToSeconds(since_report) > 1.0)
                    viewer->sr_reporter->setNeedsToReport();
                try
                {
                    viewer->track->send(frame);
                }
                catch (const std::exception& e)
                {
                    std::printf("[web] Error enviando video: %s\n", e.what());
                }
            }
            return true;
        }

        void on_session_event(ChiakiEvent* event, void* user)
        {
            auto* state = static_cast<ServerState*>(user);
            if (event->type == CHIAKI_EVENT_CONNECTED)
            {
                std::printf("[ps4] Conectado. Transmitiendo.\n");
                state->ps4_connected = true;
            }
            else if (event->type == CHIAKI_EVENT_QUIT)
            {
                std::printf("[ps4] Sesion terminada: %s\n", chiaki_quit_reason_string(event->quit.reason));
                state->ps4_connected = false;
                state->session_ended = true;
            }
        }

        // Espera 'duration' en pasos cortos para poder salir enseguida con Ctrl+C.
        void wait_interruptible(std::chrono::milliseconds duration)
        {
            const auto until = std::chrono::steady_clock::now() + duration;
            while (!g_stop && std::chrono::steady_clock::now() < until)
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
        }

        // Ejecuta UNA sesión con la PS4: conecta, transmite y vuelve cuando la sesión termina
        // (o con Ctrl+C). Devuelve true si llegó a conectarse.
        bool run_session(ServerState& state, SessionConfig& config, ChiakiLog& log)
        {
            state.session_ended = false;
            state.ps4_connected = false;
            state.sps.clear(); // la nueva sesión trae su propio SPS/PPS al empezar
            state.pps.clear();

            ChiakiSession session;
            ChiakiErrorCode err = chiaki_session_init(&session, &config.info, &log);
            if (err != CHIAKI_ERR_SUCCESS)
            {
                std::printf("[ps4] chiaki_session_init fallo: %s\n", chiaki_error_string(err));
                return false;
            }
            chiaki_session_set_event_cb(&session, on_session_event, &state);
            chiaki_session_set_video_sample_cb(&session, on_video_sample, &state);

            std::printf("[ps4] Conectando con %s...\n", config.host.c_str());
            err = chiaki_session_start(&session);
            if (err != CHIAKI_ERR_SUCCESS)
            {
                std::printf("[ps4] chiaki_session_start fallo: %s\n", chiaki_error_string(err));
                chiaki_session_fini(&session);
                return false;
            }
            {
                std::lock_guard<std::mutex> lock(state.idr_mutex);
                state.session = &session;
            }

            bool connected = false;
            uint64_t last_frames = state.frames.load();
            auto last_report = std::chrono::steady_clock::now();
            while (!g_stop && !state.session_ended)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(200));
                connected = connected || state.ps4_connected;
                const auto now = std::chrono::steady_clock::now();
                if (now - last_report >= std::chrono::seconds(5))
                {
                    const uint64_t frames = state.frames.load();
                    size_t viewers = 0;
                    {
                        std::lock_guard<std::mutex> lock(state.mutex);
                        viewers = state.viewers.size();
                    }
                    if (state.ps4_connected)
                        std::printf("[stats] %.1f fps desde la PS4, %zu navegador(es)\n", (frames - last_frames) / 5.0, viewers);
                    last_frames = frames;
                    last_report = now;
                }
            }

            {
                std::lock_guard<std::mutex> lock(state.idr_mutex);
                state.session = nullptr;
                state.ps4_connected = false;
            }
            chiaki_session_stop(&session);
            chiaki_session_join(&session);
            chiaki_session_fini(&session);
            return connected;
        }
    }

    int cmd_serve(uint16_t port)
    {
        SessionConfig config;
        if (!load_session_config(config))
            return 1;

        rtc::InitLogger(rtc::LogLevel::Warning);

        ChiakiLog log;
        chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, nullptr);

        ServerState state;

        // 1. Servidor WebSocket de señalización (solo en esta máquina).
        rtc::WebSocketServer::Configuration ws_config;
        ws_config.port = port;
        ws_config.bindAddress = "127.0.0.1";
        auto server = std::make_unique<rtc::WebSocketServer>(ws_config);
        server->onClient([&state](std::shared_ptr<rtc::WebSocket> ws) {
            std::printf("[web] Navegador conectado.\n");
            ws->onOpen([&state, ws]() { add_viewer(state, ws); });
        });
        std::printf("[web] Esperando navegadores en ws://localhost:%u\n", static_cast<unsigned>(port));
        std::printf("      Abre http://localhost:3000/local-player  (Ctrl+C para salir)\n");

        // 2. Bucle de sesiones con la PS4: si se corta (cambio de perfil, reposo, red), reintenta
        //    con esperas crecientes (2, 4, 8, 16, 30 s...) y la despierta por si está en reposo.
        //    Los navegadores siguen conectados; al volver la PS4, el video sigue solo.
        std::signal(SIGINT, on_ctrl_c);
        int failures = 0;
        while (!g_stop)
        {
            const bool connected = run_session(state, config, log);
            if (g_stop)
                break;

            failures = connected ? 0 : failures + 1;
            // (std::min) entre paréntesis: windows.h define una macro "min" que choca con std::min.
            const int wait_s = (std::min)(30, 2 << (std::min)(failures, 4)); // 2, 4, 8, 16, 30 s
            std::printf("[ps4] Reintentando en %d s (intento %d). Ctrl+C para salir.\n", wait_s, failures + 1);

            if (config.wakeup_credential != 0)
            {
                // Señal de encendido: despierta la PS4 si está en reposo; si está encendida, la ignora.
                const ChiakiErrorCode err = chiaki_discovery_wakeup(&log, nullptr, config.host.c_str(),
                                                                    config.wakeup_credential, false);
                if (err != CHIAKI_ERR_SUCCESS)
                    std::printf("[ps4] No se pudo enviar la senal de encendido: %s\n", chiaki_error_string(err));
            }
            wait_interruptible(std::chrono::seconds(wait_s));
        }

        // 3. Cierre ordenado de la parte web.
        std::printf("Cerrando...\n");
        server->stop();
        {
            std::lock_guard<std::mutex> lock(state.mutex);
            for (auto& v : state.viewers)
                v->pc->close();
            state.viewers.clear();
        }
        return 0;
    }
}
