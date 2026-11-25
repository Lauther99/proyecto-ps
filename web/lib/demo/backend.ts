// Backend simulado en el navegador. SOLO desarrollo (npm run dev:demo): permite ver y probar todos los
// estados sin Worker, agente ni consola. No entra en el build de producción. Cumple web/API.md.

import { ApiError, type AdminRecharge, type AdminUser, type Game, type Movement, type Notice, type PlaySession, type RechargeStatus, type RoomAction, type SessionResult, type SiteConfig, type User } from '../api'
import { creditosDe } from '../config'
import { guardarMedicion } from '../conexion'
import type { QueueMember, Room, RoomMessage, RoomState } from '../room-client'
import { abrirVideo } from './video'

export const DIMENSIONES = {
  usuario: { visitante: 'Visitante', conSaldo: 'Con saldo', sinSaldo: 'Sin saldo', enCola: 'En cola', turnoOfrecido: 'Turno ofrecido', turnoVencido: 'Turno vencido', jugando: 'Jugando', reconectando: 'Reconectando', interrumpida: 'Sesión interrumpida', bloqueado: 'Bloqueado' },
  consola: { ocupada: 'Ocupada', libre: 'Libre', apagada: 'Apagada', mantenimiento: 'En mantenimiento' },
  directo: { vivo: 'En vivo', caido: 'No disponible' },
  general: { normal: 'Normal', carga: 'Carga', vacio: 'Vacío', error: 'Error', sinConexion: 'Sin conexión' },
  conexion: { buena: 'Buena', regular: 'Regular', mala: 'Mala', sinProbar: 'Sin probar' },
  recarga: { ninguna: 'Ninguna', pendiente: 'Pendiente', aprobada: 'Aprobada', rechazada: 'Rechazada' },
  tiempo: { normal: 'Normal', cinco: 'Quedan 5 min', uno: 'Queda 1 min' },
  rol: { admin: 'Admin', jugador: 'Jugador' },
} as const
type D = typeof DIMENSIONES
export type Escenario = { [K in keyof D]: keyof D[K] }
export const INICIAL: Escenario = { usuario: 'conSaldo', consola: 'ocupada', directo: 'vivo', general: 'normal', conexion: 'buena', recarga: 'ninguna', tiempo: 'normal', rol: 'admin' }
const CLAVE = 'wlg-demo'

const YO = 'yo'
const MIN = 60_000
const OTROS: QueueMember[] = [
  { userId: 'u2', name: 'Kiara_gg', minutes: 30 },
  { userId: 'u3', name: 'ElDeBreña', minutes: 60 },
]

class Demo {
  e: Escenario = { ...INICIAL }
  version = 0
  oyentes = new Set<() => void>()
  salas = new Set<DemoRoom>()
  entro = true
  nickname = 'Lucho_23'
  balance = { available: 0, reserved: 0 }
  notice: Notice | null = null
  s!: RoomState
  turno = { minutes: 30, charged: 15 }
  recharges: AdminRecharge[] = []
  movements: Movement[] = []
  sessions: (PlaySession & { nickname: string })[] = []
  users: AdminUser[] = []
  games: Game[] = []
  config!: SiteConfig

  constructor() {
    if (typeof window === 'undefined') return
    const guardado: Record<string, unknown> = {}
    try {
      Object.assign(guardado, JSON.parse(sessionStorage.getItem(CLAVE) ?? '{}'))
    } catch {}
    new URLSearchParams(window.location.search).forEach((v, k) => (guardado[k] = v))
    for (const [k, v] of Object.entries(guardado))
      if (k in DIMENSIONES && typeof v === 'string' && v in DIMENSIONES[k as keyof D]) (this.e as Record<string, string>)[k] = v
    this.armar()
    setInterval(() => this.reloj(), 1000)
  }

  poner(cambio: Partial<Escenario>) {
    this.e = { ...this.e, ...cambio }
    try {
      sessionStorage.setItem(CLAVE, JSON.stringify(this.e))
    } catch {}
    this.armar()
    this.version++
    this.oyentes.forEach((f) => f())
  }

