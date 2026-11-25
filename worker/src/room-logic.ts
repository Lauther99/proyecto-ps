// Reglas de la sala como funciones puras (sin red, sin reloj, sin base de datos): reciben el estado y
// devuelven la lista de cambios. room.ts los guarda en D1 de una sola vez y avisa a los navegadores.
//
//   queued -> offered (tiene acceptSeconds para aceptar) -> playing -> done
//
// El admin puede tomar el control: el jugador detenido vuelve primero a la cola, ya pagado y con el
// tiempo que le faltaba.

export const OUTAGE_GRACE_MS = 90_000 // espera por una falla nuestra antes de devolver lo no jugado

export type BookingStatus = 'queued' | 'offered' | 'playing' | 'done' | 'cancelled' | 'expired'
export type Result = 'complete' | 'left' | 'interrupted' | 'skipped'

export type Booking = {
  id: string
  userId: string
  name: string
  status: BookingStatus
  position: number
  minutes: number
  credits: number
  charged: boolean
  remainingMs: number // lo que faltaba al empezar el tramo en curso
  offerExpiresAt: number | null
  startedAt: number | null
  segmentAt: number | null
  endsAt: number | null
  outageAt: number | null
  playedMs: number
  refunded: number
}

export type State = {
  bookings: Booking[] // solo las activas
  paused: boolean
  control: { userId: string; name: string; since: number } | null
  youtube: boolean
  agentOnline: boolean
  acceptSeconds: number
}

export type Notice = { kind: 'expired' } | { kind: 'interrupted'; refundedCredits: number; unplayedMinutes: number }

export type BookingSet = Partial<Omit<Booking, 'id' | 'userId' | 'name'>> & { result?: Result; endedAt?: number }
export type LedgerEntry = {
  opKey: string
  userId: string
  kind: 'release' | 'charge' | 'refund'
  available: number
  reserved: number
  bookingId: string
  detail: string
  actorId?: string
}
export type Change =
  | { type: 'booking'; id: string; from: BookingStatus; set: BookingSet }
  | { type: 'ledger'; entry: LedgerEntry }
  | { type: 'notice'; userId: string; notice: Notice }
  | { type: 'room'; set: { paused?: boolean; pauseCause?: 'admin' | 'fault' | null; control?: State['control']; youtube?: boolean } }

export class RuleError extends Error {
  readonly status: number
  constructor(message: string, status = 409) {
    super(message)
    this.status = status
  }
}

export const playing = (s: State) => s.bookings.find((b) => b.status === 'playing') ?? null
export const offered = (s: State) => s.bookings.find((b) => b.status === 'offered') ?? null
export const queue = (s: State) => s.bookings.filter((b) => b.status === 'queued').sort((a, b) => a.position - b.position)
export const bookingOf = (s: State, userId: string) => s.bookings.find((b) => b.userId === userId) ?? null

// Créditos que corresponden a un tiempo no jugado, a favor del usuario y sin pasar de lo cobrado.
export function refundFor(b: Booking, ms: number): number {
  return Math.min(Math.ceil((b.credits * Math.max(0, ms)) / (b.minutes * 60_000)), b.credits - b.refunded)
}

// Aplica los cambios sobre una copia del estado (lo mismo que quedará en la base).
export function applyChanges(s: State, changes: Change[]): State {
  const next: State = { ...s, bookings: s.bookings.map((b) => ({ ...b })) }
  for (const c of changes) {
    if (c.type === 'booking') {
      const b = next.bookings.find((x) => x.id === c.id)
      if (b) Object.assign(b, c.set)
    } else if (c.type === 'room') {
      if (c.set.paused !== undefined) next.paused = c.set.paused
      if (c.set.control !== undefined) next.control = c.set.control
      if (c.set.youtube !== undefined) next.youtube = c.set.youtube
    }
  }
  next.bookings = next.bookings.filter((b) => b.status === 'queued' || b.status === 'offered' || b.status === 'playing')
  return next
}

// Agrega al final el siguiente paso automático: ofrecer el turno al primero de la cola.
function advance(s: State, changes: Change[], now: number): Change[] {
  const after = applyChanges(s, changes)
  if (after.paused || after.control || !after.agentOnline || playing(after) || offered(after)) return changes
  const first = queue(after)[0]
  if (!first) return changes
  return [...changes, { type: 'booking', id: first.id, from: 'queued', set: { status: 'offered', offerExpiresAt: now + after.acceptSeconds * 1000 } }]
}

export const next = (s: State, now: number): Change[] => advance(s, [], now)

// Tiempo jugado y restante del tramo en curso. Durante una falla, el reloj se detiene en outageAt.
function settle(b: Booking, now: number) {
  const left = Math.min(b.remainingMs, Math.max(0, (b.endsAt ?? 0) - Math.min(now, b.outageAt ?? now)))
  return { remainingMs: left, playedMs: b.playedMs + (b.remainingMs - left) }
}

