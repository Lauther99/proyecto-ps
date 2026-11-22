'use client'

import { useState } from 'react'
import { devLogin } from '@/lib/api'
import { Button, Card } from './ui'

const LOGIN_ERRORS: Record<string, string> = {
  expirado: 'El inicio de sesión tardó demasiado. Inténtalo otra vez.',
  correo: 'Tu cuenta de Google no tiene un correo verificado.',
  bloqueado: 'Tu cuenta está bloqueada.',
}

export default function LoginScreen({ devLoginEnabled, onLoggedIn }: { devLoginEnabled: boolean; onLoggedIn: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    const code = new URLSearchParams(window.location.search).get('login_error')
    return code ? (LOGIN_ERRORS[code] ?? 'No se pudo iniciar sesión.') : null
  })

  const submitDev = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await devLogin(email, name)
      onLoggedIn()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="mb-1 text-xl font-semibold text-zinc-100">Sala PS4</h1>
        <p className="mb-6 text-sm text-zinc-400">Entra con tu cuenta para unirte a la cola y jugar por turnos.</p>
        <a
          href="/api/auth/google/login"
          className="block rounded-md bg-white px-3 py-2 text-center text-sm font-medium text-zinc-900 hover:bg-zinc-200"
        >
          Entrar con Google
        </a>
        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        {devLoginEnabled && (
          <form onSubmit={submitDev} className="mt-6 border-t border-zinc-800 pt-4">
            <p className="mb-2 text-xs text-amber-300">Login de desarrollo (solo en localhost)</p>
            <input
              className="mb-2 w-full rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
              placeholder="correo@ejemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <input
              className="mb-2 w-full rounded-md bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100"
              placeholder="Nombre"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button type="submit" className="w-full">
              Entrar sin Google
            </Button>
          </form>
        )}
      </Card>
    </div>
  )
}
