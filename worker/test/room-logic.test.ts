import { describe, expect, it } from 'vitest'
import {
  ACCEPT_SECONDS,
  accept,
  initialState,
  join,
  leave,
  nextDeadline,
  setPaused,
  setTurnMinutes,
  skip,
  takeControl,
  tick,
} from '../src/room-logic'

const ana = { userId: 'ana', name: 'Ana' }
const beto = { userId: 'beto', name: 'Beto' }
const admin = { userId: 'admin', name: 'Admin' }
const T0 = 1_000_000

describe('cola y ofertas', () => {
  it('el primero que entra recibe la oferta y los demás esperan', () => {
    let s = join(initialState(), ana, T0).state
    s = join(s, beto, T0).state
    expect(s.offer?.userId).toBe('ana')
    expect(s.offer?.expiresAt).toBe(T0 + ACCEPT_SECONDS * 1000)
    expect(s.queue.map((m) => m.userId)).toEqual(['beto'])
  })

  it('no se puede entrar dos veces', () => {
    let s = join(initialState(), ana, T0).state
    s = join(s, ana, T0).state
    expect(s.queue).toHaveLength(0)
    expect(s.offer?.userId).toBe('ana')
  })

  it('aceptar empieza el turno con la duración configurada', () => {
    let s = join(initialState(), ana, T0).state
    s = accept(s, 'ana', false, T0 + 5_000).state
    expect(s.offer).toBeNull()
    expect(s.current?.userId).toBe('ana')
    expect(s.current?.endsAt).toBe(T0 + 5_000 + 15 * 60_000)
  })

  it('solo el dueño de la oferta puede aceptar, y antes de que venza', () => {
    let s = join(initialState(), ana, T0).state
    expect(accept(s, 'beto', false, T0).state.current).toBeNull()
    expect(accept(s, 'ana', false, T0 + ACCEPT_SECONDS * 1000 + 1).state.current).toBeNull()
  })

  it('si la oferta vence, pierde su lugar y pasa al siguiente', () => {
    let s = join(initialState(), ana, T0).state
    s = join(s, beto, T0).state
    s = tick(s, T0 + ACCEPT_SECONDS * 1000).state
    expect(s.offer?.userId).toBe('beto')
    expect(s.queue).toHaveLength(0)
  })

  it('rechazar la oferta pasa al siguiente', () => {
    let s = join(initialState(), ana, T0).state
    s = join(s, beto, T0).state
    s = leave(s, 'ana', T0 + 1).state
    expect(s.offer?.userId).toBe('beto')
  })
})

describe('turnos', () => {
  it('al vencer el tiempo termina el turno, se registra y se ofrece al siguiente', () => {
    let s = join(initialState(), ana, T0).state
    s = accept(s, 'ana', false, T0).state
    s = join(s, beto, T0).state
    expect(s.queue.map((m) => m.userId)).toEqual(['beto']) // espera: hay turno en curso
    const r = tick(s, T0 + 15 * 60_000)
    expect(r.ended).toHaveLength(1)
    expect(r.ended[0]?.reason).toBe('time')
    expect(r.state.current).toBeNull()
    expect(r.state.offer?.userId).toBe('beto')
  })

  it('dejar el turno lo termina con motivo "left"', () => {
    let s = join(initialState(), ana, T0).state
    s = accept(s, 'ana', false, T0).state
    const r = leave(s, 'ana', T0 + 60_000)
    expect(r.ended[0]?.reason).toBe('left')
    expect(r.state.current).toBeNull()
  })

  it('nextDeadline devuelve el vencimiento más cercano', () => {
    let s = join(initialState(), ana, T0).state
    expect(nextDeadline(s)).toBe(T0 + ACCEPT_SECONDS * 1000)
    s = accept(s, 'ana', false, T0).state
    expect(nextDeadline(s)).toBe(T0 + 15 * 60_000)
    expect(nextDeadline(initialState())).toBeNull()
  })
})

describe('admin', () => {
  it('saltar termina el turno y ofrece al siguiente', () => {
    let s = join(initialState(), ana, T0).state
    s = accept(s, 'ana', false, T0).state
    s = join(s, beto, T0).state
    const r = skip(s, T0 + 1)
    expect(r.ended[0]?.reason).toBe('skipped')
    expect(r.state.offer?.userId).toBe('beto')
  })

  it('tomar el control: el admin juega sin límite y el jugador vuelve primero en la cola', () => {
    let s = join(initialState(), ana, T0).state
    s = accept(s, 'ana', false, T0).state
    s = join(s, beto, T0).state
    const r = takeControl(s, admin, T0 + 1)
    expect(r.state.current).toMatchObject({ userId: 'admin', isAdmin: true, endsAt: null })
    expect(r.state.queue.map((m) => m.userId)).toEqual(['ana', 'beto'])
    expect(r.ended[0]?.reason).toBe('admin')
    expect(nextDeadline(r.state)).toBeNull()
  })

  it('tomar el control también devuelve a la cola a quien tenía la oferta', () => {
    let s = join(initialState(), ana, T0).state
    s = join(s, beto, T0).state
    s = takeControl(s, admin, T0).state
    expect(s.offer).toBeNull()
    expect(s.queue.map((m) => m.userId)).toEqual(['ana', 'beto'])
  })

  it('al soltar el control (leave) se ofrece al siguiente', () => {
    let s = join(initialState(), ana, T0).state
    s = takeControl(s, admin, T0).state
    s = leave(s, 'admin', T0 + 1).state
    expect(s.current).toBeNull()
    expect(s.offer?.userId).toBe('ana')
  })

  it('en pausa no se ofrecen turnos; al reanudar sí', () => {
    let s = setPaused(initialState(), true, T0).state
    s = join(s, ana, T0).state
    expect(s.offer).toBeNull()
    s = setPaused(s, false, T0 + 1).state
    expect(s.offer?.userId).toBe('ana')
  })

  it('la duración del turno se limita a 5..120 minutos', () => {
    expect(setTurnMinutes(initialState(), 30).state.turnMinutes).toBe(30)
    expect(setTurnMinutes(initialState(), 1).state.turnMinutes).toBe(5)
    expect(setTurnMinutes(initialState(), 999).state.turnMinutes).toBe(120)
    expect(setTurnMinutes(initialState(), Number.NaN).state.turnMinutes).toBe(15)
  })
})
