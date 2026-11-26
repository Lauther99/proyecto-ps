// Estadísticas del video recibido, calculadas cada segundo a partir de RTCPeerConnection.getStats().
// Los contadores de WebRTC son acumulados; aquí restamos la lectura anterior para obtener "por segundo".

export type StreamStats = {
  width: number
  height: number
  fpsReceived: number // fotogramas que llegaron completos
  fpsDecoded: number // fotogramas que el navegador decodificó
  fpsShown: number // fotogramas que el reproductor mostró (sin los descartados)
  droppedPerSecond: number // descartados por el navegador (no le dio el tiempo)
  packetsLostPerSecond: number
  freezes: number // congelamientos totales detectados por el navegador (Chrome)
  mbps: number
  bufferMs: number // retraso medio del búfer de reproducción (jitter buffer)
  rttMs: number | null // ida y vuelta de la red hasta el agente
  jitterMs: number // variación en la llegada de los paquetes de video
  lossPercent: number // paquetes de video perdidos en los últimos segundos
  route: Route | null // por el relé: cómo llega este navegador al relé (UDP es lo normal; TCP, si la red bloquea UDP)
  network: string | null // Wi-Fi, datos, cable (solo si el navegador lo informa)
}

export type Route = 'directa' | 'relé UDP' | 'relé TCP' | 'relé TLS' | 'relé'

export type RelayProtocol = 'UDP' | 'TCP' | 'TLS'

// Cómo llega este navegador al relé. Solo lo informa el candidato local; null si no es relé o no se sabe.
export function relayProtocolOf(local: { candidateType?: string; relayProtocol?: string } | undefined): RelayProtocol | null {
  const p = String(local?.relayProtocol ?? '').toUpperCase()
  return local?.candidateType === 'relay' && (p === 'UDP' || p === 'TCP' || p === 'TLS') ? p : null
}

// El par de candidatos en uso de una conexión (puede haber varios nominados; Firefox no siempre informa el seleccionado).
export async function localCandidateInUse(pc: RTCPeerConnection): Promise<Record<string, string> | undefined> {
  const report = await pc.getStats()
  let selectedId: string | null = null
  let nominatedId: string | null = null
  report.forEach((entry) => {
    if (entry.type === 'transport' && entry.selectedCandidatePairId) selectedId = entry.selectedCandidatePairId
    if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) nominatedId = entry.id
  })
  const pairId = selectedId ?? nominatedId
  const pair = pairId ? report.get(pairId) : null
  return pair ? report.get(pair.localCandidateId) : undefined
}

export type NetworkQuality = 'Buena' | 'Regular' | 'Mala'

// Manda el peor de los dos: ping o pérdida. Límites de partida, ajustar con pruebas reales.
export function networkQuality(rttMs: number, lossPercent: number): NetworkQuality {
  if (rttMs > 120 || lossPercent > 3) return 'Mala'
  if (rttMs > 60 || lossPercent >= 1) return 'Regular'
  return 'Buena'
}

const NETWORK_NAMES: Record<string, string> = { wifi: 'Wi-Fi', cellular: 'datos móviles', ethernet: 'cable' }

export function networkName(): string | null {
  const type = (navigator as Navigator & { connection?: { type?: string } }).connection?.type
  return (type && NETWORK_NAMES[type]) || null
}

const LOSS_WINDOW = 5 // lecturas (segundos) para promediar la pérdida y que el color no parpadee

type Previous = {
  time: number
  framesReceived: number
  framesDecoded: number
  bytes: number
  packetsLost: number
  packetsReceived: number
  jitterDelay: number
  jitterEmitted: number
  shownFrames: number
  droppedFrames: number
}