  // Construye el estado que corresponde al escenario elegido.
  private armar() {
    const { usuario: u, consola, general, recarga, tiempo, conexion } = this.e
    const ahora = Date.now()
    const vacio = general === 'vacio'
    this.entro = u !== 'visitante'
    const reservado = u === 'enCola' || u === 'turnoOfrecido'
    this.balance = { available: u === 'sinSaldo' ? 5 : reservado ? 30 : 45, reserved: reservado ? 15 : 0 }
    this.notice = u === 'turnoVencido' ? { kind: 'expired' } : u === 'interrumpida' ? { kind: 'interrupted', refundedCredits: 11, unplayedMinutes: 22 } : null
    const mio = u === 'jugando' || u === 'reconectando'
    const yo: QueueMember = { userId: YO, name: this.nickname, minutes: 30 }
    const resta = mio && tiempo === 'cinco' ? 5 * MIN : mio && tiempo === 'uno' ? MIN : 22 * MIN
    const hayTurno = mio || (consola === 'ocupada' && u !== 'turnoOfrecido') || (u === 'enCola' && consola === 'libre')
    const apagada = consola === 'apagada'
    this.s = {
      queue: vacio || (consola === 'libre' && u !== 'enCola') ? [] : u === 'enCola' ? [OTROS[0], yo, OTROS[1]] : [...OTROS],
      current: hayTurno && !vacio ? { userId: mio ? YO : 'u9', name: mio ? this.nickname : 'Chalaca07', isAdmin: false, startedAt: ahora - 8 * MIN, endsAt: ahora + resta } : null,
      offer: u === 'turnoOfrecido' ? { ...yo, expiresAt: ahora + 47_000 } : null,
      paused: consola === 'mantenimiento',
      youtube: this.e.directo === 'vivo',
      agentOnline: !apagada,
      ps4Connected: hayTurno,
      now: ahora,
    }
    if (consola === 'mantenimiento' && !mio) this.s.current = null
    this.turno = { minutes: 30, charged: 15 }
    this.config = { blockMinutes: 30, blockCredits: 15, maxMinutes: 120, acceptSeconds: 60, yapeHolder: 'Titular de ejemplo', yapeNumber: '900 000 000', yapeQrUrl: null, youtubeChannelId: 'demo' }
    const r = (id: string, nickname: string, amount: number, operation: string, horas: number, status: RechargeStatus, reason: string | null = null, repeated = false): AdminRecharge => ({ id, nickname, amount, operation, createdAt: ahora - horas * 60 * MIN, status, reason, repeated })
    const estados = { pendiente: 'pending', aprobada: 'approved', rechazada: 'rejected' } as const
    this.recharges = vacio ? [] : [
      ...(recarga === 'ninguna' ? [] : [r('r0', this.nickname, 30, '04925518', 0.2, estados[recarga], recarga === 'rechazada' ? 'No encontramos un pago con ese número de operación' : null)]),
      r('r1', 'Nina.pe', 15, '04817263', 0.5, 'pending', null, true),
      r('r2', 'ElDeBreña', 60, '04924870', 1, 'pending'),
      r('r3', this.nickname, 30, '04817263', 150, 'approved'),
      r('r4', 'Chalaca07', 15, '04900011', 26, 'rejected', 'No encontramos el pago'),
    ]
    this.movements = vacio ? [] : [
      { id: 'm1', createdAt: ahora - 40 * 60 * MIN, detail: 'Devolución por falla de la consola', credits: 11 },
      { id: 'm2', createdAt: ahora - 41 * 60 * MIN, detail: 'Sesión de 30 min', credits: -15 },
      { id: 'm3', createdAt: ahora - 150 * 60 * MIN, detail: 'Recarga aprobada', credits: 30 },
    ]
    const ses = (id: string, nickname: string, horas: number, min: number, result: SessionResult, refunded = 0) => ({ id, nickname, startedAt: ahora - horas * 60 * MIN, game: 'Partida libre', playedMs: min * MIN, chargedCredits: 15, refundedCredits: refunded, result })
    this.sessions = vacio ? [] : [u === 'interrumpida' ? ses('s1', this.nickname, 1, 8, 'interrupted', 11) : ses('s1', this.nickname, 1, 30, 'complete'), ses('s2', 'Kiara_gg', 3, 30, 'complete'), ses('s3', 'Nina.pe', 5, 19, 'left')]
    const us = (id: string, nickname: string, available: number, status: 'approved' | 'blocked' = 'approved'): AdminUser => ({ id, nickname, email: `${id}@ejemplo.test`, available, status, role: 'player' })
    this.users = vacio ? [] : [{ ...us(YO, this.nickname, this.balance.available), role: 'admin' }, us('u2', 'Kiara_gg', 30), us('u3', 'ElDeBreña', 0), us('u4', 'Spammer_99', 5, 'blocked')]
    this.games = vacio ? [] : [
      { id: 'g1', name: 'Juego de ejemplo 1', genre: 'Fútbol', players: 2, status: 'available', art: ['..XXXX..', '.X.XX.X.', 'X.XXXX.X', 'XXXXXXXX', 'XX.XX.XX', 'X..XX..X', '.XX..XX.', '..XXXX..'] },
      { id: 'g2', name: 'Juego de ejemplo 2', genre: 'Carreras', players: 2, status: 'soon' },
      { id: 'g3', name: 'Juego de ejemplo 3', genre: 'Aventura', players: 1, status: 'unavailable' },
    ]
    const med = { buena: [32, 4, 0], regular: [86, 14, 1], mala: [184, 41, 5] }
    guardarMedicion(conexion === 'sinProbar' ? null : { ping: med[conexion][0], jitter: med[conexion][1], fallos: med[conexion][2], calidad: conexion, hora: ahora })
  }

