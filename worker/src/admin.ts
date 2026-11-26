// Rutas /api/admin/*. Todas exigen rol admin; las que cambian algo dejan registro en 'audit'.

import type { Env, User } from './env'
import { analyze, type EventKind, type SessionEvent } from './events'
import { HttpError, done, integer, json, readBody, requireUser, text } from './http'
import { SESSIONS, fromRoom, getGames, roomStub } from './player'
import type { AdminAction } from './room'
import { approveQueries, manualRefundQueries } from './store'

const LIMA_OFFSET_MS = 5 * 3_600_000 // UTC-5 todo el año
const DAY_MS = 86_400_000

function audit(env: Env, admin: User, action: string, target: string, reason: string | null = null) {
  return env.DB.prepare('INSERT INTO audit (admin_id, action, target, reason, created_at) VALUES (?, ?, ?, ?, ?)').bind(admin.id, action, target, reason, Date.now())
}

const readReason = (body: Record<string, unknown>) => text(body, 'reason', 200, 'Escribe el motivo (hasta 200 letras).')

// El aviso al navegador es un extra: si falla, lo ya guardado vale igual.
async function notify(env: Env, userId: string) {
  try {
    await roomStub(env).notify(userId)
  } catch (e) {
    console.error('notify', e)
  }
}

export async function adminRoutes(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!path.startsWith('/api/admin/')) return null
  const admin = await requireUser(request, env, { admin: true })
  const [section, id, sub] = path.slice('/api/admin/'.length).split('/')
  if (request.method === 'GET' && !id) return read(env, section ?? '', new URL(request.url).searchParams)
  if (request.method === 'GET' && section === 'sessions' && id && sub === 'events') return sessionReport(env, id)
  if (request.method !== 'POST') return null
  const body = await readBody(request)

  if (section === 'room' && !id) return fromRoom(await roomStub(env).admin({ userId: admin.id, name: admin.nickname }, roomAction(body)))
  if (section === 'config' && !id) return saveConfig(env, admin, body)
  if (!id) return null
  if (section === 'rooms' && !sub) return saveRoom(env, admin, id, body)
  if (section === 'sessions' && sub === 'refund') return refundSession(env, admin, id, body)
  if (section === 'recharges' && !sub) return resolveRecharge(env, admin, id, body)
  if (section === 'games' && !sub) {
    const status = text(body, 'status', 20, 'Estado inválido')
    if (!['available', 'soon', 'unavailable'].includes(status)) throw new HttpError(400, 'Estado inválido')
    const r = await env.DB.prepare('UPDATE games SET status = ? WHERE id = ?').bind(status, id).run()
    if (!r.meta.changes) throw new HttpError(404, 'No existe')
    await audit(env, admin, 'game.status', id, status).run()
    return done()
  }
  if (section === 'users' && sub === 'balance') return adjustBalance(env, admin, id, body)
  if (section === 'users' && !sub) return updateUser(env, admin, id, body)
  return null
}

async function read(env: Env, section: string, params: URLSearchParams): Promise<Response | null> {
  switch (section) {
    case 'summary':
      return summary(env)
    case 'recharges': {
      const status = params.get('status') ?? 'pending'
      const { results } = await env.DB.prepare(
        `SELECT r.id, r.amount, r.operation, r.created_at AS createdAt, r.status, r.reason, u.nickname, ${REPEATED} AS repeated
           FROM recharges r JOIN users u ON u.id = r.user_id WHERE r.status = ?
          ORDER BY CASE WHEN r.status = 'pending' THEN r.created_at ELSE -r.created_at END LIMIT 200`,
      )
        .bind(status)
        .all<{ repeated: number }>()
      return json({ recharges: results.map((r) => ({ ...r, repeated: r.repeated === 1 })) })
    }
    case 'users': {
      const { results } = await env.DB.prepare(
        `SELECT u.id, u.email, u.nickname, u.status, u.role, COALESCE(w.available, 0) AS available,
                (SELECT COUNT(*) FROM ledger l WHERE l.user_id = u.id AND l.kind = 'refund' AND l.actor_id IS NOT NULL) AS manualRefunds
           FROM users u LEFT JOIN wallets w ON w.user_id = u.id ORDER BY u.created_at DESC LIMIT 1000`,
      ).all()
      return json({ users: results })
    }
    case 'sessions': {
      const { results } = await env.DB.prepare(`${SESSIONS} ORDER BY b.ended_at DESC LIMIT 300`).all()
      return json({ sessions: results })
    }
    case 'games':
      return json({ games: await getGames(env) })
  }
  return null
}

// El mismo número en otra recarga que no fue rechazada.
const REPEATED = "EXISTS (SELECT 1 FROM recharges o WHERE o.operation = r.operation AND o.id != r.id AND o.status != 'rejected')"

