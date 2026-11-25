// Prueba el SQL real (migraciones + store.ts) con SQLite en memoria, junto con las reglas de la sala.
import fs from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { beforeEach, expect, it } from 'vitest'
import * as L from '../src/room-logic'
import { ACTIVE_BOOKINGS, approveQueries, finalStatus, joinQueries, toQueries } from '../src/store'

const read = (f) => fs.readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8')
const MIN = 60_000
let db
let now

function batch(queries) {
  db.exec('BEGIN')
  try {
    const r = queries.map((q) => Number(db.prepare(q.sql).run(...q.params).changes))
    db.exec('COMMIT')
    return r
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
const wallet = (u) => ({ ...db.prepare('SELECT available, reserved FROM wallets WHERE user_id = ?').get(u) })
function load(extra = {}) {
  const r = db.prepare('SELECT paused, control_user FROM rooms').get()
  return { bookings: db.prepare(ACTIVE_BOOKINGS).all('main').map((b) => ({ ...b, charged: Boolean(b.charged) })), paused: r.paused === 1, control: r.control_user ? { userId: r.control_user, name: 'x', since: 0 } : null, youtube: false, agentOnline: true, acceptSeconds: 60, ...extra }
}
function commit(changes) {
  const before = load()
  const { queries, checks } = toQueries(changes, 'main', finalStatus(before.bookings, changes), now)
  const r = batch(queries)
  for (const i of checks) expect(r[i]).toBe(1)
  // La memoria y la base quedan iguales.
  const byId = (s) => [...s.bookings].sort((a, b) => a.id.localeCompare(b.id))
  expect(byId(L.applyChanges(before, changes))).toEqual(byId(load()))
  // Saldo = suma del libro, y reservado = compras activas sin cobrar.
  for (const w of db.prepare('SELECT * FROM wallets').all()) {
    const l = db.prepare('SELECT COALESCE(SUM(available_delta), 0) a, COALESCE(SUM(reserved_delta), 0) r FROM ledger WHERE user_id = ?').get(w.user_id)
    const b = db.prepare("SELECT COALESCE(SUM(credits), 0) c FROM bookings WHERE user_id = ? AND charged = 0 AND status IN ('queued', 'offered')").get(w.user_id)
    expect([w.available, w.reserved, w.reserved]).toEqual([l.a, l.r, b.c])
  }
}
function join(u, minutes = 30, credits = 15) {
  const r = batch(joinQueries({ id: `b-${u}-${now}`, roomId: 'main', userId: u, position: L.nextPosition(load()), minutes, credits, now }))
  commit(L.next(load(), now))
  return r
}
const money = (u, amount) => {
  db.prepare("INSERT INTO recharges (id, user_id, request_key, amount, operation, created_at) VALUES (?, ?, ?, ?, '00123456', 1)").run(`r-${u}`, u, `k-${u}`, amount)
  return batch(approveQueries(`r-${u}`, 'root', now))
}

beforeEach(() => {
  now = 1_000_000_000
  db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(read('0001_init.sql'))
  for (const [u, s] of [['ana', 'approved'], ['beto', 'pending'], ['caco', 'blocked'], ['root', 'approved']])
    db.exec(`INSERT INTO users (id, email, name, status, created_at) VALUES ('${u}', '${u}@x.test', 'Nombre Real', '${s}', 1)`)
  db.exec(read('0002_credits.sql'))
  db.exec(read('0003_session_game.sql'))
})

it('la migración aprueba pendientes, conserva bloqueados y oculta el nombre', () => {
  expect(db.prepare('SELECT status FROM users ORDER BY id').all().map((r) => r.status)).toEqual(['approved', 'approved', 'blocked', 'approved'])
  expect(db.prepare("SELECT COUNT(*) n FROM users WHERE nickname LIKE '%Real%'").get().n).toBe(0)
})

it('aprobar dos veces suma una', () => {
  money('ana', 20)
  expect(() => batch(approveQueries('r-ana', 'root', now))).toThrow('UNIQUE')
  expect(wallet('ana')).toEqual({ available: 20, reserved: 0 })
  db.exec("INSERT INTO recharges (id, user_id, request_key, amount, operation, status, created_at) VALUES ('rx', 'ana', 'kx', 50, '1234', 'rejected', 1)")
  expect(batch(approveQueries('rx', 'root', now))[0]).toBe(0)
  expect(wallet('ana').available).toBe(20)
})

it('sin saldo no entra a la cola ni queda nada a medias', () => {
  expect(() => join('ana')).toThrow('available')
  expect(load().bookings).toEqual([])
  money('caco', 50)
  expect(batch(joinQueries({ id: 'z', roomId: 'main', userId: 'caco', position: 1, minutes: 30, credits: 15, now }))[0]).toBe(0)
  expect(wallet('caco')).toEqual({ available: 50, reserved: 0 })
})

it('recorrido completo: reserva, cobro, fin y siguiente', () => {
  money('ana', 20)
  money('beto', 20)
  join('ana')
  join('beto')
  expect(wallet('ana')).toEqual({ available: 5, reserved: 15 })
  commit(L.accept(load(), 'ana', now))
  expect(wallet('ana')).toEqual({ available: 5, reserved: 0 })
  now += 30 * MIN
  commit(L.tick(load(), now))
  expect(L.offered(load()).userId).toBe('beto')
  commit(L.tick(load(), now + 60_000))
  expect(wallet('beto')).toEqual({ available: 20, reserved: 0 })
  expect(JSON.parse(db.prepare("SELECT notice FROM users WHERE id = 'beto'").get().notice)).toEqual({ kind: 'expired' })
})

it('el historial conserva el juego de cuando se jugó', () => {
  money('ana', 15)
  db.exec("UPDATE rooms SET game = 'Juego A'")
  join('ana')
  commit(L.accept(load(), 'ana', now))
  db.exec("UPDATE rooms SET game = 'Juego B'")
  commit(L.end(load(), 'ana', now + MIN))
  expect(db.prepare('SELECT game FROM bookings').get().game).toBe('Juego A')
})

it('falla: devuelve, pausa y guarda el resultado', () => {
  money('ana', 15)
  join('ana')
  commit(L.accept(load(), 'ana', now))
  now += 8 * MIN
  commit(L.outageStart(load(), now))
  now += 90_000
  commit(L.tick(load(), now))
  expect(wallet('ana')).toEqual({ available: 11, reserved: 0 })
  expect(db.prepare('SELECT paused, pause_cause FROM rooms').get()).toMatchObject({ paused: 1, pause_cause: 'fault' })
  expect(db.prepare('SELECT result, refunded, played_ms FROM bookings').get()).toMatchObject({ result: 'interrupted', refunded: 11, played_ms: 8 * MIN })
})

it('control del admin: el jugador vuelve sin pagar, o recupera lo que faltaba', () => {
  money('ana', 15)
  money('beto', 15)
  join('ana')
  join('beto')
  commit(L.accept(load(), 'ana', now))
  now += 10 * MIN
  commit(L.take(load(), { userId: 'root', name: 'Root' }, now))
  commit(L.release(load(), 'root', now))
  commit(L.accept(load(), 'ana', now))
  now += 5 * MIN
  commit(L.refundMinutes(load(), 4, 'prueba', 'root', 'x'))
  commit(L.take(load(), { userId: 'root', name: 'Root' }, now))
  commit(L.leave(load(), 'ana', now))
  // 15 min jugados de 30: 2 devueltos por el admin y 8 (7.5 a favor) por lo no jugado.
  expect(wallet('ana')).toEqual({ available: 10, reserved: 0 })
  commit(L.removeUser(load(), 'beto', now, { onlyControl: false }))
  expect(wallet('beto')).toEqual({ available: 15, reserved: 0 })
})

it('la base rechaza dos turnos, dos compras y cambios en el libro', () => {
  money('ana', 60)
  money('beto', 60)
  join('ana')
  expect(() => batch(joinQueries({ id: 'otra', roomId: 'main', userId: 'ana', position: 9, minutes: 30, credits: 15, now }))).toThrow('UNIQUE')
  join('beto')
  expect(() => db.exec("UPDATE bookings SET status = 'playing' WHERE user_id = 'beto'")).toThrow('UNIQUE')
  expect(() => db.exec('UPDATE ledger SET available_delta = 1')).toThrow('solo se agrega')
  expect(() => db.exec('DELETE FROM ledger')).toThrow('solo se agrega')
})