  room() {
    return new DemoRoom(this)
  }

  emitir(m: RoomMessage) {
    this.salas.forEach((r) => r.emitir(m))
  }

  avisar() {
    this.s.now = Date.now()
    this.emitir({ type: 'state', state: structuredClone(this.s) })
    this.emitir({ type: 'me' })
  }

  private mover(detail: string, credits: number) {
    this.movements.unshift({ id: crypto.randomUUID(), createdAt: Date.now(), detail, credits })
  }

  private soltarReserva() {
    this.balance = { available: this.balance.available + this.balance.reserved, reserved: 0 }
  }

  private avanzar() {
    const s = this.s
    if (s.current || s.offer || s.paused || !s.agentOnline || !s.queue.length) return
    const [p, ...resto] = s.queue
    s.queue = resto
    if (p.userId === YO) s.offer = { ...p, expiresAt: Date.now() + this.config.acceptSeconds * 1000 }
    else s.current = { userId: p.userId, name: p.name, isAdmin: false, startedAt: Date.now(), endsAt: Date.now() + p.minutes * MIN }
  }

  private acabar(result: SessionResult) {
    const c = this.s.current
    if (c?.userId === YO && c.endsAt !== null)
      this.sessions.unshift({ id: crypto.randomUUID(), nickname: this.nickname, startedAt: c.startedAt, game: 'Partida libre', playedMs: Date.now() - c.startedAt, chargedCredits: this.turno.charged, refundedCredits: 0, result })
    this.s.current = null
    this.avanzar()
  }

  private reloj() {
    const ahora = Date.now()
    if (this.s.offer && ahora >= this.s.offer.expiresAt) {
      this.s.offer = null
      this.soltarReserva()
      this.notice = { kind: 'expired' }
      this.avanzar()
      this.avisar()
    } else if (this.s.current?.endsAt && ahora >= this.s.current.endsAt) {
      this.acabar('complete')
      this.avisar()
    }
  }

  async handle(ruta: string, metodo: string, cuerpo: unknown): Promise<unknown> {
    const path = ruta.split('?')[0]
    if (path === '/api/health') {
      const [base, varia] = { buena: [30, 8], regular: [90, 16], mala: [180, 60], sinProbar: [30, 8] }[this.e.conexion]
      await new Promise((ok) => setTimeout(ok, base + Math.random() * varia))
      return { ok: true }
    }
    if (this.e.general === 'carga') return new Promise(() => undefined)
    await new Promise((ok) => setTimeout(ok, 150))
    if (this.e.general === 'error') throw new ApiError('El servicio no responde. Intenta otra vez.', 500)
    return metodo === 'GET' ? this.leer(path, ruta) : this.escribir(path, (cuerpo ?? {}) as Record<string, never>)
  }

