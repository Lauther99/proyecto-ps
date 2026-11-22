'use client'

// Reproductor WebRTC: recibe el video de la PS4 desde el agente.
// Señalización (versión local): WebSocket con el agente.
//   agente -> navegador: { type: "offer", sdp }
//   navegador -> agente: { type: "answer", sdp }
// Sin "trickle ICE": cada lado espera a reunir sus candidatos y envía la descripción completa.

import { useEffect, useRef, useState } from 'react'
import { startControllerInput, type InputSource } from '@/lib/controller-input'
import { startStreamStats, type StreamStats } from '@/lib/stream-stats'

type Status = 'conectando' | 'negociando' | 'reproduciendo' | 'desconectado' | 'error'

type Props = {
  signalingUrl: string
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

export default function Ps4Player({ signalingUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<Status>('conectando')
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
    const ws = new WebSocket(signalingUrl)
    const pc = new RTCPeerConnection()
    // Solo en desarrollo: deja la conexión accesible desde la consola para depurar (window.pc).
    if (process.env.NODE_ENV !== 'production') (window as unknown as { pc?: RTCPeerConnection }).pc = pc

    let stopStats: (() => void) | null = null
    pc.ontrack = (event) => {
      const video = videoRef.current
      if (video && event.streams[0]) {
        video.srcObject = event.streams[0]
        setStatus('reproduciendo')
        stopStats ??= startStreamStats(pc, video, setStats)
      }
    }

    // El agente abre el canal "input": por ahí mandamos el mando y el teclado.
    let stopInput: (() => void) | null = null
    pc.ondatachannel = (event) => {
      if (event.channel.label !== 'input') return
      stopInput?.()
      stopInput = startControllerInput(event.channel, setInputSource)
    }

    pc.onconnectionstatechange = () => {
      setDetail(`WebRTC: ${pc.connectionState}`)
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') setStatus('desconectado')
    }

    ws.onmessage = async (event) => {
      try {
        const message = JSON.parse(event.data as string)
        if (message.type !== 'offer') return
        setStatus('negociando')
        await pc.setRemoteDescription({ type: 'offer', sdp: message.sdp })
        const answer = await pc.createAnswer()
        await pc.setLocalDescription(answer)
        await waitForIceGathering(pc)
        ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription?.sdp }))
      } catch (err) {
        setStatus('error')
        setDetail(String(err))
      }
    }

    ws.onerror = () => {
      setStatus('error')
      setDetail(`No se pudo conectar a ${signalingUrl}. ¿Está corriendo "ps4-agent serve"?`)
    }

    ws.onclose = () => setStatus((current) => (current === 'reproduciendo' ? current : 'desconectado'))

    return () => {
      stopStats?.()
      stopInput?.()
      ws.close()
      pc.close()
    }
  }, [signalingUrl])

  return (
    <div className="flex w-full max-w-5xl flex-col gap-3">
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
              descartados {stats.droppedPerSecond}/s · paquetes perdidos {stats.packetsLostPerSecond}/s · congelados {stats.freezes}
            </div>
            <div>
              búfer {stats.bufferMs} ms{stats.rttMs !== null && ` · red ida y vuelta ${stats.rttMs} ms`}
            </div>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-500">
          Estado: <span className="font-medium text-zinc-200">{status}</span>
          {detail && <span className="ml-2">({detail})</span>}
          <span className="ml-4">
            Control: <span className="font-medium text-zinc-200">{inputSource}</span>
          </span>
        </p>
        <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setShowStats((v) => !v)}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          {showStats ? 'Ocultar estadísticas' : 'Estadísticas'}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          Pantalla completa
        </button>
        <button
          type="button"
          onClick={toggleSound}
          className="rounded-md bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          {muted ? 'Activar sonido' : 'Silenciar'}
        </button>
        </div>
      </div>
    </div>
  )
}
