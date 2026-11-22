// Rutas del backend.
//
//   GET  /api/health
//   GET  /api/auth/google/login        -> redirige a Google
//   GET  /api/auth/google/callback     -> vuelve de Google, crea la sesión
//   POST /api/auth/dev-login           -> SOLO local, sin Google: {email, name}
//   POST /api/auth/logout
//   GET  /api/me                       -> usuario de la sesión (401 si no hay)
//   GET  /api/turn                     -> servidores ICE (solo usuarios aprobados)
//   GET  /api/admin/users              -> lista de usuarios (admin)
//   POST /api/admin/users/:id          -> {status?, role?} (admin)
//   GET  /api/room/ws                  -> WebSocket de la sala (usuarios aprobados)
//   GET  /api/agent/ws                 -> WebSocket del agente (Authorization: Bearer AGENT_TOKEN)
//   GET  /api/agent/turn               -> servidores ICE para el agente (mismo token)

import { devLogin, devLoginEnabled, finishGoogleLogin, getSessionUser, logout, startGoogleLogin } from './auth'
import type { Env, User, UserRole, UserStatus } from './env'
import { getIceServers } from './turn'

export { Room } from './room'

const ROOM_NAME = 'main' // una consola por ahora

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status })
}

function error(status: number, message: string): Response {
  return json({ error: message }, status)
}

// Peticiones que cambian algo (POST) o abren WebSocket deben venir de nuestro frontend. Las cookies
// SameSite=Lax ya frenan casi todo; esto cierra el resto (por ejemplo, WebSocket desde otra web).
function sameOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get('Origin')
  return origin === new URL(env.APP_URL).origin
}

// Comparación de tokens en tiempo constante (que no se pueda adivinar letra por letra).
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

function isAgent(request: Request, env: Env): boolean {
  const header = request.headers.get('Authorization') ?? ''
  return Boolean(env.AGENT_TOKEN) && header.startsWith('Bearer ') && safeEqual(header.slice(7), env.AGENT_TOKEN ?? '')
}

async function requireUser(request: Request, env: Env, opts: { approved?: boolean; admin?: boolean } = {}) {
  const user = await getSessionUser(request, env)
  if (!user) return { response: error(401, 'Inicia sesión') }
  if (user.status === 'blocked') return { response: error(403, 'Cuenta bloqueada') }
  if ((opts.approved || opts.admin) && user.status !== 'approved') return { response: error(403, 'Pendiente de aprobación') }
  if (opts.admin && user.role !== 'admin') return { response: error(403, 'Solo el admin') }
  return { user }
}

// Reenvía el WebSocket a la sala con la identidad en cabeceras internas. Se arma una petición
// nueva para que ninguna cabecera X-User-* enviada por el navegador llegue a la sala.
function toRoom(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const stub = env.ROOM.get(env.ROOM.idFromName(ROOM_NAME))
  return stub.fetch(new Request(request.url, { headers: { Upgrade: 'websocket', ...headers } }))
}

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  if (path === '/api/health') return json({ ok: true })

  // --- login ---
  if (path === '/api/auth/google/login' && method === 'GET') return startGoogleLogin(env)
  if (path === '/api/auth/google/callback' && method === 'GET') return finishGoogleLogin(request, env)
  if (path === '/api/auth/dev-login' && method === 'POST') {
    if (!sameOrigin(request, env)) return error(403, 'Origen no permitido')
    return devLogin(request, env)
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    if (!sameOrigin(request, env)) return error(403, 'Origen no permitido')
    return logout(request, env)
  }

  if (path === '/api/me' && method === 'GET') {
    const user = await getSessionUser(request, env)
    return user ? json({ user, devLogin: devLoginEnabled(env) }) : json({ user: null, devLogin: devLoginEnabled(env) }, 401)
  }

  if (path === '/api/turn' && method === 'GET') {
    const r = await requireUser(request, env, { approved: true })
    if (r.response) return r.response
    return json({ iceServers: await getIceServers(env) })
  }

  // --- admin: usuarios ---
  if (path === '/api/admin/users' && method === 'GET') {
    const r = await requireUser(request, env, { admin: true })
    if (r.response) return r.response
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.picture, u.status, u.role, u.created_at, u.last_seen_at,
              COALESCE(SUM(t.ended_at - t.started_at), 0) AS played_ms
         FROM users u LEFT JOIN turns t ON t.user_id = u.id
        GROUP BY u.id ORDER BY u.status = 'pending' DESC, u.created_at DESC`,
    ).all()
    return json({ users: results })
  }
  const userMatch = path.match(/^\/api\/admin\/users\/([\w-]+)$/)
  if (userMatch && method === 'POST') {
    if (!sameOrigin(request, env)) return error(403, 'Origen no permitido')
    const r = await requireUser(request, env, { admin: true })
    if (r.response) return r.response
    const targetId = userMatch[1] ?? ''
    if (targetId === r.user.id) return error(400, 'No puedes cambiar tu propia cuenta')
    const body = (await request.json().catch(() => ({}))) as { status?: UserStatus; role?: UserRole }
    const statuses: UserStatus[] = ['pending', 'approved', 'blocked']
    const roles: UserRole[] = ['player', 'admin']
    if (body.status && !statuses.includes(body.status)) return error(400, 'Estado inválido')
    if (body.role && !roles.includes(body.role)) return error(400, 'Rol inválido')
    if (body.status) await env.DB.prepare('UPDATE users SET status = ? WHERE id = ?').bind(body.status, targetId).run()
    if (body.role) await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind(body.role, targetId).run()
    // Bloquear cierra sus sesiones al instante.
    if (body.status === 'blocked') await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(targetId).run()
    const user = await env.DB.prepare('SELECT id, email, name, picture, status, role FROM users WHERE id = ?')
      .bind(targetId)
      .first<User>()
    return user ? json({ user }) : error(404, 'No existe')
  }

  // --- sala ---
  if (path === '/api/room/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return error(426, 'Se esperaba WebSocket')
    if (!sameOrigin(request, env)) return error(403, 'Origen no permitido')
    const r = await requireUser(request, env, { approved: true })
    if (r.response) return r.response
    return toRoom(request, env, {
      'X-Room-Role': 'browser',
      'X-User-Id': r.user.id,
      'X-User-Name': encodeURIComponent(r.user.name).slice(0, 200),
      'X-User-Admin': r.user.role === 'admin' ? '1' : '0',
    })
  }

  // --- agente ---
  if (path === '/api/agent/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return error(426, 'Se esperaba WebSocket')
    if (!isAgent(request, env)) return error(401, 'Token de agente inválido')
    return toRoom(request, env, { 'X-Room-Role': 'agent' })
  }
  if (path === '/api/agent/turn' && method === 'GET') {
    if (!isAgent(request, env)) return error(401, 'Token de agente inválido')
    return json({ iceServers: await getIceServers(env) })
  }

  return error(404, 'No encontrado')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch (e) {
      console.error(e)
      return error(500, 'Error interno')
    }
  },
} satisfies ExportedHandler<Env>
