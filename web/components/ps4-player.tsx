'use client'

// Reproductor WebRTC: recibe video y audio de la PS4 desde el agente y le manda los controles.
// No sabe por dónde viaja la señalización (local o sala de Cloudflare): lo recibe en 'signaling'.
// Sin "trickle ICE": cada lado espera a reunir sus candidatos y envía la descripción completa.

import { useEffect, useRef, useState } from 'react'
import { startControllerInput, type InputSource } from '@/lib/controller-input'
import type { Signaling } from '@/lib/signaling'
import { startStreamStats, type StreamStats } from '@/lib/stream-stats'

type Status = 'esperando oferta' | 'negociando' | 'reproduciendo' | 'desconectado' | 'error'

type Props = {
  signaling: Signaling
  iceServers?: RTCIceServer[]
  // Contenido extra en la barra de abajo (por ejemplo, la cuenta regresiva del turno).
  children?: React.ReactNode
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check)
        resolve()
      }
    }
    pc.addEventListener('icegatheringstatechange', check)
  })
}

const buttonClass = 'rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700'

export default function Ps4Player({ signaling, iceServers, children }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('esperando oferta')
  const [detail, setDetail] = useState('')
  // Los navegadores solo permiten sonido después de un clic del usuario.
  const [muted, setMuted] = useState(true)
  const [inputSource, setInputSource] = useState<InputSource>('ninguno')
  const [stats, setStats] = useState<StreamStats | null>(null)
  const [showStats, setShowStats] = useState(true)

  // Pantalla completa del contenedor del video (Esc para salir, lo maneja el navegador).
  const screenRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === screenRef.current)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void screenRef.current?.requestFullscreen()
  }

  const toggleSound = () => {
    const video = videoRef.current
    if (!video) return
    video.muted = !video.muted
    setMuted(video.muted)
    void video.play()
  }

  useEffect(() => {
    let pc: RTCPeerConnection | null = null
    let stopInput: (() => void) | null = null
    let stopStats: (() => void) | null = null

    const closePeer = () => {
      stopStats?.()
      stopInput?.()
      stopStats = stopInput = null
      pc?.close()
      pc = null
    }

    // Cada oferta del agente (al entrar, o si el agente reinició la sesión) crea una conexión nueva.
    const newPeer = () => {
      closePeer()
      const peer = new RTCPeerConnection({ iceServers })
      pc = peer
      // Solo en desarrollo: deja la conexión accesible desde la consola para depurar (window.pc).
      if (process.env.NODE_ENV !== 'production') (window as unknown as { pc?: RTCPeerConnection }).pc = peer

      peer.ontrack = (event) => {
        const video = videoRef.current
        if (video && event.streams[0]) {
          video.srcObject = event.streams[0]
          setStatus('reproduciendo')
          stopStats ??= startStreamStats(peer, video, setStats)
        }
      }
      // El agente abre el canal "input": por ahí mandamos el mando y el teclado.
      peer.ondatachannel = (event) => {
        if (event.channel.label !== 'input') return
        stopInput?.()
        stopInput = startControllerInput(event.channel, setInputSource)
      }
      peer.onconnectionstatechange = () => {
        setDetail(`WebRTC: ${peer.connectionState}`)
        if (peer.connectionState === 'failed') setStatus('desconectado')
      }
      return peer
    }

    const session = signaling({
      onSignal: async (message) => {
        if (message.type !== 'offer' || !message.sdp) return
        try {
          setStatus('negociando')
          const peer = newPeer()
          await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp })
          await peer.setLocalDescription(await peer.createAnswer())
          await waitForIceGathering(peer)
          if (pc !== peer) return // llegó otra oferta mientras tanto
          session.send({ type: 'answer', sdp: peer.localDescription?.sdp })
        } catch (err) {
          setStatus('error')
          setDetail(String(err))
        }
      },
      onError: (text) => {
        setStatus('error')
        setDetail(text)
      },
    })
    // Pide una oferta al agente (si ya mandó una antes de que montáramos, manda otra).
    session.send({ type: 'ready' })
    const readyRetry = setTimeout(() => session.send({ type: 'ready' }), 1500)

    return () => {
      clearTimeout(readyRetry)
      session.stop()
      closePeer()
    }
  }, [signaling, iceServers])

  return (
    <div className="flex w-full flex-col gap-3">
      <div ref={screenRef} className="relative bg-black" onDoubleClick={toggleFullscreen}>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className={fullscreen ? 'h-screen w-screen object-contain' : 'aspect-video w-full rounded-lg bg-black'}
        />
        {showStats && stats && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-xs leading-5 text-zinc-100">
            <div>
              {stats.width}×{stats.height} · {stats.mbps} Mbps
            </div>
            <div>
              fps: llegan {stats.fpsReceived} · decodif. {stats.fpsDecoded} · mostrados {stats.fpsShown}
            </div>
            <div className={stats.droppedPerSecond > 0 || stats.packetsLostPerSecond > 0 ? 'text-amber-300' : ''}>
              descartados {stats.droppedPerSecond}/s · paquetes perdidos {stats.packetsLostPerSecond}/s · congelados{' '}
              {stats.freezes}
            </div>
            <div>
              búfer {stats.bufferMs} ms{stats.rttMs !== null && ` · red ida y vuelta ${stats.rttMs} ms`}
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Estado: <span className="font-medium text-zinc-200">{status}</span>
          {detail && <span className="ml-2">({detail})</span>}
          <span className="ml-4">
            Control: <span className="font-medium text-zinc-200">{inputSource}</span>
          </span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {children}
          <button type="button" onClick={() => setShowStats((v) => !v)} className={buttonClass}>
            {showStats ? 'Ocultar estadísticas' : 'Estadísticas'}
          </button>
          <button type="button" onClick={toggleFullscreen} className={buttonClass}>
            Pantalla completa
          </button>
          <button type="button" onClick={toggleSound} className={buttonClass}>
            {muted ? 'Activar sonido' : 'Silenciar'}
          </button>
        </div>
      </div>
    </div>
  )
}
