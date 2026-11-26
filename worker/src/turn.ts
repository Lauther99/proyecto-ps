// Servidores ICE para WebRTC. El agente está detrás del CGNAT de Movistar, así que el video
// necesita un relé (TURN). Usamos Cloudflare Realtime TURN: credenciales temporales por sesión.
// Sin claves configuradas (desarrollo local) devolvemos solo STUN, que basta dentro de la casa.

import type { Env } from './env'

const STUN_ONLY: RTCIceServerLike[] = [{ urls: 'stun:stun.cloudflare.com:3478' }]

export type RTCIceServerLike = { urls: string | string[]; username?: string; credential?: string }

export async function getIceServers(env: Env, ttlSeconds: number): Promise<RTCIceServerLike[]> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY
  let response: Response
  try {
    response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: ttlSeconds }),
      signal: AbortSignal.timeout(5000), // la sala no se queda esperando
    },
  )
  } catch (e) {
    console.error('TURN: sin respuesta', e)
    return STUN_ONLY
  }
  if (!response.ok) {
    console.error('TURN: no se pudieron generar credenciales', response.status)
    return STUN_ONLY
  }
  // La API devuelve { iceServers: [...] } (o un solo objeto en versiones anteriores).
  const data = (await response.json()) as { iceServers?: RTCIceServerLike | RTCIceServerLike[] }
  if (!data.iceServers) return STUN_ONLY
  return Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers]
}

// Usuarios TURN de una respuesta (para poder anularlos después).
export const turnUsernames = (servers: RTCIceServerLike[]): string[] =>
  servers.flatMap((s) => (typeof s.username === 'string' && s.username ? [s.username] : []))

// Anula credenciales antes de que venzan: así no sirven después del turno. Cloudflare responde 204.
export async function revokeCredentials(env: Env, usernames: string[]): Promise<void> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN || !usernames.length) return
  await Promise.all(
    usernames.map(async (username) => {
      try {
        const response = await fetch(
          `https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/${encodeURIComponent(username)}/revoke`,
          { method: 'POST', headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}` }, signal: AbortSignal.timeout(5000) },
        )
        // 404: ya no existe (venció); no es un problema.
        if (!response.ok && response.status !== 404) console.error('TURN: no se pudo anular una credencial', response.status)
      } catch (e) {
        console.error('TURN: sin respuesta al anular', e)
      }
    }),
  )
}
