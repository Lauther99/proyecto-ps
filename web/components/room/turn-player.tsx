'use client'

// Vista del jugador durante su turno: reproductor WebRTC (señalización por la sala), cuenta
// regresiva y botón para dejar el turno.

import { useEffect, useState } from 'react'
import Ps4Player from '@/components/ps4-player'
import { fetchIceServers } from '@/lib/api'
import type { RoomClient, RoomState } from '@/lib/room-client'
import { roomSignaling } from '@/lib/signaling'
import { formatDuration, useCountdown } from '@/lib/use-room'
import { Button } from './ui'

type Props = { client: RoomClient; state: RoomState; clockOffset: number; isAdmin: boolean }

export default function TurnPlayer({ client, state, clockOffset, isAdmin }: Props) {
  const [signaling] = useState(() => roomSignaling(client))
  const [iceServers, setIceServers] = useState<RTCIceServer[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const remaining = useCountdown(state.current?.endsAt, clockOffset)

  useEffect(() => {
    fetchIceServers()
      .then((servers) => setIceServers(servers as RTCIceServer[]))
      .catch((err) => setError(String(err)))
  }, [])

  if (error) return <p className="text-sm text-red-400">No se pudo preparar la conexión: {error}</p>
  if (!iceServers) return <p className="text-sm text-zinc-400">Preparando la conexión…</p>

  return (
    <div className="flex flex-col gap-2">
      {!state.agentOnline ? (
        <p className="rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
          El agente de la consola no está conectado a la sala. Hasta que vuelva, no hay video ni controles.
        </p>
      ) : (
        !state.ps4Connected && (
          <p className="rounded-md bg-amber-900/40 px-3 py-2 text-sm text-amber-200">
            Conectando con la consola… (si tarda, la consola puede estar en reposo o reiniciando la sesión)
          </p>
        )
      )}
      <Ps4Player signaling={signaling} iceServers={iceServers}>
        {remaining !== null && (
          <span className={`font-mono text-sm ${remaining < 60_000 ? 'text-amber-300' : 'text-zinc-300'}`}>
            Quedan {formatDuration(remaining)}
          </span>
        )}
        <Button variant="danger" onClick={() => (isAdmin ? client.admin('release') : client.send({ type: 'leave' }))}>
          {isAdmin ? 'Soltar control' : 'Dejar turno'}
        </Button>
      </Ps4Player>
    </div>
  )
}
