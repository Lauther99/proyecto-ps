'use client'

// Punto de entrada de la sala: decide qué mostrar según la sesión.
//   sin sesión -> login | pendiente -> "esperando aprobación" | bloqueado -> aviso | aprobado -> sala

import { useCallback, useEffect, useState } from 'react'
import { fetchMe, logout, type User } from '@/lib/api'
import LoginScreen from './login-screen'
import RoomView from './room-view'
import { Button, Card } from './ui'

type Session = { user: User | null; devLogin: boolean }

export default function RoomApp() {
  const [session, setSession] = useState<Session | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    fetchMe()
      .then(setSession)
      .catch((err) => setError(String(err)))
  }, [])

  useEffect(refresh, [refresh])

  const doLogout = async () => {
    await logout().catch(() => undefined)
    refresh()
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-red-400">
        No se pudo conectar con el servidor: {error}
      </div>
    )
  }
  if (!session) return <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Cargando…</div>
  if (!session.user) return <LoginScreen devLoginEnabled={session.devLogin} onLoggedIn={refresh} />

  const { user } = session
  if (user.status !== 'approved') {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <h1 className="mb-2 text-lg font-semibold text-zinc-100">
            {user.status === 'blocked' ? 'Cuenta bloqueada' : 'Pendiente de aprobación'}
          </h1>
          <p className="mb-4 text-sm text-zinc-400">
            {user.status === 'blocked'
              ? 'El admin bloqueó esta cuenta.'
              : `Hola ${user.name}. El admin tiene que aprobar tu cuenta (${user.email}) antes de que puedas entrar a la sala.`}
          </p>
          <div className="flex gap-2">
            {user.status === 'pending' && <Button onClick={refresh}>Ya me aprobaron</Button>}
            <Button onClick={doLogout}>Salir</Button>
          </div>
        </Card>
      </div>
    )
  }

  return <RoomView user={user} onLogout={doLogout} />
}
