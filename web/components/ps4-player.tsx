'use client'

// Reproductor sencillo para la página de desarrollo /local-player. La pantalla del jugador es
// components/pantallas/jugar.tsx; ambas usan la misma conexión (lib/use-player.ts).

import { useState } from 'react'
import type { Signaling } from '@/lib/signaling'
import { usePlayer } from '@/lib/use-player'

const buttonClass = 'rounded-md bg-raised px-3 py-1.5 text-sm font-medium'

export default function Ps4Player({ signaling }: { signaling: Signaling }) {
  const { videoRef, status, detail, inputSource, stats, diagnostics, muted, setVolume, latencyMode, changeLatencyMode, onPlaying } =
    usePlayer(signaling)
  const [showStats, setShowStats] = useState(true)
  const lines =
    status !== 'reproduciendo'
      ? diagnostics
      : stats
        ? [
            `${stats.width}×${stats.height} · ${stats.mbps} Mbps · red ${stats.rttMs ?? '?'} ms`,
            `fps: llegan ${stats.fpsReceived} · decodif. ${stats.fpsDecoded} · mostrados ${stats.fpsShown}`,
            `descartados ${stats.droppedPerSecond}/s · perdidos ${stats.packetsLostPerSecond}/s (${stats.lossPercent} %) · congelados ${stats.freezes}`,
            `búfer ${stats.bufferMs} ms · jitter ${stats.jitterMs} ms${stats.route ? ` · ruta ${stats.route}` : ''}${stats.network ? ` · ${stats.network}` : ''}`,
          ]
        : []

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="relative bg-black">
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onPlaying={onPlaying}
          onDoubleClick={(e) => void e.currentTarget.requestFullscreen()}
          className="aspect-video w-full bg-black"
        />
        {showStats && lines.length > 0 && (
          <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 font-mono text-xs leading-5">
            {lines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <p>
          Estado: {status} {detail && `(${detail})`} · Control: {inputSource}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonClass} onClick={() => setShowStats((v) => !v)}>
            Estadísticas
          </button>
          <button
            type="button"
            className={buttonClass}
            onClick={() => changeLatencyMode(latencyMode === 'baja' ? 'estable' : 'baja')}
            suppressHydrationWarning
          >
            {latencyMode === 'baja' ? 'Modo: Baja latencia' : 'Modo: Estable'}
          </button>
          <button type="button" className={buttonClass} onClick={() => setVolume(muted ? 1 : 0)}>
            {muted ? 'Activar sonido' : 'Silenciar'}
          </button>
        </div>
      </div>
    </div>
  )
}
