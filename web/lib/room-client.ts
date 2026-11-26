// Conexión WebSocket con la sala (Durable Object). Se reconecta sola si se corta y avisa de cada
// mensaje a quien esté escuchando. La conexión es pública: un visitante recibe el estado, y solo el
// jugador actual puede intercambiar señales WebRTC. Contrato en web/API.md.

export type QueueMember = { userId: string; name: string; minutes: number }

export type RoomState = {
  queue: QueueMember[]
  current: { userId: string; name: string; isAdmin: boolean; startedAt: number; endsAt: number | null } | null
  offer: (QueueMember & { expiresAt: number }) | null
  paused: boolean
  youtube: boolean
  agentOnline: boolean
  // La sesión con la consola es bajo demanda: ps4Connected es false también cuando nadie juega. No
  // sirve para saber si está apagada; para eso está consoleOff.
  ps4Connected: boolean
  consoleOff?: boolean
  // Falla nuestra en curso: el reloj del turno se detuvo en 'since'; en 'until' se devuelve lo no jugado.
  outage?: { since: number; until: number } | null
  now: number // reloj del servidor al enviar el estado
}

export type RoomMessage =
  | { type: 'state'; state: RoomState }
  | { type: 'me' } // cambió mi saldo, mi aviso o mi cuenta: volver a pedir /api/me
  | { type: 'signal'; data: unknown }
  | { type: 'error'; message: string }

type Listener = (message: RoomMessage) => void

export interface Room {
  connect(): void
  close(): void
  send(message: object): void
  onMessage(listener: Listener): () => void
  onStatus(listener: (connected: boolean) => void): () => void
}

// En desarrollo, Next corre en :3000 y el backend en :8787. El WebSocket va directo al backend
// (las cookies de localhost se comparten entre puertos). En producción, mismo dominio.
function roomUrl(): string {
  const { protocol, hostname, port, host } = window.location
  if (hostname === 'localhost' && port === '3000') return 'ws://localhost:8787/api/room/ws'
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/room/ws`
}

export class RoomClient implements Room {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(connected: boolean) => void>()
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null

  connect() {
    this.close()
    const ws = new WebSocket(roomUrl())
    this.ws = ws
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.retry = 0
      this.setConnected(true)
      // "ping" lo responde Cloudflare sin despertar a la sala; mantiene viva la conexión.
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
    }
    ws.onmessage = (event) => {
      if (this.ws !== ws || event.data === 'pong') return
      let message: RoomMessage
      try {
        message = JSON.parse(event.data as string) as RoomMessage
      } catch {
        return // mensaje inválido: lo ignoramos
      }
      for (const listener of this.listeners) listener(message)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.setConnected(false)
      // Reintento con espera creciente: 1, 2, 4, 8, 10 s...
      const delay = Math.min(10_000, 1000 * 2 ** this.retry++)
      this.retryTimer = setTimeout(() => this.connect(), delay)
    }
  }

  close() {
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    const ws = this.ws
    this.ws = null
    ws?.close()
  }

  send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  onMessage(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  onStatus(listener: (connected: boolean) => void): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  private setConnected(value: boolean) {
    for (const listener of this.statusListeners) listener(value)
  }
}
