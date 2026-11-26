// Llamadas HTTP al backend. Todas van a /api/* del mismo dominio.
// Los tipos de este archivo son el contrato que el backend (etapas 3 y 4) debe cumplir. Ver web/API.md.

export type UserStatus = 'pending' | 'approved' | 'blocked'
export type UserRole = 'player' | 'admin'

// Aviso personal: queda visible hasta que el usuario lo cierra o vuelve a la cola.
export type Notice =
  | { kind: 'expired' }
  | { kind: 'interrupted'; refundedCredits: number; unplayedMinutes: number }

export type User = {
  id: string
  email: string
  name: string
  nickname: string
  picture: string | null
  status: UserStatus
  blockedReason: string | null
  role: UserRole
  balance: { available: number; reserved: number }
  notice: Notice | null
}

export type GameStatus = 'available' | 'soon' | 'unavailable'
export type Game = { id: string; name: string; genre: string; players: number; status: GameStatus; art?: string[] }

export type SiteConfig = {
  blockMinutes: number
  blockCredits: number
  maxMinutes: number
  acceptSeconds: number
  yapeHolder: string
  yapeNumber: string
  yapeQrUrl: string | null
  youtubeChannelId: string | null
}

export type RoomInfo = { id: string; name: string; console: string; game: string }
export type Site = { config: SiteConfig; rooms: RoomInfo[]; games: Game[] }

export type RechargeStatus = 'pending' | 'approved' | 'rejected'
export type Recharge = { id: string; amount: number; operation: string; createdAt: number; status: RechargeStatus; reason: string | null }
export type Movement = { id: string; createdAt: number; detail: string; credits: number }
export type SessionResult = 'complete' | 'left' | 'interrupted' | 'skipped'
export type PlaySession = {
  id: string
  startedAt: number
  game: string
  playedMs: number
  chargedCredits: number
  refundedCredits: number
  result: SessionResult
}

export type AdminUser = Pick<User, 'id' | 'email' | 'nickname' | 'status' | 'role'> & { available: number; manualRefunds: number }
export type AdminRecharge = Recharge & { nickname: string; repeated: boolean }
export type AdminSession = PlaySession & { nickname: string }
export type SessionEvent = { at: number; kind: string; detail: Record<string, unknown> | null }
export type SessionReport = {
  events: SessionEvent[]
  report: {
    verdict: 'ok' | 'ours' | 'player' | 'mixed' | 'noVideo' | 'poor' | 'noData'
    playerOffMs: number
    outageMs: number
    cuts: number
    badSamples: number
    samples: number
  }
}
export type AdminSummary = {
  agentLastSeen: number | null
  pendingRecharges: number
  repeatedRecharges: number
  income: { period: 'today' | 'week' | 'month'; recharges: number; soles: number; playedMs: number }[]
}
export type RoomAction =
  | { action: 'take' | 'release' | 'pause' | 'resume' }
  | { action: 'skip'; reason: string }
  | { action: 'reorder'; userIds: string[] }
  | { action: 'refund'; minutes: number; reason: string }
  | { action: 'youtube'; on: boolean }

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

// Modo demo: backend simulado en el navegador, solo en desarrollo (npm run dev:demo).
export const DEMO = process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEMO === '1'

export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_DEMO === '1') {
    const { demo } = await import('./demo/backend')
    return (await demo.handle(path, method, body)) as T
  }
  let res: Response
  try {
    res = await fetch(path, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
  } catch {
    throw new ApiError('No pudimos conectarnos. Revisa tu internet e intenta otra vez.', 0)
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null
    throw new ApiError(data?.error ?? `No se pudo completar (error ${res.status}).`, res.status)
  }
  return (res.status === 204 ? null : await res.json()) as T
}

const post = <T = null>(path: string, body: unknown = {}) => request<T>(path, 'POST', body)

// --- sitio y sesión ---
export const fetchSite = () => request<Site>('/api/site')

// 'user' es null si no hay sesión; 'devLogin' indica si el login de pruebas (solo local) está activo.
export async function fetchMe(): Promise<{ user: User | null; devLogin: boolean }> {
  if (DEMO) return request('/api/me')
  const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
  if (res.status === 401 || res.ok) return res.json()
  throw new ApiError(`No se pudo consultar la sesión (${res.status})`, res.status)
}
export const loginUrl = (next: string) => `/api/auth/google/login?next=${encodeURIComponent(next)}`
export const devLogin = (email: string, name: string) => post('/api/auth/dev-login', { email, name })
export const logout = () => post('/api/auth/logout')
export const updateNickname = (nickname: string) => post('/api/me', { nickname })
export const dismissNotice = () => post('/api/me/notice/dismiss')

// --- cola y turno ---
export const joinQueue = (minutes: number) => post('/api/queue/join', { minutes })
export const leaveQueue = () => post('/api/queue/leave')
export const acceptTurn = () => post('/api/turn/accept')
export const declineTurn = () => post('/api/turn/decline')
export const endTurn = () => post('/api/turn/end')
export const fetchIceServers = async () => (await request<{ iceServers: IceServer[] }>('/api/turn')).iceServers
export const fetchTestIceServers = async () => (await request<{ iceServers: IceServer[] }>('/api/turn/test')).iceServers

// --- créditos e historial ---
export const createRecharge = (amount: number, operation: string, key: string) =>
  post<{ recharge: Recharge }>('/api/recharges', { amount, operation, key })
export const rateSession = (id: string, score: number, problems: string[]) => post(`/api/sessions/${id}/rating`, { score, problems })

// --- admin ---
export const resolveRecharge = (id: string, change: { status: 'approved' } | { status: 'rejected'; reason: string }) =>
  post(`/api/admin/recharges/${id}`, change)
export const updateUser = (id: string, change: { status: 'approved' | 'blocked'; reason: string } | { role: UserRole }) =>
  post(`/api/admin/users/${id}`, change)
export const adjustBalance = (id: string, delta: number, reason: string) => post(`/api/admin/users/${id}/balance`, { delta, reason })
export const refundSession = (id: string, credits: number, reason: string, key: string) => post(`/api/admin/sessions/${id}/refund`, { credits, reason, key })
export const updateRoom = (id: string, room: Omit<RoomInfo, 'id'>) => post(`/api/admin/rooms/${id}`, room)
export const roomAction = (action: RoomAction) => post('/api/admin/room', action)
export const updateGame = (id: string, status: GameStatus) => post(`/api/admin/games/${id}`, { status })
export const updateConfig = (config: Omit<SiteConfig, 'yapeQrUrl'>) => post('/api/admin/config', config)
