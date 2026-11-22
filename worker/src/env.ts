import type { Room } from './room'

export interface Env {
  ROOM: DurableObjectNamespace<Room>
  DB: D1Database
  APP_URL: string
  ADMIN_EMAILS: string
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
  picture: string | null
  status: UserStatus
  role: UserRole
}
