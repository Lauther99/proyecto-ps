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
//
// Controles: canal de datos WebRTC "input" (sin orden ni reenvíos: si un paquete se pierde,
// el siguiente ya trae el estado completo). El navegador manda el estado del mando ~30 veces
// por segundo:
//   {"s":seq,"b":botones,"l2":0-255,"r2":0-255,"lx":..,"ly":..,"rx":..,"ry":..}
// Solo controla el primer navegador conectado (el "jugador"); los demás solo miran.
//
// La sesión con la PS4 se abre solo cuando hay navegadores, y se cierra 30 s después de que
// se va el último. Así el agente no le quita el control al mando físico cuando nadie juega.
#include "commands.hpp"
#include "session_config.hpp"
#include "env.hpp"
#include "youtube.hpp"

#include <chiaki/controller.h>
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

        // Track de audio: la PS4 ya envía Opus (48 kHz, estéreo, tramas de 10 ms), el mismo
        // códec que usa WebRTC, así que también se reenvía sin recodificar.
        constexpr uint8_t kAudioPayloadType = 111;
        constexpr uint32_t kAudioSsrc = 43;
        const char* const kAudioCname = "ps4-audio";
        // Mismo "msid" para audio y video: el navegador los trata como un solo stream sincronizado.
        const char* const kStreamId = "ps4-stream";

        // Un navegador conectado.
        struct Viewer
        {
            std::shared_ptr<rtc::WebSocket> ws;
            std::shared_ptr<rtc::PeerConnection> pc;
            std::shared_ptr<rtc::Track> track;
            std::shared_ptr<rtc::RtpPacketizationConfig> rtp_config;
            std::shared_ptr<rtc::RtcpSrReporter> sr_reporter;
            std::shared_ptr<rtc::Track> audio_track;
            std::shared_ptr<rtc::RtpPacketizationConfig> audio_rtp_config;
            std::shared_ptr<rtc::RtcpSrReporter> audio_sr_reporter;
            bool audio_started = false; // ¿ya se fijó la marca de tiempo inicial del audio?
            std::shared_ptr<rtc::DataChannel> input; // controles que manda el navegador
            int64_t last_input_seq = -1;             // para descartar paquetes que llegan tarde
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
            std::atomic<uint32_t> audio_frame_size{480}; // muestras por trama Opus (lo informa la PS4)
            // Transmisión a YouTube (solo con --youtube). Se crea antes de las sesiones y no cambia.
            std::unique_ptr<YoutubeStreamer> youtube;
            // Protege 'session' (cambia en cada reconexión) y todo lo que se le envía a la PS4.
            std::mutex session_mutex;
            std::chrono::steady_clock::time_point last_idr_request{};
            // Controles (protegidos por session_mutex).
            std::chrono::steady_clock::time_point last_input{};
            bool input_active = false; // ¿el último estado enviado tenía algo presionado?
        };

        // Si el jugador deja de mandar controles por este tiempo (pestaña oculta, red cortada),
        // soltamos todo para que ningún botón quede presionado.
        constexpr auto kInputTimeout = std::chrono::milliseconds(500);
        // Tiempo que la sesión sigue abierta sin navegadores, por si alguien recarga la página.
        constexpr auto kIdleSessionTimeout = std::chrono::seconds(30);

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
        // 'session_mutex' también protege 'state.session', que cambia en cada reconexión.
        void request_keyframe(ServerState& state)
        {
            const auto now = std::chrono::steady_clock::now();
            std::lock_guard<std::mutex> lock(state.session_mutex);
            if (!state.session || !state.ps4_connected)
                return;
            if (now - state.last_idr_request < std::chrono::milliseconds(500))
                return;
            state.last_idr_request = now;
            chiaki_session_request_idr(state.session);
            std::printf("[ps4] Pedido fotograma completo (IDR).\n");
        }

        // Envía un estado de mando a la PS4. Llamar con session_mutex tomado.
        void send_controller_state_locked(ServerState& state, ChiakiControllerState& controller)
        {
            if (state.session && state.ps4_connected)
                chiaki_session_set_controller_state(state.session, &controller);
        }

        // Suelta todos los botones y centra las palancas.
        void release_controls_locked(ServerState& state)
        {
            ChiakiControllerState idle;
            chiaki_controller_state_set_idle(&idle);
            send_controller_state_locked(state, idle);
            state.input_active = false;
        }

        int16_t clamp_axis(const json& value)
        {
            return static_cast<int16_t>((std::clamp)(value.get<int>(), -32767, 32767));
        }

        uint8_t clamp_trigger(const json& value)
        {
            return static_cast<uint8_t>((std::clamp)(value.get<int>(), 0, 255));
        }

        // Un mensaje del canal "input". Solo se aplica si viene del jugador.
        void on_input_message(ServerState& state, Viewer& viewer, const std::string& text)
        {
            // ¿Es el jugador? El primer navegador de la lista con el canal de controles abierto.
            {
                std::lock_guard<std::mutex> lock(state.mutex);
                Viewer* player = nullptr;
                for (const auto& v : state.viewers)
                    if (v->input && v->input->isOpen()) { player = v.get(); break; }
                if (player != &viewer)
                    return;
            }

            ChiakiControllerState controller;
            chiaki_controller_state_set_idle(&controller);
            try
            {
                const json msg = json::parse(text);
                const int64_t seq = msg.value("s", int64_t{0});
                if (seq <= viewer.last_input_seq)
                    return; // llegó tarde: ya aplicamos uno más nuevo
                viewer.last_input_seq = seq;

                // Filtro del botón PS: nadie puede salir del juego ni cambiar de perfil.
                const uint32_t buttons = msg.value("b", 0u) & 0xffffu & ~uint32_t(CHIAKI_CONTROLLER_BUTTON_PS);
                controller.buttons = buttons;
                controller.l2_state = clamp_trigger(msg.value("l2", json(0)));
                controller.r2_state = clamp_trigger(msg.value("r2", json(0)));
                controller.left_x = clamp_axis(msg.value("lx", json(0)));
                controller.left_y = clamp_axis(msg.value("ly", json(0)));
                controller.right_x = clamp_axis(msg.value("rx", json(0)));
                controller.right_y = clamp_axis(msg.value("ry", json(0)));
            }
            catch (const std::exception& e)
            {
                std::printf("[web] Control invalido: %s\n", e.what());
                return;
            }

            std::lock_guard<std::mutex> lock(state.session_mutex);
            state.last_input = std::chrono::steady_clock::now();
            state.input_active = true;
            send_controller_state_locked(state, controller);
        }

        // ¿Hace falta una sesión con la PS4? Sí si hay navegadores o si se transmite a YouTube.
        bool session_wanted(ServerState& state)
        {
            if (state.youtube)
                return true;
            std::lock_guard<std::mutex> lock(state.mutex);
            return !state.viewers.empty();
        }

        // Crea la conexión WebRTC para un navegador recién conectado y le envía la oferta.
        void add_viewer(ServerState& state, std::shared_ptr<rtc::WebSocket> ws)
        {
            auto viewer = std::make_shared<Viewer>();
            viewer->ws = ws;
            // Sin negociación automática: al crear el canal de controles, libdatachannel generaría
            // la oferta por su cuenta antes de que registremos los callbacks, y en red local la
            // reunión de candidatos termina tan rápido que nunca enviaríamos la oferta.
            rtc::Configuration pc_config;
            pc_config.disableAutoNegotiation = true;
            viewer->pc = std::make_shared<rtc::PeerConnection>(pc_config);

            // Track de video de solo envío con H.264.
            rtc::Description::Video media(kCname, rtc::Description::Direction::SendOnly);
            media.addH264Codec(kPayloadType, std::string(kH264Profile));
            media.addSSRC(kSsrc, std::string(kCname), std::string(kStreamId), std::string(kCname));
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

            // Track de audio de solo envío con Opus.
            rtc::Description::Audio audio_media(kAudioCname, rtc::Description::Direction::SendOnly);
            audio_media.addOpusCodec(kAudioPayloadType);
            audio_media.addSSRC(kAudioSsrc, std::string(kAudioCname), std::string(kStreamId), std::string(kAudioCname));
            viewer->audio_track = viewer->pc->addTrack(audio_media);

            viewer->audio_rtp_config = std::make_shared<rtc::RtpPacketizationConfig>(
                kAudioSsrc, kAudioCname, kAudioPayloadType, rtc::OpusRtpPacketizer::defaultClockRate);
            auto audio_handler = std::make_shared<rtc::OpusPacketizationHandler>(
                std::make_shared<rtc::OpusRtpPacketizer>(viewer->audio_rtp_config));
            viewer->audio_sr_reporter = std::make_shared<rtc::RtcpSrReporter>(viewer->audio_rtp_config);
            audio_handler->addToChain(viewer->audio_sr_reporter);
            viewer->audio_track->setMediaHandler(audio_handler);

            std::weak_ptr<Viewer> weak = viewer;

            // Canal de controles: sin orden y sin reenvíos (un estado viejo no sirve de nada).
            rtc::DataChannelInit input_init;
            input_init.reliability.type = rtc::Reliability::Type::Rexmit;
            input_init.reliability.unordered = true;
            input_init.reliability.rexmit = 0;
            viewer->input = viewer->pc->createDataChannel("input", input_init);
            viewer->input->onMessage([&state, weak](rtc::message_variant data) {
                auto v = weak.lock();
                if (v && std::holds_alternative<std::string>(data))
                    on_input_message(state, *v, std::get<std::string>(data));
            });

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

            // Copia para YouTube (ffmpeg la recodifica aparte; el jugador recibe el original).
            if (state->youtube)
                state->youtube->push_video(buf, buf_size, has_idr, state->sps.data(), state->sps.size(),
                                           state->pps.data(), state->pps.size());

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

        // chiaki: una trama de audio Opus (10 ms). Se reenvía tal cual a todos los navegadores.
        void on_audio_frame(uint8_t* buf, size_t buf_size, void* user)
        {
            auto* state = static_cast<ServerState*>(user);
            if (state->youtube)
                state->youtube->push_audio(buf, buf_size);
            // Mismo reloj que el video: así el navegador puede sincronizar audio e imagen.
            const double elapsed = std::chrono::duration<double>(std::chrono::steady_clock::now() - state->start).count();
            const rtc::binary frame(reinterpret_cast<const std::byte*>(buf), reinterpret_cast<const std::byte*>(buf) + buf_size);

            std::lock_guard<std::mutex> lock(state->mutex);
            for (const auto& viewer : state->viewers)
            {
                if (!viewer->audio_track || !viewer->audio_track->isOpen())
                    continue;
                auto& cfg = *viewer->audio_rtp_config;
                // La primera trama se ancla al reloj compartido con el video; desde ahí, cada
                // trama avanza exactamente su duración en muestras. Así no hay huecos ni solapes
                // aunque chiaki entregue las tramas en ráfagas.
                if (!viewer->audio_started)
                {
                    cfg.timestamp = cfg.startTimestamp + cfg.secondsToTimestamp(elapsed);
                    viewer->audio_started = true;
                }
                else
                {
                    cfg.timestamp += state->audio_frame_size.load();
                }
                const uint32_t since_report = cfg.timestamp - viewer->audio_sr_reporter->lastReportedTimestamp();
                if (cfg.timestampToSeconds(since_report) > 1.0)
                    viewer->audio_sr_reporter->setNeedsToReport();
                try
                {
                    viewer->audio_track->send(frame);
                }
                catch (const std::exception& e)
                {
                    std::printf("[web] Error enviando audio: %s\n", e.what());
                }
            }
        }

        void on_audio_header(ChiakiAudioHeader* header, void* user)
        {
            auto* state = static_cast<ServerState*>(user);
            if (header->frame_size > 0)
                state->audio_frame_size = header->frame_size;
            std::printf("[ps4] Audio: %u canales, %u Hz, tramas de %u muestras\n",
                static_cast<unsigned>(header->channels), static_cast<unsigned>(header->rate),
                static_cast<unsigned>(header->frame_size));
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

            // Buscamos la PS4 por su ID: si el router le dio otra IP, la usamos sin tocar archivos.
            const std::string ip = find_ps4_ip(config.host_id, config.host, 1500);
            if (!ip.empty() && ip != config.host)
            {
                std::printf("[ps4] La PS4 cambio de IP: %s -> %s\n", config.host.c_str(), ip.c_str());
                config.set_host(ip);
            }

            ChiakiSession session;
            ChiakiErrorCode err = chiaki_session_init(&session, &config.info, &log);
            if (err != CHIAKI_ERR_SUCCESS)
            {
                std::printf("[ps4] chiaki_session_init fallo: %s\n", chiaki_error_string(err));
                return false;
            }
            chiaki_session_set_event_cb(&session, on_session_event, &state);
            chiaki_session_set_video_sample_cb(&session, on_video_sample, &state);
            ChiakiAudioSink audio_sink{};
            audio_sink.user = &state;
            audio_sink.header_cb = on_audio_header;
            audio_sink.frame_cb = on_audio_frame;
            chiaki_session_set_audio_sink(&session, &audio_sink);

            std::printf("[ps4] Conectando con %s...\n", config.host.c_str());
            err = chiaki_session_start(&session);
            if (err != CHIAKI_ERR_SUCCESS)
            {
                std::printf("[ps4] chiaki_session_start fallo: %s\n", chiaki_error_string(err));
                chiaki_session_fini(&session);
                return false;
            }
            {
                std::lock_guard<std::mutex> lock(state.session_mutex);
                state.session = &session;
            }

            bool connected = false;
            uint64_t last_frames = state.frames.load();
            auto last_report = std::chrono::steady_clock::now();
            auto last_viewer_seen = std::chrono::steady_clock::now();
            while (!g_stop && !state.session_ended)
            {
                std::this_thread::sleep_for(std::chrono::milliseconds(100));
                connected = connected || state.ps4_connected;
                const auto now = std::chrono::steady_clock::now();

                // El jugador dejó de mandar controles: soltamos todo.
                {
                    std::lock_guard<std::mutex> lock(state.session_mutex);
                    if (state.input_active && now - state.last_input > kInputTimeout)
                    {
                        release_controls_locked(state);
                        std::printf("[web] Sin controles del jugador: botones soltados.\n");
                    }
                }

                // ffmpeg acaba de (re)conectarse y necesita un fotograma completo para empezar.
                if (state.youtube && state.youtube->wants_keyframe())
                    request_keyframe(state);

                size_t viewers = 0;
                {
                    std::lock_guard<std::mutex> lock(state.mutex);
                    viewers = state.viewers.size();
                }
                if (viewers > 0 || state.youtube)
                    last_viewer_seen = now;
                else if (now - last_viewer_seen > kIdleSessionTimeout)
                {
                    std::printf("[ps4] Nadie mirando hace %lld s: cerrando la sesion.\n",
                                static_cast<long long>(kIdleSessionTimeout.count()));
                    break;
                }

                if (now - last_report >= std::chrono::seconds(5))
                {
                    const uint64_t frames = state.frames.load();
                    if (state.ps4_connected)
                        std::printf("[stats] %.1f fps desde la PS4, %zu navegador(es)\n", (frames - last_frames) / 5.0, viewers);
                    last_frames = frames;
                    last_report = now;
                }
            }

            {
                std::lock_guard<std::mutex> lock(state.session_mutex);
                state.session = nullptr;
                state.ps4_connected = false;
                state.input_active = false;
            }
            chiaki_session_stop(&session);
            chiaki_session_join(&session);
            chiaki_session_fini(&session);
            return connected;
        }
    }

    int cmd_serve(uint16_t port, bool youtube)
    {
        SessionConfig config;
        if (!load_session_config(config))
            return 1;
        config.info.audio_video_disabled = CHIAKI_NONE_DISABLED; // serve envía video y audio

        rtc::InitLogger(rtc::LogLevel::Warning);

        ChiakiLog log;
        chiaki_log_init(&log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, chiaki_log_cb_print, nullptr);

        ServerState state;

        // 0. YouTube (solo con --youtube). Sin YOUTUBE_STREAM_KEY en .env se graba un archivo de
        //    prueba en vez de salir en vivo. La clave nunca se muestra en pantalla.
        if (youtube)
        {
            const EnvMap env = load_env();
            const std::string key = env_get(env, "YOUTUBE_STREAM_KEY");
            const std::string ffmpeg = env_get(env, "FFMPEG_PATH", "ffmpeg");
            const std::string encoder = env_get(env, "YOUTUBE_ENCODER", "auto");
            std::string output, display;
            if (!key.empty())
            {
                output = "rtmps://a.rtmps.youtube.com:443/live2/" + key;
                display = "YouTube Live (rtmps://a.rtmps.youtube.com/live2/****)";
            }
            else
            {
                output = env_get(env, "YOUTUBE_TEST_FILE", "youtube-test.mkv");
                display = "archivo de prueba " + output + " (no hay YOUTUBE_STREAM_KEY en .env)";
            }
            state.youtube = std::make_unique<YoutubeStreamer>(output, display, ffmpeg, encoder);
            state.youtube->start();
        }

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
            // Sesión bajo demanda: sin navegadores (ni YouTube) no conectamos, el mando físico sigue libre.
            if (!session_wanted(state))
            {
                std::printf("[ps4] Sin navegadores: la PS4 queda libre. Esperando...\n");
                while (!g_stop && !session_wanted(state))
                    std::this_thread::sleep_for(std::chrono::milliseconds(200));
                failures = 0;
                continue;
            }

            const bool connected = run_session(state, config, log);
            if (g_stop)
                break;
            if (!session_wanted(state))
                continue; // se cerró por falta de navegadores, no por error: no reintentamos

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
        if (state.youtube)
            state.youtube->stop();
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
