'use client'

// Sala: el jugador ve el reproductor con controles; los demás ven el directo de YouTube y la cola.

import type { User } from '@/lib/api'
import { useRoom } from '@/lib/use-room'
import AdminControls from './admin-controls'
import OfferBanner from './offer-banner'
import QueuePanel from './queue-panel'
import TurnPlayer from './turn-player'
import { Button, StatusDot } from './ui'
import YoutubeEmbed from './youtube-embed'

export default function RoomView({ user, onLogout }: { user: User; onLogout: () => void }) {
  const { client, state, me, connected, error, clearError, clockOffset } = useRoom()

  const isPlaying = Boolean(state && me && state.current?.userId === me.userId)
  const hasOffer = Boolean(state && me && state.offer?.userId === me.userId)

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-zinc-100">Sala PS4</h1>
          <div className="mt-1 flex flex-wrap gap-3">
            <StatusDot ok={connected} label={connected ? 'Sala conectada' : 'Reconectando…'} />
            <StatusDot ok={Boolean(state?.agentOnline)} label="Agente" />
            <StatusDot ok={Boolean(state?.ps4Connected)} label="Consola" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-zinc-400">
            {user.name}
            {user.role === 'admin' && <span className="ml-1 text-xs text-sky-400">(admin)</span>}
          </span>
          <Button onClick={onLogout}>Salir</Button>
        </div>
      </header>

      {error && (
        <p className="flex items-center justify-between rounded-md bg-red-950/60 px-3 py-2 text-sm text-red-300">
          {error}
          <button type="button" className="text-xs underline" onClick={clearError}>
            cerrar
          </button>
        </p>
      )}

      {!state || !me ? (
        <p className="text-sm text-zinc-400">Conectando con la sala…</p>
      ) : (
        <>
          {hasOffer && <OfferBanner client={client} state={state} clockOffset={clockOffset} />}
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="min-w-0">
              {isPlaying ? (
                <TurnPlayer client={client} state={state} clockOffset={clockOffset} isAdmin={me.isAdmin} />
              ) : (
                <YoutubeEmbed live={state.youtube} />
              )}
            </div>
            <aside className="flex flex-col gap-4">
              <QueuePanel client={client} state={state} me={me} clockOffset={clockOffset} />
              {me.isAdmin && <AdminControls client={client} state={state} me={me} />}
            </aside>
          </div>
        </>
      )}
    </div>
  )
}