function finish(b: Booking, now: number, result: Result): Change[] {
  return [{ type: 'booking', id: b.id, from: 'playing', set: { status: 'done', ...settle(b, now), result, endedAt: now, endsAt: null, outageAt: null } }]
}

// Falla nuestra: devuelve lo no jugado, avisa al usuario y deja la cola en pausa hasta que el admin revise.
function interrupt(b: Booking, now: number): Change[] {
  const t = settle(b, now)
  if (t.remainingMs === 0) return finish(b, now, 'complete')
  const credits = refundFor(b, t.remainingMs)
  return [
    { type: 'booking', id: b.id, from: 'playing', set: { status: 'done', ...t, refunded: b.refunded + credits, result: 'interrupted', endedAt: now, endsAt: null, outageAt: null } },
    ...refund(b, credits, 'outage', 'Devolución por falla de la consola'),
    { type: 'notice', userId: b.userId, notice: { kind: 'interrupted', refundedCredits: credits, unplayedMinutes: Math.ceil(t.remainingMs / 60_000) } },
    { type: 'room', set: { paused: true, pauseCause: 'fault' } },
  ]
}

function refund(b: Booking, credits: number, tag: string, detail: string, actorId?: string): Change[] {
  if (credits <= 0) return []
  return [{ type: 'ledger', entry: { opKey: `refund:${b.id}:${tag}`, userId: b.userId, kind: 'refund', available: credits, reserved: 0, bookingId: b.id, detail, actorId } }]
}

// Sale sin jugar: se suelta la reserva. Si ya había pagado (el admin lo detuvo), recupera lo que le faltaba.
function drop(b: Booking, status: 'cancelled' | 'expired', now: number): Change[] {
  if (!b.charged)
    return [
      { type: 'booking', id: b.id, from: b.status, set: { status, endedAt: now } },
      { type: 'ledger', entry: { opKey: `release:${b.id}`, userId: b.userId, kind: 'release', available: b.credits, reserved: -b.credits, bookingId: b.id, detail: 'Reserva liberada' } },
    ]
  const credits = refundFor(b, b.remainingMs)
  return [
    { type: 'booking', id: b.id, from: b.status, set: { status, refunded: b.refunded + credits, result: 'interrupted', endedAt: now } },
    ...refund(b, credits, 'return', 'Devolución del tiempo no jugado'),
  ]
}

const backToQueue = (b: Booking): Change => ({ type: 'booking', id: b.id, from: 'offered', set: { status: 'queued', offerExpiresAt: null } })

// Devuelve a la cola la oferta pendiente (sin agente, en pausa o con el admin en control no se puede aceptar).
function retract(s: State): Change[] {
  const o = offered(s)
  return o ? [backToQueue(o)] : []
}

// --- Usuario ---

export function checkJoin(s: State, userId: string): void {
  if (bookingOf(s, userId)) throw new RuleError('Ya estás en la cola o jugando.')
  if (!s.agentOnline) throw new RuleError('La consola está apagada. Vuelve más tarde.')
  if (s.paused) throw new RuleError('La cola está en pausa. Vuelve en unos minutos.')
}

export const nextPosition = (s: State) => Math.max(0, ...s.bookings.map((b) => b.position)) + 1

export function leave(s: State, userId: string, now: number): Change[] {
  const b = bookingOf(s, userId)
  if (!b || b.status === 'playing') throw new RuleError('No estás en la cola.')
  return advance(s, drop(b, 'cancelled', now), now)
}

export function decline(s: State, userId: string, now: number): Change[] {
  const o = offered(s)
  if (o?.userId !== userId) throw new RuleError('Tu turno ya venció.')
  return advance(s, drop(o, 'cancelled', now), now)
}

export function accept(s: State, userId: string, now: number): Change[] {
  const o = offered(s)
  if (!o || o.userId !== userId || now >= (o.offerExpiresAt ?? 0)) throw new RuleError('Tu turno ya venció.')
  if (!s.agentOnline) throw new RuleError('La consola no está conectada. Espera un momento.')
  const changes: Change[] = [
    { type: 'booking', id: o.id, from: 'offered', set: { status: 'playing', charged: true, offerExpiresAt: null, startedAt: o.startedAt ?? now, segmentAt: now, endsAt: now + o.remainingMs, outageAt: null } },
  ]
  if (!o.charged)
    changes.push({ type: 'ledger', entry: { opKey: `charge:${o.id}`, userId, kind: 'charge', available: 0, reserved: -o.credits, bookingId: o.id, detail: `Sesión de ${o.minutes} min` } })
  return changes
}

// Termina por decisión propia, sin devolución (salvo que en ese momento haya una falla nuestra).
export function end(s: State, userId: string, now: number): Change[] {
  const b = playing(s)
  if (b?.userId !== userId) throw new RuleError('No tienes el turno.')
  return advance(s, b.outageAt !== null ? interrupt(b, now) : finish(b, now, 'left'), now)
}

// --- Reloj y fallas ---

