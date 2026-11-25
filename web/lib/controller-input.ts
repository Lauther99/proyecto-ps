// Lee el mando (Gamepad API) y el teclado, y manda el estado al agente por el canal "input".
// Formato (lo entiende serve.cpp):
//   {"s":seq,"b":botones,"l2":0-255,"r2":0-255,"lx":..,"ly":..,"rx":..,"ry":..}
// Palancas de -32767 a 32767 (Y positiva = hacia abajo, igual que en la PS4).

// Bits de botón del protocolo (iguales a ChiakiControllerButton en chiaki).
const BTN = {
  cross: 1 << 0,
  circle: 1 << 1,
  square: 1 << 2,
  triangle: 1 << 3,
  left: 1 << 4,
  right: 1 << 5,
  up: 1 << 6,
  down: 1 << 7,
  l1: 1 << 8,
  r1: 1 << 9,
  l3: 1 << 10,
  r3: 1 << 11,
  options: 1 << 12,
  share: 1 << 13,
  touchpad: 1 << 14,
  ps: 1 << 15, // el agente lo descarta igual, pero lo mandamos tal cual
} as const

// Mando con distribución "standard" (DualShock 4, Xbox, etc. en Chrome/Edge/Brave).
// Índice del botón en la Gamepad API -> bit. Los gatillos (6 y 7) van aparte porque son analógicos.
const GAMEPAD_BUTTONS: Record<number, number> = {
  0: BTN.cross,
  1: BTN.circle,
  2: BTN.square,
  3: BTN.triangle,
  4: BTN.l1,
  5: BTN.r1,
  8: BTN.share,
  9: BTN.options,
  10: BTN.l3,
  11: BTN.r3,
  12: BTN.up,
  13: BTN.down,
  14: BTN.left,
  15: BTN.right,
  16: BTN.ps,
  17: BTN.touchpad,
}

// Teclado de respaldo (KeyboardEvent.code, así funciona igual con teclado en español o inglés).
const KEY_BUTTONS: Record<string, number> = {
  KeyJ: BTN.cross,
  KeyK: BTN.circle,
  KeyL: BTN.square,
  KeyI: BTN.triangle,
  KeyQ: BTN.l1,
  KeyE: BTN.r1,
  KeyX: BTN.l3,
  KeyV: BTN.r3,
  KeyT: BTN.up,
  KeyF: BTN.left,
  KeyG: BTN.down,
  KeyH: BTN.right,
  Enter: BTN.options,
  Backspace: BTN.share,
  Tab: BTN.touchpad,
}
const KEY_TRIGGERS = { KeyZ: 'l2', KeyC: 'r2' } as const
const KEY_STICKS: Record<string, [stick: 'l' | 'r', axis: 'x' | 'y', dir: 1 | -1]> = {
  KeyW: ['l', 'y', -1],
  KeyS: ['l', 'y', 1],
  KeyA: ['l', 'x', -1],
  KeyD: ['l', 'x', 1],
  ArrowUp: ['r', 'y', -1],
  ArrowDown: ['r', 'y', 1],
  ArrowLeft: ['r', 'x', -1],
  ArrowRight: ['r', 'x', 1],
}

const AXIS_MAX = 32767
const DEADZONE = 0.12 // ignora el pequeño desvío de palancas gastadas
const READ_EVERY_MS = 8 // lectura del mando (125 Hz), independiente de los fotogramas de la pantalla
const SEND_EVERY_MS = 33 // ~30 veces por segundo, aunque no cambie nada (el agente suelta todo si dejamos de mandar)

type PadState = { b: number; l2: number; r2: number; lx: number; ly: number; rx: number; ry: number }

export type InputSource = 'ninguno' | 'teclado' | string // string = nombre del mando

function axisValue(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0
  return Math.round(Math.max(-1, Math.min(1, v)) * AXIS_MAX)
}

