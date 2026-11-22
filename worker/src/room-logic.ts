// Reglas de la sala, como funciones puras (sin red, sin reloj, sin almacenamiento) para poder
// probarlas fácil. El Durable Object (room.ts) guarda el estado, llama a estas funciones y avisa
// a los navegadores y al agente de los cambios.
//
// Flujo de un turno:
//   cola -> "oferta" (el primero de la cola tiene ACCEPT_SECONDS para aceptar) -> turno -> siguiente
// Si no acepta a tiempo, pierde su lugar. El admin puede tomar el control en cualquier momento:
// el jugador interrumpido vuelve al principio de la cola.

export const ACCEPT_SECONDS = 60
export const MIN_TURN_MINUTES = 5
export const MAX_TURN_MINUTES = 120

export type Member = {
  userId: string
  name: string
}

export type CurrentTurn = Member & {
  isAdmin: boolean
  startedAt: number // ms
  endsAt: number | null // null = sin límite (el admin cuando toma el control)
}

export type Offer = Member & {
  expiresAt: number // ms
}

export type RoomState = {
  queue: Member[]
  current: CurrentTurn | null
  offer: Offer | null
  paused: boolean // en pausa no se ofrecen turnos nuevos (el turno en curso sigue)
  turnMinutes: number
}

export type TurnEndReason = 'time' | 'left' | 'skipped' | 'admin'

// Turnos que terminaron con este cambio (para guardarlos en el historial).
export type EndedTurn = { turn: CurrentTurn; endedAt: number; reason: TurnEndReason }

export type Result = { state: RoomState; ended: EndedTurn[] }

export function initialState(): RoomState {
  return { queue: [], current: null, offer: null, paused: false, turnMinutes: 15 }
}

function isInvolved(state: RoomState, userId: string): boolean {
  return (
    state.current?.userId === userId ||
    state.offer?.userId === userId ||
    state.queue.some((m) => m.userId === userId)
  )
}

// Si no hay turno ni oferta, ofrece el turno al primero de la cola.
function advance(state: RoomState, now: number): RoomState {
  if (state.paused || state.current || state.offer || state.queue.length === 0) return state
  const [next, ...rest] = state.queue
  if (!next) return state
  return { ...state, queue: rest, offer: { ...next, expiresAt: now + ACCEPT_SECONDS * 1000 } }
}

function endCurrent(state: RoomState, now: number, reason: TurnEndReason): Result {
  if (!state.current) return { state, ended: [] }
  return {
    state: { ...state, current: null },
    ended: [{ turn: state.current, endedAt: now, reason }],
  }
}

function done(result: Result, now: number): Result {
  return { state: advance(result.state, now), ended: result.ended }
}

export function join(state: RoomState, member: Member, now: number): Result {
  if (isInvolved(state, member.userId)) return { state, ended: [] }
  return done({ state: { ...state, queue: [...state.queue, member] }, ended: [] }, now)
}

// El usuario se va de la cola, rechaza la oferta o deja su turno.
export function leave(state: RoomState, userId: string, now: number): Result {
  let next: RoomState = { ...state, queue: state.queue.filter((m) => m.userId !== userId) }
  if (next.offer?.userId === userId) next = { ...next, offer: null }
  let ended: EndedTurn[] = []
  if (next.current?.userId === userId) {
    const r = endCurrent(next, now, 'left')
    next = r.state
    ended = r.ended
  }
  return done({ state: next, ended }, now)
}

export function accept(state: RoomState, userId: string, isAdmin: boolean, now: number): Result {
  const offer = state.offer
  if (!offer || offer.userId !== userId || now > offer.expiresAt) return { state, ended: [] }
  const current: CurrentTurn = {
    userId: offer.userId,
    name: offer.name,
    isAdmin,
    startedAt: now,
    endsAt: now + state.turnMinutes * 60_000,
  }
  return { state: { ...state, offer: null, current }, ended: [] }
}

// Revisa los vencimientos (oferta no aceptada, turno terminado). Se llama desde la alarma.
export function tick(state: RoomState, now: number): Result {
  let next = state
  if (next.offer && now >= next.offer.expiresAt) next = { ...next, offer: null } // pierde su lugar
  let ended: EndedTurn[] = []
  if (next.current?.endsAt != null && now >= next.current.endsAt) {
    const r = endCurrent(next, now, 'time')
    next = r.state
    ended = r.ended
  }
  return done({ state: next, ended }, now)
}

// --- Acciones del admin ---

// Termina el turno actual y pasa al siguiente.
export function skip(state: RoomState, now: number): Result {
  return done(endCurrent(state, now, 'skipped'), now)
}

// El admin juega ya, sin límite de tiempo. Quien jugaba (o tenía la oferta) vuelve primero en la cola.
export function takeControl(state: RoomState, admin: Member, now: number): Result {
  if (state.current?.userId === admin.userId) return { state, ended: [] }
  const front: Member[] = []
  let next: RoomState = { ...state, queue: state.queue.filter((m) => m.userId !== admin.userId) }
  let ended: EndedTurn[] = []
  if (next.current) {
    front.push({ userId: next.current.userId, name: next.current.name })
    const r = endCurrent(next, now, 'admin')
    next = r.state
    ended = r.ended
  }
  if (next.offer && next.offer.userId !== admin.userId) front.push({ userId: next.offer.userId, name: next.offer.name })
  next = {
    ...next,
    offer: null,
    queue: [...front, ...next.queue],
    current: { ...admin, isAdmin: true, startedAt: now, endsAt: null },
  }
  return { state: next, ended }
}

export function setPaused(state: RoomState, paused: boolean, now: number): Result {
  return done({ state: { ...state, paused }, ended: [] }, now)
}

// Cambia la duración de los turnos siguientes (el turno en curso no cambia).
export function setTurnMinutes(state: RoomState, minutes: number): Result {
  if (!Number.isFinite(minutes)) return { state, ended: [] }
  const clamped = Math.round(Math.min(MAX_TURN_MINUTES, Math.max(MIN_TURN_MINUTES, minutes)))
  return { state: { ...state, turnMinutes: clamped }, ended: [] }
}

// Próximo momento en que algo vence (para programar la alarma del Durable Object).
export function nextDeadline(state: RoomState): number | null {
  const times = [state.offer?.expiresAt, state.current?.endsAt].filter((t): t is number => typeof t === 'number')
  return times.length ? Math.min(...times) : null
}
