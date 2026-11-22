'use client'

import { useState } from 'react'
import Ps4Player from '@/components/ps4-player'
import { localSignaling } from '@/lib/signaling'

export default function LocalPlayer() {
  // Se crea una sola vez: si cambiara en cada render, el reproductor se reconectaría.
  const [signaling] = useState(() => localSignaling('ws://localhost:8000'))
  return <Ps4Player signaling={signaling} />
}
