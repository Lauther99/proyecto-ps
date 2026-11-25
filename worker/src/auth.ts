// Login con Google (OAuth 2.0 + PKCE) y sesiones con cookie. La cuenta se crea sola al entrar.
//
// La única pregunta "¿quién es este usuario?" está en getSessionUser(). Si algún día cambia el
// método de login, se cambia aquí y el resto del backend no se entera.

import type { Env, User } from './env'
import { HttpError, done, json, readBody, text } from './http'

const SESSION_COOKIE = 'ps_session'
const OAUTH_COOKIE = 'ps_oauth' // ata el login al navegador que lo empezó
const SESSION_DAYS = 30
const OAUTH_STATE_MINUTES = 10

// --- utilidades ---

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomToken(bytes = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(bytes)))
}

async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
}

async function sha256Hex(text: string): Promise<string> {
  return [...(await sha256(text))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? ''
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

function isSecure(env: Env): boolean {
  return env.APP_URL.startsWith('https://')
}

function cookie(env: Env, name: string, value: string, maxAgeSeconds: number): string {
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`]
  if (isSecure(env)) attrs.push('Secure')
  return attrs.join('; ')
}

const sessionCookie = (env: Env, value: string, maxAgeSeconds: number) => cookie(env, SESSION_COOKIE, value, maxAgeSeconds)

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' })
  for (const c of cookies) headers.append('Set-Cookie', c)
  return new Response(null, { status: 302, headers })
}

// Solo rutas internas: nada de otros sitios ni de la API.
function safeNext(next: string | null): string {
  if (!next || next.length > 300 || !/^\/(?![/\\])[^\\\s\x00-\x1f]*$/.test(next) || next.startsWith('/api')) return '/'
  return next
}

function adminEmails(env: Env): Set<string> {
  return new Set(
    (env.ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  )
}

// --- usuarios y sesiones ---

type Profile = { googleSub: string | null; email: string; name: string; picture: string | null }

const USER_COLUMNS = `u.id, u.email, u.name, COALESCE(u.nickname, 'Jugador') AS nickname, u.picture, u.status,
  u.blocked_reason AS blockedReason, u.role, u.notice`

// Crea o actualiza el usuario. Los correos de ADMIN_EMAILS entran como admin. Devuelve null si el correo
// ya pertenece a otra cuenta de Google.
async function upsertUser(env: Env, profile: Profile): Promise<{ id: string } | null> {
  const email = profile.email.toLowerCase()
  const isAdmin = adminEmails(env).has(email)
  const now = Date.now()
  const bySub = profile.googleSub
    ? await env.DB.prepare('SELECT id, google_sub FROM users WHERE google_sub = ?').bind(profile.googleSub).first<{ id: string; google_sub: string | null }>()
    : null
  const existing = bySub ?? (await env.DB.prepare('SELECT id, google_sub FROM users WHERE email = ?').bind(email).first<{ id: string; google_sub: string | null }>())
  if (existing && profile.googleSub && existing.google_sub && existing.google_sub !== profile.googleSub) return null

  const id = existing?.id ?? crypto.randomUUID()
  // El nombre de Google no se publica: apodo neutro, que el usuario puede cambiar.
  const nickname = `Jugador-${id.replace(/-/g, '').slice(0, 8)}`
  const statements = existing
    ? [
        env.DB.prepare(
          `UPDATE users SET name = ?, picture = ?, google_sub = COALESCE(?, google_sub), last_seen_at = ?,
                  nickname = COALESCE(nickname, ?), nickname_key = COALESCE(nickname_key, lower(?)),
                  status = CASE WHEN status = 'pending' THEN 'approved' ELSE status END
                  ${isAdmin ? ", role = 'admin'" : ''}
            WHERE id = ?`,
        ).bind(profile.name, profile.picture, profile.googleSub, now, nickname, nickname, id),
      ]
    : [
        env.DB.prepare(
          `INSERT INTO users (id, google_sub, email, name, nickname, nickname_key, picture, status, role, created_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?, lower(?), ?, 'approved', ?, ?, ?)`,
        ).bind(id, profile.googleSub, email, profile.name, nickname, nickname, profile.picture, isAdmin ? 'admin' : 'player', now, now),
      ]
  await env.DB.batch([...statements, env.DB.prepare('INSERT OR IGNORE INTO wallets (user_id) VALUES (?)').bind(id)])
  return { id }
}

async function createSession(env: Env, userId: string): Promise<string> {
  const token = randomToken()
  const now = Date.now()
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), userId, now, now + SESSION_DAYS * 86_400_000)
    .run()
  return sessionCookie(env, token, SESSION_DAYS * 86_400)
}

// ¿Quién hace esta petición? null si no tiene sesión válida.
export async function getSessionUser(request: Request, env: Env): Promise<User | null> {
  const token = readCookie(request, SESSION_COOKIE)
  if (!token) return null
  return env.DB.prepare(
    `SELECT ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`,
  )
    .bind(await sha256Hex(token), Date.now())
    .first<User>()
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const token = readCookie(request, SESSION_COOKIE)
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run()
  const response = done()
  response.headers.set('Set-Cookie', sessionCookie(env, '', 0))
  return response
}

// --- Google ---

function googleRedirectUri(env: Env): string {
  return `${env.APP_URL}/api/auth/google/callback`
}

export async function startGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return new Response('Login con Google no configurado (faltan GOOGLE_CLIENT_ID/SECRET)', { status: 503 })
  }
  const state = randomToken(16)
  const verifier = randomToken(32)
  const challenge = base64url(await sha256(verifier))
  // Se reutiliza si ya hay una: así varias pestañas pueden iniciar sesión a la vez.
  const browser = readCookie(request, OAUTH_COOKIE) || randomToken(16)
  const now = Date.now()
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE expires_at < ?').bind(now),
    env.DB.prepare('INSERT INTO oauth_states (state, code_verifier, expires_at, next, browser_hash) VALUES (?, ?, ?, ?, ?)').bind(
      state,
      verifier,
      now + OAUTH_STATE_MINUTES * 60_000,
      safeNext(new URL(request.url).searchParams.get('next')),
      await sha256Hex(browser),
    ),
  ])
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(env),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return redirect(url.toString(), [cookie(env, OAUTH_COOKIE, browser, OAUTH_STATE_MINUTES * 60)])
}

export async function finishGoogleLogin(request: Request, env: Env): Promise<Response> {
  const params = new URL(request.url).searchParams
  const code = params.get('code')
  const state = params.get('state')
  const fail = (reason: string) => redirect(`${env.APP_URL}/?login_error=${encodeURIComponent(reason)}`)
  if (!code || !state || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return fail('parametros')

  // El "state" debe ser uno que generamos hace poco, para ESTE navegador, y vale una sola vez. Si no,
  // alguien podría hacer que otra persona entre sin notarlo en una cuenta ajena.
  const browser = readCookie(request, OAUTH_COOKIE)
  const saved = await env.DB.prepare('DELETE FROM oauth_states WHERE state = ? RETURNING code_verifier, expires_at, next, browser_hash')
    .bind(state)
    .first<{ code_verifier: string; expires_at: number; next: string; browser_hash: string | null }>()
  if (!saved || saved.expires_at < Date.now()) return fail('expirado')
  if (!browser || saved.browser_hash !== (await sha256Hex(browser))) return fail('expirado')

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(env),
      grant_type: 'authorization_code',
      code_verifier: saved.code_verifier,
    }),
  })
  if (!tokenResponse.ok) return fail('token')
  const tokens = (await tokenResponse.json()) as { access_token?: string }
  if (!tokens.access_token) return fail('token')

  // Datos del perfil directamente de Google (así no hace falta verificar la firma del id_token).
  const infoResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  if (!infoResponse.ok) return fail('perfil')
  const info = (await infoResponse.json()) as {
    sub?: string
    email?: string
    email_verified?: boolean
    name?: string
    picture?: string
  }
  if (!info.sub || !info.email || !info.email_verified) return fail('correo')

  const user = await upsertUser(env, {
    googleSub: info.sub,
    email: info.email,
    name: info.name || 'Jugador',
    picture: info.picture ?? null,
  })
  if (!user) return fail('cuenta')
  return redirect(`${env.APP_URL}${saved.next}`, [await createSession(env, user.id)])
}

// --- login de desarrollo (solo local) ---

// Permite probar sin credenciales de Google. Doble candado: DEV_LOGIN=true en .dev.vars Y el
// frontend en localhost. En producción ninguna de las dos se cumple.
export function devLoginEnabled(env: Env): boolean {
  return env.DEV_LOGIN === 'true' && new URL(env.APP_URL).hostname === 'localhost'
}

export async function devLogin(request: Request, env: Env): Promise<Response> {
  if (!devLoginEnabled(env)) throw new HttpError(404, 'No disponible')
  const body = await readBody(request)
  const email = text(body, 'email', 100, 'Falta el correo.')
  if (!email.includes('@')) throw new HttpError(400, 'Falta el correo.')
  const user = await upsertUser(env, { googleSub: null, email, name: text(body, 'name', 60, 'Falta el nombre.'), picture: null })
  if (!user) throw new HttpError(409, 'No se pudo crear la cuenta.')
  const response = json({ id: user.id })
  response.headers.set('Set-Cookie', await createSession(env, user.id))
  return response
}
