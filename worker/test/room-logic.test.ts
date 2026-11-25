import { describe, expect, it } from 'vitest'
import * as L from '../src/room-logic'
import type { Booking, Change, State } from '../src/room-logic'

const T0 = 1_000_000_000
const MIN = 60_000

function booking(userId: string, extra: Partial<Booking> = {}): Booking {
  return { id: `b-${userId}`, userId, name: userId, status: 'queued', position: 1, minutes: 30, credits: 15, charged: false, remainingMs: 30 * MIN, offerExpiresAt: null, startedAt: null, segmentAt: null, endsAt: null, outageAt: null, playedMs: 0, refunded: 0, ...extra }
}
const state = (bookings: Booking[], extra: Partial<State> = {}): State => ({ bookings, paused: false, control: null, youtube: false, agentOnline: true, acceptSeconds: 60, ...extra })
const ledger = (c: Change[]) => c.flatMap((x) => (x.type === 'ledger' ? [[x.entry.kind, x.entry.available, x.entry.reserved]] : []))
const notices = (c: Change[]) => c.flatMap((x) => (x.type === 'notice' ? [x.notice] : []))
const sets = (c: Change[], id: string) => Object.assign({}, ...c.flatMap((x) => (x.type === 'booking' && x.id === id ? [x.set] : [])))

const queued = () => state([booking('ana', { position: 1 }), booking('beto', { position: 2 })])
const run = (s: State, c: Change[]) => L.applyChanges(s, c)
const playingAna = () => {
  const s = run(queued(), L.next(queued(), T0))
  return run(s, L.accept(s, 'ana', T0))
}

describe('cola y ofertas', () => {
  it('ofrece al primero y respeta los segundos configurados', () => {
    const s = run(state([booking('ana')], { acceptSeconds: 45 }), L.next(state([booking('ana')], { acceptSeconds: 45 }), T0))
    expect(L.offered(s)).toMatchObject({ userId: 'ana', offerExpiresAt: T0 + 45_000 })
  })
  it('no ofrece en pausa, sin agente ni con el admin en control', () => {
    const b = [booking('ana')]
    expect(L.next(state(b, { paused: true }), T0)).toEqual([])
    expect(L.next(state(b, { agentOnline: false }), T0)).toEqual([])
    expect(L.next(state(b, { control: { userId: 'x', name: 'x', since: 0 } }), T0)).toEqual([])
  })
  it('una compra activa por persona, y no se entra sin agente ni en pausa', () => {
    expect(() => L.checkJoin(queued(), 'ana')).toThrow()
    expect(() => L.checkJoin(state([], { agentOnline: false }), 'ana')).toThrow()
    expect(() => L.checkJoin(state([], { paused: true }), 'ana')).toThrow()
    expect(() => L.checkJoin(state([]), 'ana')).not.toThrow()
  })
  it('salir o dejar pasar libera la reserva y llama al siguiente', () => {
    const s = run(queued(), L.next(queued(), T0))
    const c = L.decline(s, 'ana', T0)
    expect(ledger(c)).toEqual([['release', 15, -15]])
    expect(L.offered(run(s, c))?.userId).toBe('beto')
    expect(ledger(L.leave(s, 'beto', T0))).toEqual([['release', 15, -15]])
  })
  it('al vencer la oferta vuelve la reserva y se avisa', () => {
    const s = run(queued(), L.next(queued(), T0))
    const c = L.tick(s, T0 + 60_000)
    expect(ledger(c)).toEqual([['release', 15, -15]])
    expect(notices(c)).toEqual([{ kind: 'expired' }])
    expect(L.offered(run(s, c))?.userId).toBe('beto')
  })
  it('aceptar justo al vencer no cobra', () => {
    const s = run(queued(), L.next(queued(), T0))
    expect(() => L.accept(s, 'ana', T0 + 60_000)).toThrow('venció')
    expect(() => L.accept(s, 'beto', T0)).toThrow()
  })
})

