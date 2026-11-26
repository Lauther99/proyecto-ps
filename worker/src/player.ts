// Rutas del jugador y del sitio: configuración, cuenta, recargas, historial y cola.

import type { Env, User } from './env'
import { HttpError, done, integer, json, limit, readBody, requireUser, text } from './http'
import type { OpResult } from './room'
import { getIceServers } from './turn'

const TEST_TTL_S = 120
const SPEED_CHUNK = 64 * 1024
const SPEED_CHUNKS = 400 // 25 MB
export const ROOM_ID = 'main' // una consola por ahora
export const roomStub = (env: Env) => env.ROOM.get(env.ROOM.idFromName(ROOM_ID))

export type Settings = {
  blockMinutes: number
  blockCredits: number
  maxMinutes: number
  acceptSeconds: number
  yapeHolder: string
  yapeNumber: string
  yapeQrUrl: string | null
  youtubeChannelId: string | null
}

export async function getSettings(env: Env): Promise<Settings> {
  const s = await env.DB.prepare(
    `SELECT block_minutes AS blockMinutes, block_credits AS blockCredits, max_minutes AS maxMinutes,
            accept_seconds AS acceptSeconds, yape_holder AS yapeHolder, yape_number AS yapeNumber,
            yape_qr_url AS yapeQrUrl, youtube_channel_id AS youtubeChannelId
       FROM settings WHERE id = 1`,
  ).first<Settings>()
  if (!s) throw new Error('Falta la configuración')
  return s
}

export async function getGames(env: Env) {
  const { results } = await env.DB.prepare('SELECT id, name, genre, players, status, art FROM games ORDER BY name').all<{ art: string | null }>()
  return results.map(({ art, ...g }) => (art ? { ...g, art: JSON.parse(art) as string[] } : g))
}

export async function site(env: Env): Promise<Response> {
  const [config, rooms, games] = await Promise.all([
    getSettings(env),
    env.DB.prepare('SELECT id, name, console, game FROM rooms ORDER BY id').all(),
    getGames(env),
  ])
  return json({ config, rooms: rooms.results, games })
}

export async function publicUser(env: Env, user: User) {
  const w = await env.DB.prepare('SELECT available, reserved FROM wallets WHERE user_id = ?').bind(user.id).first<{ available: number; reserved: number }>()
  const { notice, ...rest } = user
  return { ...rest, balance: w ?? { available: 0, reserved: 0 }, notice: notice ? (JSON.parse(notice) as unknown) : null }
}

// Respuesta de una operación de la sala.
export function fromRoom(r: OpResult): Response {
  if (!r.ok) throw new HttpError(r.status, r.error)
  return done()
}

const NICKNAME = /^[\p{L}\p{N}._-]{3,20}$/u

