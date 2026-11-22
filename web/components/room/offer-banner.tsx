'use client'

// "¡Es tu turno!": aparece cuando la sala te ofrece el turno. Tienes 60 s para aceptar.

import { useEffect } from 'react'
import type { RoomClient, RoomState } from '@/lib/room-client'
import { formatDuration, useCountdown } from '@/lib/use-room'
import { Button } from './ui'

type Props = { client: RoomClient; state: RoomState; clockOffset: number }

export default function OfferBanner({ client, state, clockOffset }: Props) {
  const left = useCountdown(state.offer?.expiresAt, clockOffset)

  // Avisa en el título de la pestaña, por si estás en otra pestaña.
  useEffect(() => {
    const previous = document.title
    document.title = '¡Es tu turno! · Sala PS4'
    return () => {
      document.title = previous
    }
  }, [])

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-600 bg-emerald-950/60 px-4 py-3">
      <div>
        <p className="font-semibold text-emerald-300">¡Es tu turno!</p>
        <p className="text-sm text-zinc-300">
          Acepta para empezar a jugar{left !== null && <> · quedan {formatDuration(left)}</>}. Si no aceptas, pierdes tu
          lugar.
        </p>
      </div>
      <div className="flex gap-2">
        <Button onClick={() => client.send({ type: 'leave' })}>Pasar</Button>
        <Button variant="primary" onClick={() => client.send({ type: 'accept' })}>
          Aceptar y jugar
        </Button>
      </div>
    </div>
  )
}