function readGamepad(): { state: PadState; name: string } | null {
  const pads = navigator.getGamepads?.() ?? []
  const pad = pads.find((p) => p && p.connected)
  if (!pad) return null
  let b = 0
  for (const [index, bit] of Object.entries(GAMEPAD_BUTTONS)) {
    if (pad.buttons[Number(index)]?.pressed) b |= bit
  }
  return {
    name: pad.id,
    state: {
      b,
      l2: Math.round((pad.buttons[6]?.value ?? 0) * 255),
      r2: Math.round((pad.buttons[7]?.value ?? 0) * 255),
      lx: axisValue(pad.axes[0] ?? 0),
      ly: axisValue(pad.axes[1] ?? 0),
      rx: axisValue(pad.axes[2] ?? 0),
      ry: axisValue(pad.axes[3] ?? 0),
    },
  }
}

function readKeyboard(keys: Set<string>): PadState {
  const s: PadState = { b: 0, l2: 0, r2: 0, lx: 0, ly: 0, rx: 0, ry: 0 }
  for (const code of keys) {
    if (code in KEY_BUTTONS) s.b |= KEY_BUTTONS[code]
    if (code in KEY_TRIGGERS) s[KEY_TRIGGERS[code as keyof typeof KEY_TRIGGERS]] = 255
    const stick = KEY_STICKS[code]
    if (stick) {
      const [side, axis, dir] = stick
      const key = `${side}${axis}` as 'lx' | 'ly' | 'rx' | 'ry'
      s[key] += dir * AXIS_MAX
    }
  }
  return s
}

// Une mando y teclado: botones sumados, gatillos al máximo, palanca del teclado si se usa.
function merge(pad: PadState | null, kb: PadState): PadState {
  if (!pad) return kb
  return {
    b: pad.b | kb.b,
    l2: Math.max(pad.l2, kb.l2),
    r2: Math.max(pad.r2, kb.r2),
    lx: kb.lx || pad.lx,
    ly: kb.ly || pad.ly,
    rx: kb.rx || pad.rx,
    ry: kb.ry || pad.ry,
  }
}

// Empieza a mandar controles por 'channel'. Devuelve la función para detenerlo.
export function startControllerInput(
  channel: RTCDataChannel,
  onSourceChange: (source: InputSource) => void,
): () => void {
  const keys = new Set<string>()
  let seq = 0
  let lastSent = ''
  let lastSentAt = 0
  let lastSource: InputSource = ''

  // Con un cuadro de diálogo abierto, el teclado es de la página y no del juego.
  const isTyping = (target: EventTarget | null) =>
    (target instanceof HTMLInputElement && target.type !== 'range') ||
    target instanceof HTMLTextAreaElement ||
    document.querySelector('dialog[open]') !== null

  const isMapped = (code: string) => code in KEY_BUTTONS || code in KEY_TRIGGERS || code in KEY_STICKS

  const onKeyDown = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return keys.clear()
    if (!isMapped(e.code)) return
    e.preventDefault() // que las flechas, Tab o Backspace no muevan la página
    keys.add(e.code)
    tick() // sin esperar a la próxima lectura
  }
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code)
    tick()
  }
  const onBlur = () => keys.clear() // al cambiar de ventana, nada queda presionado

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', onBlur)

  const tick = () => {
    // Con la pestaña oculta el mando no se actualiza: no repetimos un estado viejo (el agente suelta todo).
    if (channel.readyState !== 'open' || document.hidden) return

    const pad = readGamepad()
    const state = merge(pad?.state ?? null, readKeyboard(keys))

    const source: InputSource = pad ? pad.name : keys.size > 0 ? 'teclado' : lastSource || 'ninguno'
    if (source !== lastSource) {
      lastSource = source
      onSourceChange(source)
    }

    // Mandamos al cambiar algo, y además cada 33 ms como "sigo aquí".
    const body = JSON.stringify(state)
    const now = performance.now()
    if (body === lastSent && now - lastSentAt < SEND_EVERY_MS) return
    lastSent = body
    lastSentAt = now
    seq += 1
    channel.send(JSON.stringify({ s: seq, ...state }))
  }
  const timer = window.setInterval(tick, READ_EVERY_MS)

  return () => {
    window.clearInterval(timer)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  }
}