// Devuelve null si la ruta no es de aquí.
export async function playerRoutes(request: Request, env: Env, path: string): Promise<Response | null> {
  const get = request.method === 'GET'
  const post = request.method === 'POST'

  if (get && path === '/api/turn') {
    const user = await requireUser(request, env)
    // La sala las genera y las anota, para anularlas cuando termine el turno.
    const iceServers = await roomStub(env).turnCredentials(user.id)
    if (iceServers === null) throw new HttpError(403, 'No tienes el turno.')
    return json({ iceServers })
  }

  // Prueba de conexión: credenciales de dos minutos, solo con sesión y con freno por usuario.
  if (get && path === '/api/turn/test') {
    const user = await requireUser(request, env)
    await limit(env.LIMITER, `turn-test:${user.id}`)
    return json({ iceServers: await getIceServers(env, TEST_TTL_S) })
  }

  // Prueba de velocidad: datos al azar (no se comprimen). El navegador corta a los pocos segundos.
  if (get && path === '/api/speed') {
    const user = await requireUser(request, env)
    await limit(env.LIMITER, `speed:${user.id}`)
    const chunk = crypto.getRandomValues(new Uint8Array(SPEED_CHUNK))
    let left = SPEED_CHUNKS
    const body = new ReadableStream({
      pull(c) {
        if (left-- > 0) c.enqueue(chunk.slice())
        else c.close()
      },
    })
    return new Response(body, { headers: { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store, no-transform' } })
  }

  if (post && path === '/api/me') {
    const user = await requireUser(request, env)
    await limit(env.LIMITER, `nick:${user.id}`)
    const nickname = text(await readBody(request), 'nickname', 40, 'Escribe un apodo.').normalize('NFC')
    if (!NICKNAME.test(nickname)) throw new HttpError(400, 'Usa entre 3 y 20 letras, números, puntos o guiones.')
    try {
      await env.DB.prepare('UPDATE users SET nickname = ?, nickname_key = ? WHERE id = ?').bind(nickname, nickname.toLowerCase(), user.id).run()
    } catch (e) {
      if (String(e).includes('UNIQUE')) throw new HttpError(409, 'Ese apodo ya está en uso.')
      throw e
    }
    await roomStub(env).refresh()
    return done()
  }
  if (post && path === '/api/me/notice/dismiss') {
    const user = await requireUser(request, env, { allowBlocked: true })
    await env.DB.prepare('UPDATE users SET notice = NULL WHERE id = ?').bind(user.id).run()
    return done()
  }

  // --- cola y turno ---
  if (post && path === '/api/queue/join') {
    const user = await requireUser(request, env)
    const s = await getSettings(env)
    const minutes = integer(await readBody(request), 'minutes', s.blockMinutes, s.maxMinutes, 'Elige un bloque válido.')
    if (minutes % s.blockMinutes !== 0) throw new HttpError(400, 'Elige un bloque válido.')
    return fromRoom(await roomStub(env).join(user.id, minutes, (minutes / s.blockMinutes) * s.blockCredits))
  }
  const op = post && path.match(/^\/api\/(queue\/leave|turn\/accept|turn\/decline|turn\/end)$/)?.[1]
  if (op) {
    const user = await requireUser(request, env)
    const room = roomStub(env)
    const call = { 'queue/leave': () => room.leave(user.id), 'turn/accept': () => room.accept(user.id), 'turn/decline': () => room.decline(user.id), 'turn/end': () => room.end(user.id) }[op]
    if (call) return fromRoom(await call())
  }

  // --- créditos e historial ---
  if (path === '/api/recharges' && get) {
    const user = await requireUser(request, env, { allowBlocked: true })
    const { results } = await env.DB.prepare(
      'SELECT id, amount, operation, created_at AS createdAt, status, reason FROM recharges WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    )
      .bind(user.id)
      .all()
    return json({ recharges: results })
  }
  if (path === '/api/recharges' && post) return createRecharge(request, env)
  if (get && path === '/api/movements') {
    const user = await requireUser(request, env, { allowBlocked: true })
    // Reservar y liberar no cambian lo que tienes en total: se muestran los cobros y lo que entra.
    const { results } = await env.DB.prepare(
      `SELECT CAST(id AS TEXT) AS id, created_at AS createdAt, detail,
              CASE kind WHEN 'charge' THEN reserved_delta ELSE available_delta END AS credits
         FROM ledger WHERE user_id = ? AND kind NOT IN ('reserve', 'release') ORDER BY ledger.id DESC LIMIT 200`,
    )
      .bind(user.id)
      .all()
    return json({ movements: results })
  }
  if (get && path === '/api/sessions') {
    const user = await requireUser(request, env, { allowBlocked: true })
    const { results } = await env.DB.prepare(`${SESSIONS} AND b.user_id = ? ORDER BY b.ended_at DESC LIMIT 100`).bind(user.id).all()
    return json({ sessions: results })
  }
  const rating = post && path.match(/^\/api\/sessions\/([\w-]{1,64})\/rating$/)?.[1]
  if (rating) {
    const user = await requireUser(request, env)
    const body = await readBody(request)
    const score = integer(body, 'score', 1, 5, 'Calificación inválida.')
    const problems = Array.isArray(body.problems) ? body.problems.filter((p): p is string => typeof p === 'string').map((p) => p.slice(0, 40)).slice(0, 8) : []
    const r = await env.DB.prepare('UPDATE bookings SET rating = ?, problems = ? WHERE id = ? AND user_id = ? AND started_at IS NOT NULL AND ended_at IS NOT NULL')
      .bind(score, JSON.stringify(problems), rating, user.id)
      .run()
    if (!r.meta.changes) throw new HttpError(404, 'No existe esa partida.')
    return done()
  }
  return null
}

// Partidas que empezaron y ya terminaron.
export const SESSIONS = `
  SELECT b.id, b.started_at AS startedAt, COALESCE(b.game, r.game) AS game, b.played_ms AS playedMs, b.credits AS chargedCredits,
         b.refunded AS refundedCredits, COALESCE(b.result, 'interrupted') AS result, u.nickname
    FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN users u ON u.id = b.user_id
   WHERE b.started_at IS NOT NULL AND b.ended_at IS NOT NULL`

const RECHARGE = 'SELECT id, amount, operation, created_at AS createdAt, status, reason FROM recharges WHERE user_id = ? AND request_key = ?'

async function createRecharge(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env)
  await limit(env.LIMITER, `recharge:${user.id}`)
  const body = await readBody(request)
  const amount = integer(body, 'amount', 1, 500, 'El monto va de S/ 1 a S/ 500, sin céntimos.')
  const operation = text(body, 'operation', 20, 'Escribe el número de operación.')
  if (!/^\d{6}$/.test(operation)) throw new HttpError(400, 'Escribe los 6 dígitos del número de operación.')
  const key = text(body, 'key', 100, 'Petición inválida')

  const previous = await env.DB.prepare(RECHARGE).bind(user.id, key).first()
  if (previous) return json({ recharge: previous })
  const s = await getSettings(env)
  if (!s.yapeNumber || !s.yapeHolder) throw new HttpError(409, 'Las recargas no están disponibles.')
  // Las condiciones van dentro del INSERT: dos envíos a la vez no las esquivan.
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO recharges (id, user_id, request_key, amount, operation, created_at)
     SELECT ?1, ?2, ?3, ?4, ?5, ?6
      WHERE (SELECT COUNT(*) FROM recharges WHERE user_id = ?2 AND status = 'pending') < 3
        AND NOT EXISTS (SELECT 1 FROM recharges WHERE user_id = ?2 AND operation = ?5 AND status = 'pending')`,
  )
    .bind(crypto.randomUUID(), user.id, key, amount, operation, Date.now())
    .run()
  const recharge = await env.DB.prepare(RECHARGE).bind(user.id, key).first()
  if (recharge) return json({ recharge })
  if (!r.meta.changes) throw new HttpError(409, 'Ya enviaste ese número de operación, o tienes 3 recargas esperando revisión.')
  throw new Error('La recarga no se guardó')
}
