'use client'

// Hook de React para la sala: abre la conexión al montar y la cierra al desmontar.

import { useEffect, useState } from 'react'
import { RoomClient, type Me, type RoomState } from './room-client'

export function useRoom() {
  const [client] = useState(() => new RoomClient())
  const [state, setState] = useState<RoomState | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Diferencia entre el reloj del servidor y el nuestro, para que las cuentas regresivas coincidan.
  const [clockOffset, setClockOffset] = useState(0)

  useEffect(() => {
    const offMessage = client.onMessage((message) => {
      if (message.type === 'hello') setMe(message.me)
      else if (message.type === 'state') {
        setState(message.state)
        setClockOffset(message.state.now - Date.now())
      } else if (message.type === 'error') setError(message.message)
    })
    const offStatus = client.onStatus(setConnected)
    client.connect()
    return () => {
      offMessage()
      offStatus()
      client.close()
    }
  }, [client])

  return { client, state, me, connected, error, clearError: () => setError(null), clockOffset }
}

// Milisegundos que faltan hasta 'deadline' (hora del servidor), actualizado cada segundo.
export function useCountdown(deadline: number | null | undefined, clockOffset: number): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!deadline) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [deadline])
  if (!deadline) return null
  return Math.max(0, deadline - (now + clockOffset))
}

export function formatDuration(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}