export function tick(s: State, now: number): Change[] {
  const changes: Change[] = []
  const o = offered(s)
  if (o && now >= (o.offerExpiresAt ?? 0)) changes.push(...drop(o, 'expired', now), { type: 'notice', userId: o.userId, notice: { kind: 'expired' } })
  const p = playing(s)
  if (p && p.outageAt !== null) {
    if (now >= p.outageAt + OUTAGE_GRACE_MS) changes.push(...interrupt(p, now))
  } else if (p && now >= (p.endsAt ?? 0)) changes.push(...finish(p, p.endsAt ?? now, 'complete'))
  return advance(s, changes, now)
}

export function nextDeadline(s: State): number | null {
  const p = playing(s)
  const times = [offered(s)?.offerExpiresAt, p && (p.outageAt !== null ? p.outageAt + OUTAGE_GRACE_MS : p.endsAt)].filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : null
}

export function outageStart(s: State, now: number): Change[] {
  const p = playing(s)
  const changes: Change[] = s.agentOnline ? [] : retract(s)
  // Un turno que ya terminó (la alarma viene atrasada) no es una falla.
  if (p && p.outageAt === null && now < (p.endsAt ?? 0)) changes.push({ type: 'booking', id: p.id, from: 'playing', set: { outageAt: now } })
  return changes
}

// Volvió: el tiempo perdido se suma al final del turno.
export function outageEnd(s: State, now: number): Change[] {
  const p = playing(s)
  if (!p || p.outageAt === null || now >= p.outageAt + OUTAGE_GRACE_MS) return tick(s, now)
  return [{ type: 'booking', id: p.id, from: 'playing', set: { endsAt: (p.endsAt ?? now) + (now - p.outageAt), outageAt: null } }]
}

// --- Admin ---

export function take(s: State, admin: { userId: string; name: string }, now: number): Change[] {
  if (s.control?.userId === admin.userId) return []
  const p = playing(s)
  if (p?.userId === admin.userId) throw new RuleError('Ya estás jugando tu propio turno.')
  const changes = retract(s)
  if (p) {
    const first = Math.min(...s.bookings.map((b) => b.position)) - 1
    const t = settle(p, now)
    if (t.remainingMs > 0) changes.push({ type: 'booking', id: p.id, from: 'playing', set: { status: 'queued', position: first, ...t, segmentAt: null, endsAt: null, outageAt: null } })
    else changes.push(...finish(p, now, 'complete'))
  }
  changes.push({ type: 'room', set: { control: { ...admin, since: now } } })
  return changes
}

export function release(s: State, userId: string, now: number): Change[] {
  if (s.control?.userId !== userId) throw new RuleError('No tienes el control.')
  return advance(s, [{ type: 'room', set: { control: null } }], now)
}

export function skip(s: State, now: number): Change[] {
  const p = playing(s)
  if (!p) throw new RuleError('Nadie está jugando un turno.')
  return advance(s, finish(p, now, 'skipped'), now)
}

export function setPaused(s: State, paused: boolean, now: number): Change[] {
  const room: Change = { type: 'room', set: { paused, pauseCause: paused ? 'admin' : null } }
  return paused ? [...retract(s), room] : advance(s, [room], now)
}

export function reorder(s: State, userIds: string[]): Change[] {
  const q = queue(s)
  if (userIds.length !== q.length || new Set(userIds).size !== q.length || !q.every((b) => userIds.includes(b.userId)))
    throw new RuleError('La cola cambió. Revísala e intenta otra vez.')
  const positions = q.map((b) => b.position)
  return userIds.flatMap((id, i): Change[] => {
    const b = q.find((x) => x.userId === id)
    const position = positions[i]
    return b && position !== undefined && b.position !== position ? [{ type: 'booking', id: b.id, from: 'queued', set: { position } }] : []
  })
}

export function refundMinutes(s: State, minutes: number, reason: string, adminId: string, tag: string): Change[] {
  const p = playing(s)
  if (!p) throw new RuleError('Nadie está jugando un turno.')
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) throw new RuleError('Escribe entre 1 y 120 minutos.', 400)
  const credits = refundFor(p, minutes * 60_000)
  if (credits <= 0) throw new RuleError('Ya se devolvió todo lo cobrado por este turno.')
  return [
    { type: 'booking', id: p.id, from: 'playing', set: { refunded: p.refunded + credits } },
    ...refund(p, credits, `admin:${tag}`, `Devolución: ${reason}`, adminId),
  ]
}

// Saca de la sala a un usuario bloqueado o a un admin que perdió el rol.
export function removeUser(s: State, userId: string, now: number, opts: { onlyControl: boolean }): Change[] {
  const changes: Change[] = []
  const b = opts.onlyControl ? null : bookingOf(s, userId)
  if (b) changes.push(...(b.status === 'playing' ? finish(b, now, 'skipped') : drop(b, 'cancelled', now)))
  if (s.control?.userId === userId) changes.push({ type: 'room', set: { control: null } })
  return advance(s, changes, now)
}
