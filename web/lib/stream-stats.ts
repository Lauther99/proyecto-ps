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
}

type Previous = {
  time: number
  framesReceived: number
  framesDecoded: number
  bytes: number
  packetsLost: number
  jitterDelay: number
  jitterEmitted: number
  shownFrames: number
  droppedFrames: number
}

// Empieza a medir. Devuelve la función para detenerlo.
export function startStreamStats(
  pc: RTCPeerConnection,
  video: HTMLVideoElement,
  onStats: (stats: StreamStats) => void,
): () => void {
  let prev: Previous | null = null

  const timer = window.setInterval(async () => {
    if (pc.connectionState !== 'connected') return
    const report = await pc.getStats()
    let inbound: Record<string, number> | null = null
    let rttMs: number | null = null
    report.forEach((entry) => {
      if (entry.type === 'inbound-rtp' && entry.kind === 'video') inbound = entry
      if (entry.type === 'candidate-pair' && entry.state === 'succeeded' && entry.nominated) {
        if (typeof entry.currentRoundTripTime === 'number') rttMs = Math.round(entry.currentRoundTripTime * 1000)
      }
    })
    if (!inbound) return
    const r = inbound as Record<string, number>

    const quality = video.getVideoPlaybackQuality()
    const now: Previous = {
      time: performance.now(),
      framesReceived: r.framesReceived ?? 0,
      framesDecoded: r.framesDecoded ?? 0,
      bytes: r.bytesReceived ?? 0,
      packetsLost: r.packetsLost ?? 0,
      jitterDelay: r.jitterBufferDelay ?? 0,
      jitterEmitted: r.jitterBufferEmittedCount ?? 0,
      shownFrames: quality.totalVideoFrames - quality.droppedVideoFrames,
      droppedFrames: quality.droppedVideoFrames,
    }

    if (prev) {
      const seconds = (now.time - prev.time) / 1000
      const perSecond = (a: number, b: number) => Math.max(0, Math.round((a - b) / seconds))
      const emitted = now.jitterEmitted - prev.jitterEmitted
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
      })
    }
    prev = now
  }, 1000)

  return () => window.clearInterval(timer)
}
