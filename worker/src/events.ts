// Registro de una partida y veredicto sugerido para los reclamos. Función pura, sin red ni base.
//
// video_on / video_off los informa el agente: el jugador no puede inventarlos. 'quality' lo mide el
// navegador del jugador, así que es solo una pista.

export type EventKind =
  | 'start' // empezó o retomó el turno
  | 'held' // el admin tomó el control
  | 'end' // detail: {result}
  | 'video_on'
  | 'video_off'
  | 'agent_off'
  | 'agent_on'
  | 'console_fault'
  | 'recovered' // terminó una falla nuestra
  | 'refund' // detail: {credits, manual}
  | 'quality' // detail: {rtt, loss, jitter, route}  route: 'directa', 'relé UDP', 'relé TCP'... o null

export type SessionEvent = { at: number; kind: EventKind; detail: Record<string, unknown> | null }

export type Verdict = 'ok' | 'ours' | 'player' | 'mixed' | 'noVideo' | 'poor' | 'noData'
export type Report = { verdict: Verdict; playerOffMs: number; outageMs: number; cuts: number; badSamples: number; samples: number }

export const RETENTION_MS = 90 * 86_400_000
const SHORT_CUT_MS = 15_000 // recargar la página o cambiar de red no cuenta como corte
const FIRST_VIDEO_MS = 60_000 // margen normal para que aparezca la imagen

export function isBad(detail: Record<string, unknown> | null): boolean {
  return Number(detail?.rtt) > 120 || Number(detail?.loss) > 3
}

export function analyze(list: SessionEvent[], endedAt: number): Report {
  const events = [...list].sort((a, b) => a.at - b.at)
  let playing = false
  let video = false
  let everVideo = false
  let agentOff = false
  let consoleOff = false
  let offFrom = 0 // desde cuándo no hay video
  let last = 0
  let cut = 0 // corte en curso, sin contar el tiempo de nuestras fallas
  const report: Report = { verdict: 'ok', playerOffMs: 0, outageMs: 0, cuts: 0, badSamples: 0, samples: 0 }
  const closeCut = () => {
    if (everVideo && cut >= SHORT_CUT_MS) {
      report.playerOffMs += cut
      report.cuts++
    }
    cut = 0
  }
  const advance = (now: number) => {
    const span = Math.max(0, now - last)
    if (playing) {
      if (agentOff || consoleOff) report.outageMs += span
      else if (!video && everVideo) cut += span
    }
    last = now
  }
  for (const e of events) {
    advance(e.at)
    switch (e.kind) {
      case 'start':
        playing = true
        video = false
        offFrom = e.at
        break
      case 'held':
      case 'end':
        closeCut()
        playing = false
        video = false
        agentOff = consoleOff = false
        break
      case 'video_on':
        // Al retomar un turno, conectar toma unos segundos: solo cuenta lo que pase del margen.
        if (everVideo && cut > 0 && cut === e.at - offFrom && cut < FIRST_VIDEO_MS) cut = 0
        closeCut()
        video = everVideo = true
        break
      case 'video_off':
        video = false
        offFrom = 0
        break
      case 'agent_off':
        agentOff = true
        video = false
        break
      case 'agent_on':
        agentOff = false
        offFrom = e.at // tras una caída nuestra, reconectar el video también toma unos segundos
        break
      case 'console_fault':
        consoleOff = true
        break
      case 'recovered':
        agentOff = consoleOff = false
        break
      case 'quality':
        report.samples++
        if (isBad(e.detail)) report.badSamples++
        break
    }
  }
  advance(endedAt)
  if (playing) closeCut()

  const ours = report.outageMs > 0
  const player = report.cuts > 0
  const known = events.some((e) => e.kind === 'start')
  if (!known) report.verdict = 'noData'
  else if (ours && player) report.verdict = 'mixed'
  else if (ours) report.verdict = 'ours'
  else if (!everVideo) report.verdict = 'noVideo'
  else if (player) report.verdict = 'player'
  else if (report.samples >= 4 && report.badSamples / report.samples >= 0.3) report.verdict = 'poor'
  return report
}