// Empieza a medir. Devuelve la función para detenerlo.
export function startStreamStats(
  pc: RTCPeerConnection,
  video: HTMLVideoElement,
  onStats: (stats: StreamStats | null) => void,
): () => void {
  let prev: Previous | null = null
  let stopped = false
  const lossHistory: { lost: number; received: number }[] = []

  const timer = window.setInterval(async () => {
    if (pc.connectionState !== 'connected') {
      // Sin conexión no mostramos un ping viejo como si fuera actual.
      prev = null
      lossHistory.length = 0
      onStats(null)
      return
    }
    const report = await pc.getStats()
    if (stopped) return
    let inbound: Record<string, number> | null = null
    let selectedId: string | null = null
    let nominatedId: string | null = null
    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') inbound = entry
      if (entry.type === 'transport' && entry.selectedCandidatePairId) selectedId = entry.selectedCandidatePairId
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) nominatedId = entry.id
    })
    if (!inbound) return

    // El par en uso (puede haber varios nominados); Firefox no siempre informa el seleccionado.
    const pairId = selectedId ?? nominatedId
    const pair = pairId ? report.get(pairId) : null
    const rttMs = typeof pair?.currentRoundTripTime === 'number' ? Math.round(pair.currentRoundTripTime * 1000) : null
    const ends = pair ? [report.get(pair.localCandidateId), report.get(pair.remoteCandidateId)] : []
    const relay = ends.find((c) => c?.candidateType === 'relay')
    const relayProtocol = relayProtocolOf(ends[0])
    const route: Route | null = !pair
      ? null
      : !relay
        ? 'directa'
        : relayProtocol === 'UDP' || relayProtocol === 'TCP' || relayProtocol === 'TLS'
          ? `relé ${relayProtocol}`
          : 'relé'
    const r = inbound as Record<string, number>

    const quality = video.getVideoPlaybackQuality()
    const now: Previous = {
      time: performance.now(),
      framesReceived: r.framesReceived ?? 0,
      framesDecoded: r.framesDecoded ?? 0,
      bytes: r.bytesReceived ?? 0,
      packetsLost: r.packetsLost ?? 0,
      packetsReceived: r.packetsReceived ?? 0,
      jitterDelay: r.jitterBufferDelay ?? 0,
      jitterEmitted: r.jitterBufferEmittedCount ?? 0,
      shownFrames: quality.totalVideoFrames - quality.droppedVideoFrames,
      droppedFrames: quality.droppedVideoFrames,
    }

    if (prev) {
      const seconds = (now.time - prev.time) / 1000
      const perSecond = (a: number, b: number) => Math.max(0, Math.round((a - b) / seconds))
      const emitted = now.jitterEmitted - prev.jitterEmitted
      lossHistory.push({
        lost: now.packetsLost - prev.packetsLost, // puede ser negativo si un paquete llegó tarde
        received: now.packetsReceived - prev.packetsReceived,
      })
      if (lossHistory.length > LOSS_WINDOW) lossHistory.shift()
      const lost = Math.max(0, lossHistory.reduce((sum, x) => sum + x.lost, 0))
      const received = lossHistory.reduce((sum, x) => sum + x.received, 0)
      onStats({
        width: r.frameWidth ?? 0,
        height: r.frameHeight ?? 0,
        fpsReceived: perSecond(now.framesReceived, prev.framesReceived),
        fpsDecoded: perSecond(now.framesDecoded, prev.framesDecoded),
        fpsShown: perSecond(now.shownFrames, prev.shownFrames),
        droppedPerSecond: perSecond(now.droppedFrames, prev.droppedFrames),
        packetsLostPerSecond: perSecond(now.packetsLost, prev.packetsLost),
        freezes: r.freezeCount ?? 0,
        mbps: Math.round(((now.bytes - prev.bytes) * 8) / seconds / 1e5) / 10,
        bufferMs: emitted > 0 ? Math.round(((now.jitterDelay - prev.jitterDelay) / emitted) * 1000) : 0,
        rttMs,
        jitterMs: Math.round((r.jitter ?? 0) * 1000),
        lossPercent: lost + received > 0 ? Math.round((lost / (lost + received)) * 1000) / 10 : 0,
        route,
        network: networkName(),
      })
    }
    prev = now
  }, 1000)

  return () => {
    stopped = true
    window.clearInterval(timer)
  }
}

// Diagnóstico de la conexión mientras no hay imagen. Solo tipos y contadores: sin IP ni credenciales.
export function startDiagnostics(pc: RTCPeerConnection, onLines: (lines: string[]) => void): () => void {
  const local: Record<string, number> = {}
  const errors: Record<string, number> = {}
  pc.addEventListener('icecandidate', ({ candidate }) => {
    if (!candidate?.candidate) return
    const label = `${candidate.type}/${candidate.protocol}`
    local[label] = (local[label] ?? 0) + 1
  })
  pc.addEventListener('icecandidateerror', (event) => {
    const code = String((event as RTCPeerConnectionIceErrorEvent).errorCode)
    errors[code] = (errors[code] ?? 0) + 1
  })
  const format = (counts: Record<string, number>) =>
    Object.entries(counts)
      .map(([key, n]) => `${key}×${n}`)
      .join(' ') || 'ninguno'

  const started = performance.now()
  let stopped = false
  const timer = window.setInterval(async () => {
    const remote: Record<string, number> = {}
    const pairs: Record<string, number> = {}
    let video = 'video: nada recibido'
    let pair = ''
    const report = await pc.getStats()
    if (stopped) return
    report.forEach((entry) => {
      if (entry.type === 'remote-candidate') {
        const label = `${entry.candidateType}/${entry.protocol}`
        remote[label] = (remote[label] ?? 0) + 1
      }
      if (entry.type === 'candidate-pair') {
        pairs[entry.state] = (pairs[entry.state] ?? 0) + 1
        if (entry.nominated && entry.state === 'succeeded') {
          const a = report.get(entry.localCandidateId)?.candidateType
          const b = report.get(entry.remoteCandidateId)?.candidateType
          pair = ` · ruta ${a}→${b}`
        }
      }
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') {
        const codec = report.get(entry.codecId)?.mimeType ?? '?'
        video = `video: ${entry.bytesReceived ?? 0} B · cuadros ${entry.framesReceived ?? 0}/${entry.framesDecoded ?? 0} · ${codec}`
      }
    })
    onLines([
      `${Math.round((performance.now() - started) / 1000)} s · ICE ${pc.iceConnectionState} · DTLS/WebRTC ${pc.connectionState}`,
      `candidatos: ${pc.iceGatheringState}${pair}`,
      `celular/PC: ${format(local)}`,
      `agente: ${format(remote)}`,
      `pares: ${format(pairs)}`,
      `errores STUN/TURN: ${format(errors)}`,
      video,
    ])
  }, 1000)

  return () => {
    stopped = true
    window.clearInterval(timer)
    onLines([])
  }
}
