'use client'

// Controles del admin sobre la sala. La lista de usuarios está en /admin.

import Link from 'next/link'
import type { Me, RoomClient, RoomState } from '@/lib/room-client'
import { Button, Card } from './ui'

const TURN_OPTIONS = [15, 30, 45, 60]

type Props = { client: RoomClient; state: RoomState; me: Me }

export default function AdminControls({ client, state, me }: Props) {
  const playing = state.current?.userId === me.userId
  return (
    <Card title="Admin">
      <div className="flex flex-col gap-2">
        {playing ? (
          <Button onClick={() => client.admin('release')}>Soltar control</Button>
        ) : (
          <Button variant="primary" onClick={() => client.admin('take')}>
            Tomar el control ahora
          </Button>
        )}
        <Button onClick={() => client.admin('skip')} disabled={!state.current || playing}>
          Terminar turno actual
        </Button>
        <Button onClick={() => client.admin(state.paused ? 'resume' : 'pause')}>
          {state.paused ? 'Reanudar sala' : 'Pausar sala'}
        </Button>

        <label className="mt-2 flex items-center justify-between gap-2 text-sm text-zinc-300">
          Duración del turno
          <select
            className="rounded-md bg-zinc-800 px-2 py-1 text-sm"
            value={state.turnMinutes}
            onChange={(e) => client.admin('turnMinutes', Number(e.target.value))}
          >
            {[...new Set([...TURN_OPTIONS, state.turnMinutes])]
              .sort((a, b) => a - b)
              .map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
          </select>
        </label>

        <label className="flex items-center justify-between gap-2 text-sm text-zinc-300">
          Transmitir a YouTube
          <input
            type="checkbox"
            className="h-4 w-4 accent-emerald-500"
            checked={state.youtube}
            onChange={(e) => client.admin('youtube', e.target.checked)}
          />
        </label>

        <Link href="/admin" className="mt-2 text-sm text-sky-400 hover:underline">
          Usuarios y aprobaciones →
        </Link>
      </div>
    </Card>
  )
}
