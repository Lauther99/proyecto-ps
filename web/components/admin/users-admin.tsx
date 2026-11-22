'use client'

// Panel de usuarios: aprobar a los que entraron con Google, bloquear y dar rol de admin.

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { fetchMe, fetchUsers, updateUser, type AdminUser, type UserRole, type UserStatus } from '@/lib/api'
import { Button, Card } from '@/components/room/ui'

const STATUS_LABEL: Record<UserStatus, string> = { pending: 'Pendiente', approved: 'Aprobado', blocked: 'Bloqueado' }
const STATUS_COLOR: Record<UserStatus, string> = {
  pending: 'text-amber-300',
  approved: 'text-emerald-400',
  blocked: 'text-red-400',
}

function formatPlayed(ms: number): string {
  const minutes = Math.round(ms / 60_000)
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export default function UsersAdmin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [myId, setMyId] = useState<string | null>(null)

  useEffect(() => {
    fetchMe()
      .then((s) => setMyId(s.user?.id ?? null))
      .catch(() => undefined)
  }, [])

  const load = useCallback(() => {
    fetchUsers()
      .then(setUsers)
      .catch((err) => setError(String(err)))
  }, [])
  useEffect(load, [load])

  const change = async (id: string, update: { status?: UserStatus; role?: UserRole }) => {
    try {
      await updateUser(id, update)
      load()
    } catch (err) {
      setError(String(err))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-zinc-100">Usuarios</h1>
        <Link href="/" className="text-sm text-sky-400 hover:underline">
          ← Volver a la sala
        </Link>
      </header>
      {error && <p className="text-sm text-red-400">{error}</p>}
      <Card>
        {!users ? (
          <p className="text-sm text-zinc-400">Cargando…</p>
        ) : users.length === 0 ? (
          <p className="text-sm text-zinc-400">Todavía no entró nadie.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500">
                <tr>
                  <th className="pb-2 pr-3 font-medium">Usuario</th>
                  <th className="pb-2 pr-3 font-medium">Estado</th>
                  <th className="pb-2 pr-3 font-medium">Rol</th>
                  <th className="pb-2 pr-3 font-medium">Jugado</th>
                  <th className="pb-2 font-medium">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-zinc-800">
                    <td className="py-2 pr-3">
                      <p className="text-zinc-100">{u.name}</p>
                      <p className="text-xs text-zinc-500">{u.email}</p>
                    </td>
                    <td className={`py-2 pr-3 ${STATUS_COLOR[u.status]}`}>{STATUS_LABEL[u.status]}</td>
                    <td className="py-2 pr-3 text-zinc-300">{u.role === 'admin' ? 'Admin' : 'Jugador'}</td>
                    <td className="py-2 pr-3 text-zinc-400">{formatPlayed(u.played_ms)}</td>
                    <td className="py-2">
                      {u.id === myId ? (
                        <span className="text-xs text-zinc-500">(tú)</span>
                      ) : (
                      <div className="flex flex-wrap gap-1">
                        {u.status !== 'approved' && (
                          <Button variant="primary" onClick={() => change(u.id, { status: 'approved' })}>
                            Aprobar
                          </Button>
                        )}
                        {u.status !== 'blocked' && (
                          <Button variant="danger" onClick={() => change(u.id, { status: 'blocked' })}>
                            Bloquear
                          </Button>
                        )}
                        {u.status === 'approved' && (
                          <Button onClick={() => change(u.id, { role: u.role === 'admin' ? 'player' : 'admin' })}>
                            {u.role === 'admin' ? 'Quitar admin' : 'Hacer admin'}
                          </Button>
                        )}
                      </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
