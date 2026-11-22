import type { Metadata } from 'next'
import LocalPlayer from './local-player'
import GamepadTester from '@/components/gamepad-tester'

export const metadata: Metadata = {
  title: 'PS4 local',
}

// Página de prueba en la red local: video de la PS4 directo desde "ps4-agent serve", sin Cloudflare.
export default function LocalPlayerPage() {
  return (
    <main className="flex min-h-screen flex-col items-center gap-4 bg-zinc-950 p-6 text-zinc-100">
      <h1 className="text-xl font-semibold">PS4: prueba local</h1>
      <div className="w-full max-w-5xl">
        <LocalPlayer />
      </div>
      <GamepadTester />
    </main>
  )
}
