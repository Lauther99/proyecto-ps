// Consultas SQL de la sala y del dinero, separadas de la red para poder probarlas con SQLite.
// Cada movimiento del libro lleva su condición: un UPDATE que no cambia filas no cancela el batch.

import { RETENTION_MS, type EventKind } from './events'
import type { Booking, BookingSet, Change, LedgerEntry } from './room-logic'

export type Query = { sql: string; params: (string | number | null)[] }

const COLUMNS: Record<keyof BookingSet, string> = {
  status: 'status',
  position: 'position',
  minutes: 'minutes',
  credits: 'credits',
  charged: 'charged',
  remainingMs: 'remaining_ms',
  offerExpiresAt: 'offer_expires_at',
  startedAt: 'started_at',
  segmentAt: 'segment_at',
  endsAt: 'ends_at',
  outageAt: 'outage_at',
  playedMs: 'played_ms',
  refunded: 'refunded',
  result: 'result',
  endedAt: 'ended_at',
}

const value = (v: unknown): string | number | null => (typeof v === 'boolean' ? Number(v) : ((v ?? null) as string | number | null))

function updateBooking(id: string, from: string, set: BookingSet): Query {
  const keys = (Object.keys(set) as (keyof BookingSet)[]).filter((k) => set[k] !== undefined)
  // Al empezar queda anotado el juego de la sala, para el historial.
  const game = set.status === 'playing' ? ', game = (SELECT game FROM rooms WHERE id = bookings.room_id)' : ''
  return {
    sql: `UPDATE bookings SET ${keys.map((k) => `${COLUMNS[k]} = ?`).join(', ')}${game} WHERE id = ? AND status = ?`,
    params: [...keys.map((k) => value(set[k])), id, from],
  }
}

// El movimiento solo entra si la compra quedó en el estado que le corresponde.
function insertLedger(e: LedgerEntry, status: string, now: number): Query {
  return {
    sql: `INSERT INTO ledger (op_key, user_id, kind, available_delta, reserved_delta, booking_id, actor_id, detail, created_at)
          SELECT ?, ?, ?, ?, ?, id, ?, ?, ? FROM bookings WHERE id = ? AND user_id = ? AND status = ?`,
    params: [e.opKey, e.userId, e.kind, e.available, e.reserved, e.actorId ?? null, e.detail, now, e.bookingId, e.userId, status],
  }
}

export const eventQuery = (bookingId: string, kind: EventKind, now: number, detail: Record<string, unknown> | null = null): Query => ({
  sql: 'INSERT INTO session_events (booking_id, at, kind, detail) VALUES (?, ?, ?, ?)',
  params: [bookingId, now, kind, detail && JSON.stringify(detail)],
})

// Lo que queda anotado de cada cambio.
function eventsOf(c: Change, now: number): Query[] {
  if (c.type === 'ledger') return c.entry.kind === 'refund' ? [eventQuery(c.entry.bookingId, 'refund', now, { credits: c.entry.available, manual: Boolean(c.entry.actorId) })] : []
  if (c.type !== 'booking') return []
  if (c.set.status === 'playing') return [eventQuery(c.id, 'start', now)]
  if (c.from !== 'playing') return []
  if (c.set.status === 'queued') return [eventQuery(c.id, 'held', now)]
  if (c.set.status === 'done')
    return [
      eventQuery(c.id, 'end', now, { result: c.set.result ?? null }),
      { sql: 'DELETE FROM session_events WHERE at < ?', params: [now - RETENTION_MS] },
    ]
  return c.set.outageAt === null && c.set.endsAt ? [eventQuery(c.id, 'recovered', now)] : []
}

// Convierte los cambios en consultas. 'checks' son los índices que deben modificar exactamente una fila.
export function toQueries(changes: Change[], roomId: string, statusOf: (bookingId: string) => string, now: number): { queries: Query[]; checks: number[] } {
  const queries: Query[] = []
  const checks: number[] = []
  // Primero todas las compras: los movimientos dependen del estado final.
  // Las que dejan libre el turno van antes que la que lo toma (índice único de un turno por sala).
  const bookings = changes.filter((c) => c.type === 'booking')
  const takes = (c: (typeof bookings)[number]) => Number(c.set.status === 'offered' || c.set.status === 'playing')
  for (const c of [...bookings].sort((a, b) => takes(a) - takes(b))) {
    checks.push(queries.length)
    queries.push(updateBooking(c.id, c.from, c.set))
  }
  for (const c of changes) {
    if (c.type === 'ledger') {
      checks.push(queries.length)
      queries.push(insertLedger(c.entry, statusOf(c.entry.bookingId), now))
    } else if (c.type === 'notice') queries.push({ sql: 'UPDATE users SET notice = ? WHERE id = ?', params: [JSON.stringify(c.notice), c.userId] })
    else if (c.type === 'room') {
      const parts: [string, string | number | null][] = []
      if (c.set.paused !== undefined) parts.push(['paused', Number(c.set.paused)], ['pause_cause', c.set.pauseCause ?? null])
      if (c.set.control !== undefined) parts.push(['control_user', c.set.control?.userId ?? null], ['control_since', c.set.control?.since ?? null])
      if (c.set.youtube !== undefined) parts.push(['youtube', Number(c.set.youtube)])
      if (parts.length) queries.push({ sql: `UPDATE rooms SET ${parts.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`, params: [...parts.map(([, v]) => v), roomId] })
    }
  }
  for (const c of changes) queries.push(...eventsOf(c, now))
  return { queries, checks }
}

