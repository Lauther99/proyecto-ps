// Llamadas HTTP al backend (worker/). Todas van a /api/* del mismo dominio.

export type UserStatus = 'pending' | 'approved' | 'blocked'
export type UserRole = 'player' | 'admin'

export type User = {
  id: string
  email: string
  name: string
  picture: string | null
  status: UserStatus
  role: UserRole
}

export type AdminUser = User & { created_at: number; last_seen_at: number | null; played_ms: number }

export type IceServer = { urls: string | string[]; username?: string; credential?: string }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'same-origin', ...init })
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Error ${res.status}`)
  }
  return (res.status === 204 ? null : await res.json()) as T
}

// Sesión actual. 'user' es null si no hay sesión; 'devLogin' indica si el login de pruebas está activo.
export async function fetchMe(): Promise<{ user: User | null; devLogin: boolean }> {
  const res = await fetch('/api/me', { credentials: 'same-origin' })
  if (res.status === 401 || res.ok) return res.json()
  throw new Error(`No se pudo consultar la sesión (${res.status})`)
}

export function devLogin(email: string, name: string) {
  return request<User>('/api/auth/dev-login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  })
}

export function logout() {
  return request<null>('/api/auth/logout', { method: 'POST' })
}

export async function fetchIceServers(): Promise<IceServer[]> {
  return (await request<{ iceServers: IceServer[] }>('/api/turn')).iceServers
}

export async function fetchUsers(): Promise<AdminUser[]> {
  return (await request<{ users: AdminUser[] }>('/api/admin/users')).users
}

export function updateUser(id: string, change: { status?: UserStatus; role?: UserRole }) {
  return request<{ user: User }>(`/api/admin/users/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(change),
  })
}
