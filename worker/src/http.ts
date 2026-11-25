// Respuestas, permisos y lectura segura de lo que manda el navegador.

import { getSessionUser } from './auth'
import type { Env, RateLimiter, User } from './env'

const MAX_BODY_BYTES = 10_000

// Error con mensaje para el usuario; index.ts lo convierte en respuesta.
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export const json = (data: unknown, status = 200): Response => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
export const done = (): Response => new Response(null, { status: 204 })

// Peticiones que cambian algo (POST) o abren WebSocket deben venir de nuestro frontend. Las cookies
// SameSite=Lax ya frenan casi todo; esto cierra el resto (por ejemplo, WebSocket desde otra web).
export function requireOrigin(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== new URL(env.APP_URL).origin) throw new HttpError(403, 'Origen no permitido')
}

export async function requireUser(request: Request, env: Env, opts: { admin?: boolean; allowBlocked?: boolean } = {}): Promise<User> {
  const user = await getSessionUser(request, env)
  if (!user) throw new HttpError(401, 'Inicia sesión')
  if (user.status === 'blocked' && !opts.allowBlocked) throw new HttpError(403, 'Tu cuenta está bloqueada.')
  if (opts.admin && user.role !== 'admin') throw new HttpError(403, 'Solo el admin')
  return user
}

export async function readBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Petición demasiado grande')
  let body: unknown
  try {
    body = JSON.parse(text || '{}')
  } catch {
    throw new HttpError(400, 'Petición inválida')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Petición inválida')
  return body as Record<string, unknown>
}

export function text(body: Record<string, unknown>, key: string, max: number, message: string): string {
  const v = body[key]
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) throw new HttpError(400, message)
  return v.trim()
}

export function integer(body: Record<string, unknown>, key: string, min: number, max: number, message: string): number {
  const v = body[key]
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, message)
  return v
}

export async function limit(limiter: RateLimiter | undefined, key: string): Promise<void> {
  if (limiter && !(await limiter.limit({ key })).success) throw new HttpError(429, 'Demasiados intentos. Espera un minuto.')
}
