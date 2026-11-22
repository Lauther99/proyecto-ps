'use client'

// Cola de la sala: quién juega, a quién le toca y quién espera. Botones para entrar o salir.

import type { Me, RoomClient, RoomState } from '@/lib/room-client'
import { formatDuration, useCountdown } from '@/lib/use-room'
import { Button, Card } from './ui'

type Props = { client: RoomClient; state: RoomState; me: Me; clockOffset: number }

export default function QueuePanel({ client, state, me, clockOffset }: Props) {
  const turnLeft = useCountdown(state.current?.endsAt, clockOffset)
  const offerLeft = useCountdown(state.offer?.expiresAt, clockOffset)
  const position = state.queue.findIndex((m) => m.userId === me.userId)
  const involved =
    position >= 0 || state.current?.userId === me.userId || state.offer?.userId === me.userId

  return (
    <Card title="Cola">
      <div className="mb-3 text-sm">
        <p className="text-zinc-400">Jugando ahora</p>
        {state.current ? (
          <p className="font-medium text-zinc-100">
            {state.current.name}
            {state.current.isAdmin && <span className="ml-1 text-xs text-sky-400">(admin)</span>}
            {turnLeft !== null && <span className="ml-2 font-mono text-xs text-zinc-400">{formatDuration(turnLeft)}</span>}
          </p>
        ) : (
          <p className="text-zinc-500">Nadie</p>
        )}
      </div>

      {state.offer && state.offer.userId !== me.userId && (
        <p className="mb-3 text-sm text-zinc-400">
          Turno ofrecido a <span className="text-zinc-200">{state.offer.name}</span>
          {offerLeft !== null && <span className="ml-1 font-mono text-xs">({formatDuration(offerLeft)})</span>}
        </p>
      )}

      <ol className="mb-4 flex flex-col gap-1 text-sm">
        {state.queue.length === 0 && <li className="text-zinc-500">No hay nadie esperando.</li>}
        {state.queue.map((member, i) => (
          <li key={member.userId} className={member.userId === me.userId ? 'font-medium text-emerald-400' : 'text-zinc-300'}>
            {i + 1}. {member.name}
            {member.userId === me.userId && ' (tú)'}
          </li>
        ))}
      </ol>

      {state.paused && <p className="mb-3 text-xs text-amber-300">La sala está en pausa: no se ofrecen turnos nuevos.</p>}

      {!involved && (
        <Button variant="primary" className="w-full" onClick={() => client.send({ type: 'join' })}>
          Unirme a la cola
        </Button>
      )}
      {position >= 0 && (
        <Button className="w-full" onClick={() => client.send({ type: 'leave' })}>
          Salir de la cola (vas {position + 1}.º)
        </Button>
      )}
    </Card>
  )
}
