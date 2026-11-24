// Cuánto video guarda el navegador antes de mostrarlo (jitter buffer).
//   - estable: lo decide el navegador.
//   - baja:    pedimos el mínimo. Es un pedido: si la red varía, el navegador puede guardar más.

export type LatencyMode = 'estable' | 'baja'

const STORAGE_KEY = 'ps4-latency-mode'

export function loadLatencyMode(): LatencyMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'baja' ? 'baja' : 'estable'
  } catch {
    return 'estable' // navegación privada o almacenamiento bloqueado
  }
}

export function saveLatencyMode(mode: LatencyMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // sin almacenamiento, vale solo para esta visita
  }
}

// Se puede llamar en plena partida: no hace falta reconectar.
export function applyLatencyMode(pc: RTCPeerConnection, mode: LatencyMode): void {
  const target = mode === 'baja' ? 0 : null
  for (const receiver of pc.getReceivers()) {
    const r = receiver as unknown as { jitterBufferTarget?: number | null; playoutDelayHint?: number | null }
    // playoutDelayHint es el nombre antiguo (Chrome viejo); en ambos, null vuelve a lo automático.
    if ('jitterBufferTarget' in r) r.jitterBufferTarget = target
    else if ('playoutDelayHint' in r) r.playoutDelayHint = target
  }
}
