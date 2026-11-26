'use client'

// Conexión WebRTC con el agente: recibe video y audio de la consola y manda los controles.
// No sabe por dónde viaja la señalización (local o sala de Cloudflare): lo recibe en 'signaling'.
// Sin "trickle ICE": cada lado espera a reunir sus candidatos y envía la descripción completa.

import { useEffect, useRef, useState } from 'react'
import { startControllerInput, type InputSource } from './controller-input'
import { applyLatencyMode, loadLatencyMode, saveLatencyMode, type LatencyMode } from './latency-mode'
import type { Signaling } from './signaling'
import { startDiagnostics, startStreamStats, type StreamStats } from './stream-stats'

export type PlayerStatus = 'esperando oferta' | 'negociando' | 'conectando' | 'reproduciendo' | 'desconectado' | 'error'

// En datos móviles algunos servidores TURN no responden y reunir todos los candidatos tarda mucho.
// Respondemos a los 1,5 s con lo que haya; si aún no hay ningún relé, esperamos hasta 8 s.
const GATHER_SOFT_MS = 1500
const GATHER_HARD_MS = 8000
// Si no hay conexión, se pide una oferta nueva cada tanto. Negociar toma hasta 8 s: mientras tanto
// no se pide otra, porque reiniciaría la conexión a medio hacer.
const RETRY_MS = 4000
// Si la red se congela justo al reconectar, este límite es lo que se tarda en volver a intentar.
const CONNECTING_LIMIT_MS = 10_000

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    const started = performance.now()
    const timer = window.setInterval(() => {
      const elapsed = performance.now() - started
      const hasRelay = pc.localDescription?.sdp.includes(' typ relay') ?? false
      const done =
        pc.iceGatheringState === 'complete' ||
        pc.signalingState === 'closed' ||
        (elapsed >= GATHER_SOFT_MS && hasRelay) ||
        elapsed >= GATHER_HARD_MS
      if (!done) return
      window.clearInterval(timer)
      resolve()
    }, 50)
  })
}

export function usePlayer(signaling: Signaling, iceServers?: RTCIceServer[]) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatusState] = useState<PlayerStatus>('esperando oferta')
  const statusRef = useRef<{ value: PlayerStatus; since: number }>({ value: 'esperando oferta', since: 0 })
  const [detail, setDetail] = useState('')
  const [inputSource, setInputSource] = useState<InputSource>('ninguno')
  const [stats, setStats] = useState<StreamStats | null>(null)
  const [diagnostics, setDiagnostics] = useState<string[]>([])
  const [muted, setMuted] = useState(true)
  // Veces que se cortó la conexión de video en esta visita (para ver si la red es intermitente).
  const [drops, setDrops] = useState(0)

  // Baja latencia o estable: se recuerda en este navegador y se puede cambiar mientras se juega.
  const [latencyMode, setLatencyMode] = useState<LatencyMode>(loadLatencyMode)
  const latencyModeRef = useRef(latencyMode)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const changeLatencyMode = (next: LatencyMode) => {
    latencyModeRef.current = next
    setLatencyMode(next)
    saveLatencyMode(next)
    if (peerRef.current) applyLatencyMode(peerRef.current, next)
  }

  const setStatus = (value: PlayerStatus) => {
    if (statusRef.current.value === value) return
    statusRef.current = { value, since: performance.now() }
    setStatusState(value)
  }

  // Los navegadores solo permiten sonido después de un clic del usuario.
  const setVolume = (volume: number) => {
    const video = videoRef.current
    if (!video) return
    video.volume = volume
    video.muted = volume === 0
    setMuted(video.muted)
    void video.play().catch(() => undefined)
  }

  const onPlaying = () => setStatus('reproduciendo')

  useEffect(() => {
    let pc: RTCPeerConnection | null = null
    let stopInput: (() => void) | null = null
    let stopStats: (() => void) | null = null
    let stopDiagnostics: (() => void) | null = null

    const closePeer = () => {
      stopStats?.()
      stopInput?.()
      stopDiagnostics?.()
      stopStats = stopInput = stopDiagnostics = null
      setStats(null)
      pc?.close()
      pc = peerRef.current = null
    }

    // Cada oferta del agente (al entrar, o si el agente reinició la sesión) crea una conexión nueva.
    const newPeer = () => {
      closePeer()
      const peer = new RTCPeerConnection({ iceServers })
      let wasConnected = false
      pc = peerRef.current = peer
      stopDiagnostics = startDiagnostics(peer, setDiagnostics)
      // Solo en desarrollo: deja la conexión accesible desde la consola para depurar (window.pc).
      if (process.env.NODE_ENV !== 'production') (window as unknown as { pc?: RTCPeerConnection }).pc = peer

      peer.ontrack = (event) => {
        applyLatencyMode(peer, latencyModeRef.current)
        const video = videoRef.current
        if (video && event.streams[0]) {
          video.srcObject = event.streams[0]
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
        if (pc !== peer) return
        setDetail(`WebRTC: ${peer.connectionState}`)
        if ((peer.connectionState === 'disconnected' || peer.connectionState === 'failed') && wasConnected) setDrops((n) => n + 1)
        wasConnected = peer.connectionState === 'connected'
        if (peer.connectionState === 'failed') setStatus('desconectado')
        // "disconnected" puede volver solo; si lo hace, el video sigue sin otro evento "playing".
        if (peer.connectionState === 'connected' && statusRef.current.value === 'desconectado') setStatus('reproduciendo')
        if (peer.connectionState === 'disconnected' && statusRef.current.value === 'reproduciendo') setStatus('desconectado')
      }
      return peer
    }

    const session = signaling({
      onSignal: async (message) => {
        if (message.type !== 'offer' || !message.sdp) return
        let peer: RTCPeerConnection | null = null
        try {
          setStatus('negociando')
          peer = newPeer()
          await peer.setRemoteDescription({ type: 'offer', sdp: message.sdp })
          await peer.setLocalDescription(await peer.createAnswer())
          await waitForIceGathering(peer)
          if (pc !== peer) return // llegó otra oferta mientras tanto
          session.send({ type: 'answer', sdp: peer.localDescription?.sdp })
          if (statusRef.current.value === 'negociando') setStatus('conectando')
        } catch (err) {
          if (peer && pc !== peer) return // el error es de una conexión ya reemplazada
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
    const readyRetry = setInterval(() => {
      const { value, since } = statusRef.current
      const age = performance.now() - since
      const waiting = (value === 'esperando oferta' || value === 'desconectado' || value === 'error') && age > RETRY_MS / 2
      const stuck = value === 'conectando' && age > CONNECTING_LIMIT_MS
      if (waiting || stuck) session.send({ type: 'ready' })
    }, RETRY_MS)

    return () => {
      clearInterval(readyRetry)
      session.stop()
      closePeer()
    }
  }, [signaling, iceServers])

  return { videoRef, status, detail, inputSource, stats, diagnostics, drops, muted, setVolume, latencyMode, changeLatencyMode, onPlaying }
}