// Estado final de cada compra después de los cambios.
export function finalStatus(current: Booking[], changes: Change[]): (id: string) => string {
  const map = new Map<string, string>(current.map((b) => [b.id, b.status]))
  for (const c of changes) if (c.type === 'booking' && c.set.status) map.set(c.id, c.set.status)
  return (id) => map.get(id) ?? ''
}

// Entra a la cola y reserva, juntos. Sin saldo, el CHECK de wallets cancela todo.
export function joinQueries(b: { id: string; roomId: string; userId: string; position: number; minutes: number; credits: number; now: number }): Query[] {
  return [
    {
      sql: `INSERT INTO bookings (id, room_id, user_id, status, position, minutes, credits, remaining_ms, created_at)
            SELECT ?, ?, id, 'queued', ?, ?, ?, ?, ? FROM users WHERE id = ? AND status != 'blocked'`,
      params: [b.id, b.roomId, b.position, b.minutes, b.credits, b.minutes * 60_000, b.now, b.userId],
    },
    {
      sql: `INSERT INTO ledger (op_key, user_id, kind, available_delta, reserved_delta, booking_id, detail, created_at)
            SELECT 'reserve:' || id, user_id, 'reserve', -credits, credits, id, 'Reserva de ' || minutes || ' min', ? FROM bookings WHERE id = ?`,
      params: [b.now, b.id],
    },
    { sql: 'UPDATE users SET notice = NULL WHERE id = ?', params: [b.userId] },
  ]
}

// Devolución manual de una partida terminada. El CHECK de 'refunded' impide pasar de lo cobrado.
export function manualRefundQueries(r: { bookingId: string; key: string; credits: number; adminId: string; reason: string; now: number }): Query[] {
  const ended = "WHERE id = ? AND ended_at IS NOT NULL AND started_at IS NOT NULL AND charged = 1"
  return [
    { sql: `UPDATE bookings SET refunded = refunded + ? ${ended}`, params: [r.credits, r.bookingId] },
    {
      sql: `INSERT INTO ledger (op_key, user_id, kind, available_delta, booking_id, actor_id, detail, created_at)
            SELECT ?, user_id, 'refund', ?, id, ?, ?, ? FROM bookings ${ended}`,
      params: [`refund:${r.bookingId}:manual:${r.key}`, r.credits, r.adminId, `Devolución: ${r.reason}`, r.now, r.bookingId],
    },
    {
      sql: `INSERT INTO session_events (booking_id, at, kind, detail) SELECT id, ?, 'refund', ? FROM bookings ${ended}`,
      params: [r.now, JSON.stringify({ credits: r.credits, manual: true }), r.bookingId],
    },
    { sql: "INSERT INTO audit (admin_id, action, target, reason, created_at) VALUES (?, 'session.refund', ?, ?, ?)", params: [r.adminId, r.bookingId, `${r.credits}: ${r.reason}`, r.now] },
  ]
}

export function approveQueries(id: string, adminId: string, now: number): Query[] {
  return [
    { sql: "UPDATE recharges SET status = 'approved', resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'", params: [adminId, now, id] },
    {
      sql: `INSERT INTO ledger (op_key, user_id, kind, available_delta, recharge_id, actor_id, detail, created_at)
            SELECT 'recharge:' || id, user_id, 'recharge', amount, id, ?, 'Recarga aprobada', ? FROM recharges WHERE id = ? AND status = 'approved'`,
      params: [adminId, now, id],
    },
    { sql: "INSERT INTO audit (admin_id, action, target, created_at) VALUES (?, 'recharge.approve', ?, ?)", params: [adminId, id, now] },
  ]
}

export const ACTIVE_BOOKINGS = `
  SELECT b.id, b.user_id AS userId, u.nickname AS name, b.status, b.position, b.minutes, b.credits, b.charged,
         b.remaining_ms AS remainingMs, b.offer_expires_at AS offerExpiresAt, b.started_at AS startedAt,
         b.segment_at AS segmentAt, b.ends_at AS endsAt, b.outage_at AS outageAt, b.played_ms AS playedMs, b.refunded
    FROM bookings b JOIN users u ON u.id = b.user_id
   WHERE b.room_id = ? AND b.status IN ('queued', 'offered', 'playing')`