describe('turno', () => {
  it('aceptar cobra la reserva y fija el final', () => {
    const s = run(queued(), L.next(queued(), T0))
    const c = L.accept(s, 'ana', T0)
    expect(ledger(c)).toEqual([['charge', 0, -15]])
    expect(L.playing(run(s, c))?.endsAt).toBe(T0 + 30 * MIN)
  })
  it('termina por tiempo sin devolución y sigue el siguiente', () => {
    const s = playingAna()
    const c = L.tick(s, T0 + 30 * MIN)
    expect(ledger(c)).toEqual([])
    expect(sets(c, 'b-ana')).toMatchObject({ status: 'done', result: 'complete', playedMs: 30 * MIN, remainingMs: 0 })
    expect(L.offered(run(s, c))?.userId).toBe('beto')
  })
  it('una alarma repetida no cambia nada', () => {
    const s = playingAna()
    const after = run(s, L.tick(s, T0 + 30 * MIN))
    expect(L.tick(after, T0 + 30 * MIN)).toEqual([])
  })
  it('terminar antes no devuelve', () => {
    const c = L.end(playingAna(), 'ana', T0 + 10 * MIN)
    expect(ledger(c)).toEqual([])
    expect(sets(c, 'b-ana')).toMatchObject({ result: 'left', playedMs: 10 * MIN })
    expect(() => L.end(playingAna(), 'beto', T0)).toThrow()
  })
})

describe('fallas', () => {
  it('si vuelve a tiempo, suma lo perdido', () => {
    let s = playingAna()
    s = run(s, L.outageStart(s, T0 + 5 * MIN))
    expect(L.nextDeadline(s)).toBe(T0 + 5 * MIN + L.OUTAGE_GRACE_MS)
    s = run(s, L.outageEnd(s, T0 + 6 * MIN))
    expect(L.playing(s)).toMatchObject({ endsAt: T0 + 31 * MIN, outageAt: null })
    expect(sets(L.tick(s, T0 + 31 * MIN), 'b-ana')).toMatchObject({ result: 'complete', playedMs: 30 * MIN })
  })
  it('si no vuelve, devuelve lo no jugado redondeando a favor, avisa y pausa', () => {
    let s = playingAna()
    s = run(s, L.outageStart(s, T0 + 8 * MIN))
    expect(L.tick(s, T0 + 8 * MIN + 89_000)).toEqual([])
    const c = L.tick(s, T0 + 8 * MIN + 90_000)
    expect(ledger(c)).toEqual([['refund', 11, 0]])
    expect(notices(c)).toEqual([{ kind: 'interrupted', refundedCredits: 11, unplayedMinutes: 22 }])
    expect(sets(c, 'b-ana')).toMatchObject({ result: 'interrupted', playedMs: 8 * MIN, refunded: 11 })
    expect(run(s, c).paused).toBe(true)
    expect(L.offered(run(s, c))).toBeNull()
  })
  it('una falla repetida no mueve el inicio', () => {
    const s = playingAna()
    const s2 = run(s, L.outageStart(s, T0 + MIN))
    expect(L.outageStart(s2, T0 + 2 * MIN)).toEqual([])
  })
  it('volver tarde (alarma atrasada) igual devuelve', () => {
    let s = playingAna()
    s = run(s, L.outageStart(s, T0 + 8 * MIN))
    expect(ledger(L.outageEnd(s, T0 + 12 * MIN))).toEqual([['refund', 11, 0]])
  })
  it('terminar durante una falla devuelve como falla', () => {
    let s = playingAna()
    s = run(s, L.outageStart(s, T0 + 8 * MIN))
    expect(ledger(L.end(s, 'ana', T0 + 8 * MIN + 1000))).toEqual([['refund', 11, 0]])
  })
  it('una falla después del final del turno no cuenta', () => {
    expect(L.outageStart(playingAna(), T0 + 31 * MIN)).toEqual([])
  })
  it('sin agente, la oferta vuelve a la cola sin perder el lugar', () => {
    const s = run(queued(), L.next(queued(), T0))
    const after = run(s, L.outageStart({ ...s, agentOnline: false }, T0))
    expect(L.queue(after).map((b) => b.userId)).toEqual(['ana', 'beto'])
  })
})