async function summary(env: Env): Promise<Response> {
  const now = Date.now()
  const local = new Date(now - LIMA_OFFSET_MS)
  const today = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + LIMA_OFFSET_MS
  const month = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) + LIMA_OFFSET_MS
  const periods = [
    ['today', today],
    ['week', today - 6 * DAY_MS],
    ['month', month],
  ] as const
  const [pending, info, ...income] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(${REPEATED}), 0) AS repeated FROM recharges r WHERE r.status = 'pending'`).first<{ n: number; repeated: number }>(),
    roomStub(env).info(),
    ...periods.map(([period, from]) =>
      env.DB.prepare(
        `SELECT (SELECT COUNT(*) FROM recharges WHERE status = 'approved' AND resolved_at >= ?1) AS recharges,
                (SELECT COALESCE(SUM(amount), 0) FROM recharges WHERE status = 'approved' AND resolved_at >= ?1) AS soles,
                (SELECT COALESCE(SUM(played_ms), 0) FROM bookings WHERE ended_at >= ?1) AS playedMs`,
      )
        .bind(from)
        .first<{ recharges: number; soles: number; playedMs: number }>()
        .then((r) => ({ period, ...r })),
    ),
  ])
  return json({ agentLastSeen: info.agentLastSeen, pendingRecharges: pending?.n ?? 0, repeatedRecharges: pending?.repeated ?? 0, income })
}

async function resolveRecharge(env: Env, admin: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const now = Date.now()
  const solved = new HttpError(409, 'Esa recarga ya fue resuelta.')
  const row = await env.DB.prepare('SELECT user_id, status FROM recharges WHERE id = ?').bind(id).first<{ user_id: string; status: string }>()
  if (!row) throw new HttpError(404, 'No existe')
  if (row.status !== 'pending') throw solved
  if (body.status === 'approved') {
    try {
      const [first] = await env.DB.batch(approveQueries(id, admin.id, now).map((q) => env.DB.prepare(q.sql).bind(...q.params)))
      if (!first?.meta.changes) throw solved
    } catch (e) {
      // Otro admin la aprobó en este instante: el op_key único impide sumar dos veces.
      if (String(e).includes('UNIQUE')) throw solved
      throw e
    }
  } else if (body.status === 'rejected') {
    const reason = readReason(body)
    const r = await env.DB.prepare("UPDATE recharges SET status = 'rejected', reason = ?, resolved_by = ?, resolved_at = ? WHERE id = ? AND status = 'pending'")
      .bind(reason, admin.id, now, id)
      .run()
    if (!r.meta.changes) throw solved
    await audit(env, admin, 'recharge.reject', id, reason).run()
  } else throw new HttpError(400, 'Estado inválido')
  await notify(env, row.user_id)
  return done()
}

async function updateUser(env: Env, admin: User, id: string, body: Record<string, unknown>): Promise<Response> {
  if (id === admin.id) throw new HttpError(400, 'No puedes cambiar tu propia cuenta.')
  if (body.role === 'admin' || body.role === 'player') {
    const r = await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(body.role, id).run()
    if (!r.meta.changes) throw new HttpError(404, 'No existe')
    await audit(env, admin, `user.role.${body.role}`, id).run()
    return fromRoom(await roomStub(env).removeUser(id, true))
  }
  if (body.status !== 'approved' && body.status !== 'blocked') throw new HttpError(400, 'Estado inválido')
  const reason = readReason(body)
  const blocked = body.status === 'blocked'
  const r = await env.DB.prepare('UPDATE users SET status = ?, blocked_reason = ? WHERE id = ?').bind(body.status, blocked ? reason : null, id).run()
  if (!r.meta.changes) throw new HttpError(404, 'No existe')
  await audit(env, admin, `user.${blocked ? 'block' : 'unblock'}`, id, reason).run()
  if (blocked) return fromRoom(await roomStub(env).removeUser(id, false))
  await notify(env, id)
  return done()
}

async function adjustBalance(env: Env, admin: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const delta = integer(body, 'delta', -10_000, 10_000, 'Escribe un número entero.')
  if (delta === 0) throw new HttpError(400, 'El ajuste no puede ser 0.')
  const reason = readReason(body)
  try {
    const [first] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO ledger (op_key, user_id, kind, available_delta, actor_id, detail, created_at)
         SELECT ?, user_id, 'adjust', ?, ?, ?, ? FROM wallets WHERE user_id = ?`,
      ).bind(`adjust:${crypto.randomUUID()}`, delta, admin.id, `Ajuste: ${reason}`, Date.now(), id),
      audit(env, admin, 'user.adjust', id, `${delta}: ${reason}`),
    ])
    if (!first?.meta.changes) throw new HttpError(404, 'No existe')
  } catch (e) {
    if (String(e).includes('CHECK constraint failed')) throw new HttpError(409, 'El saldo no puede quedar negativo.')
    throw e
  }
  await notify(env, id)
  return done()
}

