import { describe, expect, it } from 'vitest'
import { analyze, type EventKind, type SessionEvent } from '../src/events'

const S = 1000
const T0 = 1_000_000_000
const ev = (s: number, kind: EventKind, detail: Record<string, unknown> | null = null): SessionEvent => ({ at: T0 + s * S, kind, detail })
const run = (list: SessionEvent[], end = 1800) => analyze([...list, ev(end, 'end')], T0 + end * S)

describe('veredicto de una partida', () => {
  it('normal', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on')])).toMatchObject({ verdict: 'ok', playerOffMs: 0, cuts: 0 })
  })
  it('recargar la página no es un corte', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(100, 'video_off'), ev(108, 'video_on')]).verdict).toBe('ok')
  })
  it('el jugador se cortó y volvió', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(100, 'video_off'), ev(220, 'video_on')])).toMatchObject({ verdict: 'player', playerOffMs: 120 * S, cuts: 1 })
  })
  it('el jugador se cortó y no volvió', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(600, 'video_off')])).toMatchObject({ verdict: 'player', playerOffMs: 1200 * S })
  })
  it('cayó el agente: no se culpa al jugador', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(500, 'agent_off')], 590)).toMatchObject({ verdict: 'ours', outageMs: 90 * S, playerOffMs: 0 })
  })
  it('cayó el agente y volvió: reconectar el video no es corte del jugador', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(500, 'agent_off'), ev(530, 'agent_on'), ev(530, 'recovered'), ev(555, 'video_on')])).toMatchObject({ verdict: 'ours', outageMs: 30 * S, playerOffMs: 0 })
  })
  it('falla de la consola con el video cortado de rebote', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(500, 'console_fault'), ev(505, 'video_off'), ev(540, 'recovered'), ev(545, 'video_on')])).toMatchObject({ verdict: 'ours', playerOffMs: 0 })
  })
  it('falla nuestra y además corte del jugador', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(100, 'console_fault'), ev(130, 'recovered'), ev(900, 'video_off')]).verdict).toBe('mixed')
  })
  it('nunca conectó el video', () => {
    expect(run([ev(0, 'start')]).verdict).toBe('noVideo')
  })
  it('detenido por el admin: el tiempo en espera no cuenta', () => {
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ev(100, 'held'), ev(101, 'video_off'), ev(900, 'start'), ev(910, 'video_on')])).toMatchObject({ verdict: 'ok', playerOffMs: 0 })
  })
  it('mala conexión sin cortes', () => {
    const q = [1, 2, 3, 4, 5].map((i) => ev(i * 30, 'quality', { rtt: i < 3 ? 200 : 40, loss: 0 }))
    expect(run([ev(0, 'start'), ev(8, 'video_on'), ...q])).toMatchObject({ verdict: 'poor', samples: 5, badSamples: 2 })
  })
  it('partida sin registro', () => {
    expect(analyze([], T0).verdict).toBe('noData')
  })
})
