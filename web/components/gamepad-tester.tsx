'use client'

// Panel de diagnóstico del mando: muestra qué ve el navegador, sin pasar por el agente ni la PS4.
// Si un botón se ilumina tarde aquí, el retraso es de Windows/navegador/Steam, no de nuestro sistema.
//   - "Edad del dato": cuánto hace que el navegador recibió el último dato del mando.
//   - "Actualizaciones": cuántos datos nuevos por segundo entrega el mando (mueve una palanca para medir).

import { useEffect, useState } from 'react'

const BUTTON_LABELS = [
  'X', 'O', '□', '△', 'L1', 'R1', 'L2', 'R2', 'Share', 'Options', 'L3', 'R3',
  '↑', '↓', '←', '→', 'PS', 'Panel',
]

// Teclas del respaldo que equivalen a cada botón (mismo índice), para comparar teclado vs mando.
const KEY_FOR_BUTTON: Record<string, number> = {
  KeyJ: 0, KeyK: 1, KeyL: 2, KeyI: 3, KeyQ: 4, KeyE: 5, KeyZ: 6, KeyC: 7,
  Backspace: 8, Enter: 9, KeyX: 10, KeyV: 11, KeyT: 12, KeyG: 13, KeyF: 14, KeyH: 15, Tab: 17,
}

type Snapshot = {
  name: string
  mapping: string
  pressed: boolean[]
  keys: boolean[]
  axes: number[]
  ageMs: number
  updatesPerSecond: number
}

const EMPTY: Snapshot = {
  name: '',
  mapping: '',
  pressed: [],
  keys: [],
  axes: [],
  ageMs: 0,
  updatesPerSecond: 0,
}

export default function GamepadTester() {
  const [snap, setSnap] = useState<Snapshot>(EMPTY)

  useEffect(() => {
    const keys = new Set<string>()
    const onDown = (e: KeyboardEvent) => keys.add(e.code)
    const onUp = (e: KeyboardEvent) => keys.delete(e.code)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)

    let frame = 0
    let lastTimestamp = 0
    let updates = 0
    let windowStart = performance.now()
    let rate = 0
    let ageAvg = 0

    const tick = () => {
      frame = requestAnimationFrame(tick)
      const now = performance.now()
      const pad = (navigator.getGamepads?.() ?? []).find((p) => p && p.connected) ?? null

      if (pad && pad.timestamp !== lastTimestamp) {
        updates += 1
        lastTimestamp = pad.timestamp
      }
      if (now - windowStart >= 1000) {
        rate = Math.round((updates * 1000) / (now - windowStart))
        updates = 0
        windowStart = now
      }
      if (pad) ageAvg = ageAvg * 0.9 + (now - pad.timestamp) * 0.1

      const keyPressed = BUTTON_LABELS.map(() => false)
      for (const code of keys) {
        const index = KEY_FOR_BUTTON[code]
        if (index !== undefined) keyPressed[index] = true
      }

      setSnap({
        name: pad?.id ?? '',
        mapping: pad?.mapping ?? '',
        pressed: BUTTON_LABELS.map((_, i) => Boolean(pad?.buttons[i]?.pressed)),
        keys: keyPressed,
        axes: pad ? Array.from(pad.axes.slice(0, 4)) : [],
        ageMs: pad ? Math.round(ageAvg) : 0,
        updatesPerSecond: rate,
      })
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
    }
  }, [])

  return (
    <section className="w-full max-w-5xl rounded-lg border border-zinc-800 p-4">
      <h2 className="mb-2 text-sm font-semibold text-zinc-300">Prueba del mando (solo en este navegador, sin PS4)</h2>
      {snap.name ? (
        <p className="mb-3 text-xs text-zinc-500">
          {snap.name} · distribución: {snap.mapping || 'no estándar'} · edad del dato:{' '}
          <span className="font-medium text-zinc-200">{snap.ageMs} ms</span> · actualizaciones:{' '}
          <span className="font-medium text-zinc-200">{snap.updatesPerSecond}/s</span> (mueve una palanca para medir)
        </p>
      ) : (
        <p className="mb-3 text-xs text-zinc-500">Ningún mando detectado. Conéctalo y presiona cualquier botón.</p>
      )}
      <div className="flex flex-wrap gap-2">
        {BUTTON_LABELS.map((label, i) => {
          const pad = snap.pressed[i]
          const key = snap.keys[i]
          const color = pad && key ? 'bg-purple-500' : pad ? 'bg-emerald-500' : key ? 'bg-sky-500' : 'bg-zinc-800'
          return (
            <span key={label} className={`min-w-12 rounded px-2 py-1 text-center text-xs font-medium ${color}`}>
              {label}
            </span>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        Verde = mando, azul = teclado. Palancas: {snap.axes.map((a) => a.toFixed(2)).join('  ') || '-'}
      </p>
    </section>
  )
}
