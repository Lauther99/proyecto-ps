// Conexión WebSocket con la sala (Durable Object). Se reconecta sola si se corta y avisa de cada
// mensaje a quien esté escuchando. El protocolo está documentado en worker/src/room.ts.

export type Member = { userId: string; name: string }

export type RoomState = {
  queue: Member[]
  current: (Member & { isAdmin: boolean; startedAt: number; endsAt: number | null }) | null
  offer: (Member & { expiresAt: number }) | null
  paused: boolean
  turnMinutes: number
  youtube: boolean
  ps4Connected: boolean
  agentOnline: boolean
  now: number // reloj del servidor al enviar el estado
}

export type Me = { userId: string; name: string; isAdmin: boolean }

export type RoomMessage =
  | { type: 'hello'; me: Me }
  | { type: 'state'; state: RoomState }
  | { type: 'signal'; data: unknown }
  | { type: 'error'; message: string }

export type AdminAction = 'skip' | 'take' | 'release' | 'pause' | 'resume' | 'turnMinutes' | 'youtube'

type Listener = (message: RoomMessage) => void

// En desarrollo, Next corre en :3000 y el backend en :8787. El WebSocket va directo al backend
// (las cookies de localhost se comparten entre puertos). En producción, mismo dominio.
function roomUrl(): string {
  const { protocol, hostname, port, host } = window.location
  if (hostname === 'localhost' && port === '3000') return 'ws://localhost:8787/api/room/ws'
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/api/room/ws`
}

export class RoomClient {
  private ws: WebSocket | null = null
  private listeners = new Set<Listener>()
  private statusListeners = new Set<(connected: boolean) => void>()
  private retry = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pingTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  connected = false

  connect() {
    this.closed = false
    const ws = new WebSocket(roomUrl())
    this.ws = ws
    ws.onopen = () => {
      this.retry = 0
      this.setConnected(true)
      // "ping" lo responde Cloudflare sin despertar a la sala; mantiene viva la conexión.
      this.pingTimer = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 25_000)
    }
    ws.onmessage = (event) => {
      if (event.data === 'pong') return
      try {
        const message = JSON.parse(event.data as string) as RoomMessage
        for (const listener of this.listeners) listener(message)
      } catch {
        // mensaje inválido: lo ignoramos
      }
    }
    ws.onclose = () => {
      if (this.pingTimer) clearInterval(this.pingTimer)
      this.setConnected(false)
      if (this.closed) return
      // Reintento con espera creciente: 1, 2, 4, 8, 10 s...
      const delay = Math.min(10_000, 1000 * 2 ** this.retry++)
      this.retryTimer = setTimeout(() => this.connect(), delay)
    }
  }

  close() {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    this.ws?.close()
  }

  send(message: object) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message))
  }

  admin(action: AdminAction, value?: unknown) {
    this.send({ type: 'admin', action, value })
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
    this.connected = value
    for (const listener of this.statusListeners) listener(value)
  }
}