describe('admin', () => {
  const admin = { userId: 'root', name: 'Root' }
  it('tomar el control detiene el reloj; el jugador vuelve primero y no paga otra vez', () => {
    let s = playingAna()
    s = run(s, L.take(s, admin, T0 + 10 * MIN))
    expect(L.queue(s).map((b) => b.userId)).toEqual(['ana', 'beto'])
    s = run(s, L.release(s, 'root', T0 + 60 * MIN))
    const c = L.accept(s, 'ana', T0 + 60 * MIN)
    expect(ledger(c)).toEqual([])
    s = run(s, c)
    expect(L.playing(s)).toMatchObject({ endsAt: T0 + 80 * MIN, startedAt: T0, playedMs: 10 * MIN })
    expect(sets(L.tick(s, T0 + 80 * MIN), 'b-ana')).toMatchObject({ playedMs: 30 * MIN, result: 'complete' })
  })
  it('detenido que no regresa recupera lo que le faltaba', () => {
    let s = playingAna()
    s = run(s, L.take(s, admin, T0 + 10 * MIN))
    expect(ledger(L.leave(s, 'ana', T0 + 11 * MIN))).toEqual([['refund', 10, 0]])
    s = run(s, L.release(s, 'root', T0 + 20 * MIN))
    expect(ledger(L.tick(s, T0 + 30 * MIN))).toEqual([['refund', 10, 0]])
  })
  it('solo quien tiene el control lo suelta', () => {
    const s = run(queued(), L.take(queued(), admin, T0))
    expect(() => L.release(s, 'ana', T0)).toThrow()
  })
  it('saltar no devuelve; devolver no pasa de lo cobrado', () => {
    let s = playingAna()
    expect(ledger(L.skip(s, T0 + MIN))).toEqual([])
    let c = L.refundMinutes(s, 20, 'x', 'root', '1')
    expect(ledger(c)).toEqual([['refund', 10, 0]])
    s = run(s, c)
    c = L.refundMinutes(s, 20, 'x', 'root', '2')
    expect(ledger(c)).toEqual([['refund', 5, 0]])
    s = run(s, c)
    expect(() => L.refundMinutes(s, 1, 'x', 'root', '3')).toThrow()
    expect(ledger(L.tick(run(s, L.outageStart(s, T0)), T0 + 90_000))).toEqual([])
  })
  it('pausar retira la oferta pero no corta al jugador; reanudar ofrece', () => {
    const s = run(queued(), L.next(queued(), T0))
    const paused = run(s, L.setPaused(s, true, T0))
    expect(L.offered(paused)).toBeNull()
    expect(L.offered(run(paused, L.setPaused(paused, false, T0)))?.userId).toBe('ana')
    const p = playingAna()
    expect(L.playing(run(p, L.setPaused(p, true, T0)))?.userId).toBe('ana')
  })
  it('reordenar exige exactamente la cola actual', () => {
    const s = queued()
    expect(L.queue(run(s, L.reorder(s, ['beto', 'ana']))).map((b) => b.userId)).toEqual(['beto', 'ana'])
    expect(() => L.reorder(s, ['beto'])).toThrow()
    expect(() => L.reorder(s, ['beto', 'beto'])).toThrow()
    expect(() => L.reorder(s, ['beto', 'otro'])).toThrow()
  })
  it('bloquear: en cola libera la reserva, jugando termina sin devolución', () => {
    expect(ledger(L.removeUser(queued(), 'ana', T0, { onlyControl: false }))).toEqual([['release', 15, -15]])
    const c = L.removeUser(playingAna(), 'ana', T0 + MIN, { onlyControl: false })
    expect(ledger(c)).toEqual([])
    expect(sets(c, 'b-ana')).toMatchObject({ result: 'skipped' })
  })
})
