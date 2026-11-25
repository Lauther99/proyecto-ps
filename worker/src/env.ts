import type { Room } from './room'

export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

export interface Env {
  ROOM: DurableObjectNamespace<Room>
  DB: D1Database
  APP_URL: string
  LIMITER?: RateLimiter
  ADMIN_EMAILS?: string
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  AGENT_TOKEN?: string
  TURN_KEY_ID?: string
  TURN_KEY_API_TOKEN?: string
  DEV_LOGIN?: string
}

export type UserStatus = 'pending' | 'approved' | 'blocked'
export type UserRole = 'player' | 'admin'

export type User = {
  id: string
  email: string
  name: string
  nickname: string
  picture: string | null
  status: UserStatus
  blockedReason: string | null
  role: UserRole
  notice: string | null // JSON
}