async function saveConfig(env: Env, admin: User, body: Record<string, unknown>): Promise<Response> {
  const bad = 'Revisa los datos de precio y turnos.'
  const blockMinutes = integer(body, 'blockMinutes', 5, 120, bad)
  const blockCredits = integer(body, 'blockCredits', 1, 500, bad)
  const maxMinutes = integer(body, 'maxMinutes', blockMinutes, 240, bad)
  const acceptSeconds = integer(body, 'acceptSeconds', 15, 300, 'Los segundos para aceptar van de 15 a 300.')
  if (maxMinutes % blockMinutes !== 0) throw new HttpError(400, 'El máximo debe ser múltiplo del bloque.')
  const optional = (key: string) => (typeof body[key] === 'string' ? (body[key] as string).trim().slice(0, 80) : '')
  const channel = optional('youtubeChannelId')
  if (channel && !/^UC[\w-]{10,40}$/.test(channel)) throw new HttpError(400, 'El ID del canal de YouTube empieza con UC.')
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE settings SET block_minutes = ?, block_credits = ?, max_minutes = ?, accept_seconds = ?,
              yape_holder = ?, yape_number = ?, youtube_channel_id = ? WHERE id = 1`,
    ).bind(blockMinutes, blockCredits, maxMinutes, acceptSeconds, optional('yapeHolder'), optional('yapeNumber'), channel || null),
    audit(env, admin, 'config', 'settings', JSON.stringify({ blockMinutes, blockCredits, maxMinutes, acceptSeconds })),
  ])
  await roomStub(env).refresh()
  return done()
}

async function sessionReport(env: Env, id: string): Promise<Response> {
  const b = await env.DB.prepare('SELECT ended_at FROM bookings WHERE id = ? AND started_at IS NOT NULL AND ended_at IS NOT NULL').bind(id).first<{ ended_at: number }>()
  if (!b) throw new HttpError(404, 'No existe esa partida.')
  const { results } = await env.DB.prepare('SELECT at, kind, detail FROM session_events WHERE booking_id = ? ORDER BY at, id').bind(id).all<{ at: number; kind: EventKind; detail: string | null }>()
  const events: SessionEvent[] = results.map((e) => ({ ...e, detail: e.detail ? (JSON.parse(e.detail) as Record<string, unknown>) : null }))
  return json({ events, report: analyze(events, b.ended_at) })
}

async function refundSession(env: Env, admin: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const credits = integer(body, 'credits', 1, 10_000, 'Escribe los créditos a devolver.')
  const reason = readReason(body)
  const key = text(body, 'key', 64, 'Petición inválida')
  const owner = await env.DB.prepare('SELECT user_id FROM bookings WHERE id = ?').bind(id).first<{ user_id: string }>()
  try {
    const [first] = await env.DB.batch(manualRefundQueries({ bookingId: id, key, credits, adminId: admin.id, reason, now: Date.now() }).map((q) => env.DB.prepare(q.sql).bind(...q.params)))
    if (!first?.meta.changes) throw new HttpError(404, 'No existe esa partida.')
  } catch (e) {
    if (String(e).includes('CHECK constraint failed')) throw new HttpError(409, 'No puedes devolver más de lo cobrado en esa partida.')
    if (String(e).includes('UNIQUE')) throw new HttpError(409, 'Esa devolución ya se hizo.')
    throw e
  }
  if (owner) await notify(env, owner.user_id)
  return done()
}

// Datos que describen la sala. No los usa el Durable Object, que es quien escribe el resto de 'rooms'.
async function saveRoom(env: Env, admin: User, id: string, body: Record<string, unknown>): Promise<Response> {
  const name = text(body, 'name', 40, 'Escribe el nombre de la sala (hasta 40 letras).')
  const consoleName = text(body, 'console', 30, 'Escribe la consola (hasta 30 letras).')
  const game = typeof body.game === 'string' ? body.game.trim() : ''
  if (game.length > 60) throw new HttpError(400, 'El juego admite hasta 60 letras.')
  const r = await env.DB.prepare('UPDATE rooms SET name = ?, console = ?, game = ? WHERE id = ?').bind(name, consoleName, game, id).run()
  if (!r.meta.changes) throw new HttpError(404, 'No existe')
  await audit(env, admin, 'room.details', id, JSON.stringify({ name, console: consoleName, game })).run()
  return done()
}

function roomAction(body: Record<string, unknown>): AdminAction {
  switch (body.action) {
    case 'take':
    case 'release':
    case 'pause':
    case 'resume':
      return { action: body.action }
    case 'skip':
      return { action: 'skip', reason: readReason(body) }
    case 'refund':
      return { action: 'refund', minutes: integer(body, 'minutes', 1, 120, 'Escribe entre 1 y 120 minutos.'), reason: readReason(body) }
    case 'reorder':
      if (!Array.isArray(body.userIds) || !body.userIds.every((x): x is string => typeof x === 'string')) break
      return { action: 'reorder', userIds: body.userIds }
    case 'youtube':
      return { action: 'youtube', on: body.on === true }
  }
  throw new HttpError(400, 'Acción inválida')
}