  private leer(path: string, ruta: string): unknown {
    const mias = this.recharges.filter((r) => r.nickname === this.nickname)
    const pendientes = this.recharges.filter((r) => r.status === 'pending')
    const bloqueado = this.e.usuario === 'bloqueado'
    const user: User = { id: YO, email: 'lucho@ejemplo.test', name: 'Lucho', nickname: this.nickname, picture: null, status: bloqueado ? 'blocked' : 'approved', blockedReason: bloqueado ? 'Uso indebido de la cuenta' : null, role: this.e.rol === 'admin' ? 'admin' : 'player', balance: { ...this.balance }, notice: this.notice }
    switch (path) {
      case '/api/site': return structuredClone({ config: this.config, rooms: this.e.general === 'vacio' ? [] : [{ id: 'sala-1', name: 'Sala 1', console: 'PS4', game: 'Partida libre' }], games: this.games })
      case '/api/me': return { user: this.entro ? user : null, devLogin: false }
      case '/api/turn': return { iceServers: [] }
      case '/api/recharges': return structuredClone({ recharges: mias })
      case '/api/movements': return structuredClone({ movements: this.movements })
      case '/api/sessions': return structuredClone({ sessions: this.sessions.filter((s) => s.nickname === this.nickname) })
      case '/api/admin/summary': return { agentLastSeen: Date.now() - 6 * MIN, pendingRecharges: pendientes.length, repeatedRecharges: pendientes.filter((r) => r.repeated).length, income: this.e.general === 'vacio' ? [] : [{ period: 'today', recharges: 4, soles: 105, playedMs: 210 * MIN }, { period: 'week', recharges: 19, soles: 480, playedMs: 930 * MIN }, { period: 'month', recharges: 61, soles: 1530, playedMs: 2970 * MIN }] }
      case '/api/admin/recharges': return structuredClone({ recharges: this.recharges.filter((r) => r.status === new URLSearchParams(ruta.split('?')[1]).get('status')) })
      case '/api/admin/users': return structuredClone({ users: this.users })
      case '/api/admin/sessions': return structuredClone({ sessions: this.sessions })
      case '/api/admin/games': return structuredClone({ games: this.games })
    }
    throw new ApiError('No encontrado', 404)
  }

  private escribir(path: string, b: Record<string, never>): unknown {
    const s = this.s
    const c = b as unknown as { minutes: number; amount: number; operation: string; nickname: string; status: string; reason: string; role: 'admin' | 'player'; delta: number }
    const id = path.split('/')[4]
    if (path === '/api/auth/demo') {
      this.entro = true
      this.balance = { available: 45, reserved: 0 }
      if (this.e.usuario === 'visitante') this.e = { ...this.e, usuario: 'conSaldo' }
    } else if (path === '/api/auth/logout') {
      s.queue = s.queue.filter((p) => p.userId !== YO)
      this.entro = false
    } else if (path === '/api/me') {
      this.recharges.forEach((r) => { if (r.nickname === this.nickname) r.nickname = c.nickname })
      this.sessions.forEach((r) => { if (r.nickname === this.nickname) r.nickname = c.nickname })
      this.nickname = c.nickname
    } else if (path === '/api/me/notice/dismiss') this.notice = null
    else if (path === '/api/queue/join') {
      const costo = creditosDe(this.config, c.minutes)
      if (costo > this.balance.available) throw new ApiError('No tienes créditos suficientes.', 409)
      this.notice = null
      this.turno = { minutes: c.minutes, charged: costo }
      this.balance = { available: this.balance.available - costo, reserved: costo }
      s.queue.push({ userId: YO, name: this.nickname, minutes: c.minutes })
      this.avanzar()
    } else if (path === '/api/queue/leave' || path === '/api/turn/decline') {
      s.queue = s.queue.filter((p) => p.userId !== YO)
      s.offer = null
      this.soltarReserva()
      this.avanzar()
    } else if (path === '/api/turn/accept') {
      if (!s.offer) throw new ApiError('Tu turno ya venció.', 409)
      this.mover(`Sesión de ${s.offer.minutes} min`, -this.balance.reserved)
      this.balance.reserved = 0
      s.current = { userId: YO, name: this.nickname, isAdmin: false, startedAt: Date.now(), endsAt: Date.now() + s.offer.minutes * MIN }
      s.offer = null
    } else if (path === '/api/turn/end') this.acabar('left')
    else if (path === '/api/recharges') {
      if (this.recharges.some((r) => r.operation === c.operation && r.status === 'pending' && r.nickname === this.nickname)) throw new ApiError('Ya enviaste ese número de operación.', 409)
      const recharge: AdminRecharge = { id: crypto.randomUUID(), nickname: this.nickname, amount: c.amount, operation: c.operation, createdAt: Date.now(), status: 'pending', reason: null, repeated: this.recharges.some((r) => r.operation === c.operation) }
      this.recharges.unshift(recharge)
      return { recharge: { ...recharge } }
    } else if (path.startsWith('/api/admin/recharges/')) {
      const r = this.recharges.find((x) => x.id === id)
      if (!r || r.status !== 'pending') throw new ApiError('Esa recarga ya fue resuelta.', 409)
      r.status = c.status as RechargeStatus
      r.reason = c.reason ?? null
      if (r.status === 'approved' && r.nickname === this.nickname) {
        this.balance.available += r.amount
        this.mover('Recarga aprobada', r.amount)
      }
    } else if (path.startsWith('/api/admin/users/')) {
      const u = this.users.find((x) => x.id === id)
      if (!u) throw new ApiError('No existe', 404)
      if (path.endsWith('/balance')) {
        u.available += c.delta
        if (u.id === YO) this.balance.available += c.delta
      } else if (c.role) u.role = c.role
      else u.status = c.status as 'approved' | 'blocked'
    } else if (path.startsWith('/api/admin/games/')) {
      const g = this.games.find((x) => x.id === id)
      if (g) g.status = c.status as Game['status']
    } else if (path === '/api/admin/config') Object.assign(this.config, b)
    else if (path === '/api/admin/room') this.admin(b as unknown as RoomAction)
    else if (!path.endsWith('/rating')) throw new ApiError('No encontrado', 404)
    setTimeout(() => this.avisar())
    return null
  }

