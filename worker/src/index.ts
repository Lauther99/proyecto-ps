// Rutas del backend. El contrato completo con el frontend está en web/API.md.
//
//   Público:  /api/health  /api/site  /api/me  /api/auth/*  /api/room/ws
//   Jugador:  player.ts (cuenta, cola, recargas, historial, /api/turn)
//   Admin:    admin.ts (/api/admin/*)
//   Agente:   /api/agent/ws  /api/agent/turn  (AGENT_TOKEN)

import { adminRoutes } from './admin'
import { devLogin, devLoginEnabled, finishGoogleLogin, getSessionUser, logout, startGoogleLogin } from './auth'
import type { Env } from './env'
import { HttpError, json, limit, requireOrigin } from './http'
import { ROOM_ID, playerRoutes, publicUser, site } from './player'
import { getIceServers } from './turn'

export { Room } from './room'

const error = (status: number, message: string): Response => json({ error: message }, status)

// Comparación de tokens en tiempo constante (que no se pueda adivinar letra por letra).
function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  if (ea.length !== eb.length) return false
  let diff = 0
  for (let i = 0; i < ea.length; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

// El agente se identifica con el token en "Authorization: Bearer <token>" o, como su librería de
// WebSocket no permite cabeceras propias, como subprotocolo: "Sec-WebSocket-Protocol: ps4-agent, <token>".
// (Sin "export": Cloudflare trata cada export del archivo principal como handler o clase.)
const AGENT_SUBPROTOCOL = 'ps4-agent'

function agentToken(request: Request): string | null {
  const auth = request.headers.get('Authorization') ?? ''
  if (auth.startsWith('Bearer ')) return auth.slice(7)
  const protocols = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim())
  if (protocols[0] === AGENT_SUBPROTOCOL && protocols[1]) return protocols[1]
  return null
}

function isAgent(request: Request, env: Env): boolean {
  const token = agentToken(request)
  return Boolean(env.AGENT_TOKEN) && token !== null && safeEqual(token, env.AGENT_TOKEN ?? '')
}

// Reenvía el WebSocket a la sala con la identidad en cabeceras internas. Se arma una petición
// nueva para que ninguna cabecera X-User-* enviada por el navegador llegue a la sala.
function toRoom(request: Request, env: Env, headers: Record<string, string>): Promise<Response> {
  const stub = env.ROOM.get(env.ROOM.idFromName(ROOM_ID))
  return stub.fetch(new Request(request.url, { headers: { Upgrade: 'websocket', ...headers } }))
}

const clientIp = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'local'

async function handle(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method

  if (path === '/api/health') return json({ ok: true })
  if (method === 'POST') requireOrigin(request, env)

  // --- login ---
  if (path === '/api/auth/google/login' && method === 'GET') {
    await limit(env.LIMITER, `login:${clientIp(request)}`)
    return startGoogleLogin(request, env)
  }
  if (path === '/api/auth/google/callback' && method === 'GET') return finishGoogleLogin(request, env)
  if (path === '/api/auth/dev-login' && method === 'POST') return devLogin(request, env)
  if (path === '/api/auth/logout' && method === 'POST') return logout(request, env)

  if (path === '/api/site' && method === 'GET') return site(env)
  if (path === '/api/me' && method === 'GET') {
    const user = await getSessionUser(request, env)
    const dev = devLoginEnabled(env)
    return user ? json({ user: await publicUser(env, user), devLogin: dev }) : json({ user: null, devLogin: dev }, 401)
  }

  // --- sala: cualquiera mira; solo quien tiene sesión es alguien ---
  if (path === '/api/room/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return error(426, 'Se esperaba WebSocket')
    requireOrigin(request, env)
    const user = await getSessionUser(request, env)
    return toRoom(request, env, { 'X-Room-Role': 'browser', ...(user && user.status !== 'blocked' ? { 'X-User-Id': user.id } : {}) })
  }

  // --- agente ---
  if (path === '/api/agent/ws') {
    if (request.headers.get('Upgrade') !== 'websocket') return error(426, 'Se esperaba WebSocket')
    if (!isAgent(request, env)) return error(401, 'Token de agente inválido')
    // Si pidió subprotocolo, la respuesta debe confirmarlo (si no, el cliente cierra la conexión).
    const usedSubprotocol = (request.headers.get('Sec-WebSocket-Protocol') ?? '').startsWith(AGENT_SUBPROTOCOL)
    return toRoom(request, env, { 'X-Room-Role': 'agent', ...(usedSubprotocol ? { 'X-Agent-Subprotocol': '1' } : {}) })
  }
  if (path === '/api/agent/turn' && method === 'GET') {
    if (!isAgent(request, env)) return error(401, 'Token de agente inválido')
    return json({ iceServers: await getIceServers(env, 4 * 60 * 60) })
  }

  return (await playerRoutes(request, env, path)) ?? (await adminRoutes(request, env, path)) ?? error(404, 'No encontrado')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env)
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message)
      console.error(e)
      return error(500, 'Error interno')
    }
  },
} satisfies ExportedHandler<Env>
