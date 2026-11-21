import type { Metadata } from 'next'
import Ps4Player from '@/components/ps4-player'

export const metadata: Metadata = {
  title: 'PS4 local',
}

// Página de prueba de la fase 2A: video de la PS4 por WebRTC en la red local.
export default function LocalPlayerPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-zinc-950 p-6 text-zinc-100">
      <h1 className="text-xl font-semibold">PS4: prueba local</h1>
      <Ps4Player signalingUrl="ws://localhost:8000" />
    </main>
  )
}