  private admin(a: RoomAction) {
    const s = this.s
    if (a.action === 'take') {
      if (s.current) s.queue.unshift({ userId: s.current.userId, name: s.current.name, minutes: Math.ceil(((s.current.endsAt ?? Date.now()) - Date.now()) / MIN) })
      s.current = { userId: YO, name: this.nickname, isAdmin: true, startedAt: Date.now(), endsAt: null }
    } else if (a.action === 'release') this.acabar('left')
    else if (a.action === 'skip') this.acabar('skipped')
    else if (a.action === 'pause') s.paused = true
    else if (a.action === 'resume') {
      s.paused = false
      this.avanzar()
    } else if (a.action === 'youtube') s.youtube = a.on
    else if (a.action === 'reorder') s.queue = a.userIds.flatMap((id) => s.queue.filter((p) => p.userId === id))
  }
}

class DemoRoom implements Room {
  private oyentes = new Set<(m: RoomMessage) => void>()
  private estados = new Set<(ok: boolean) => void>()
  private cerrarVideo: (() => void) | null = null
  private responder: ((sdp: string) => void) | null = null

  constructor(private d: Demo) {}

  connect() {
    this.d.salas.add(this)
    if (this.d.e.general === 'carga' || this.d.e.general === 'error') return
    setTimeout(() => {
      if (!this.d.salas.has(this)) return
      this.emitir({ type: 'state', state: { ...structuredClone(this.d.s), now: Date.now() } })
      const ok = this.d.e.general !== 'sinConexion' && this.d.e.usuario !== 'reconectando'
      this.estados.forEach((f) => f(ok))
    }, 200)
  }

  close() {
    this.d.salas.delete(this)
    this.cerrarVideo?.()
  }

  // Hace de agente: manda un video de prueba por una conexión WebRTC de verdad, dentro de la página.
  send(message: object) {
    const m = message as { type: string; data?: { type: string; sdp?: string } }
    if (m.type !== 'signal' || this.d.e.usuario === 'reconectando') return
    if (m.data?.type === 'answer' && m.data.sdp) this.responder?.(m.data.sdp)
    if (m.data?.type === 'ready') {
      this.cerrarVideo?.()
      const v = abrirVideo((sdp) => this.emitir({ type: 'signal', data: { type: 'offer', sdp } }))
      this.cerrarVideo = v.cerrar
      this.responder = v.responder
    }
  }

  emitir(m: RoomMessage) {
    this.oyentes.forEach((f) => f(m))
  }

  onMessage(f: (m: RoomMessage) => void) {
    this.oyentes.add(f)
    return () => this.oyentes.delete(f)
  }

  onStatus(f: (ok: boolean) => void) {
    this.estados.add(f)
    return () => this.estados.delete(f)
  }
}

export const demo = new Demo()
