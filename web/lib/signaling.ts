// Cómo se intercambian oferta y respuesta WebRTC con el agente. Dos variantes:
//   - local: WebSocket directo a "ps4-agent serve" en la misma laptop (página /local-player)
//   - sala:  a través del Durable Object de Cloudflare (el agente está detrás del CGNAT)
// Mensajes: agente -> navegador {type:"offer", sdp}; navegador -> agente {type:"answer", sdp}
// y {type:"ready"} para pedir una oferta nueva (al entrar o al recargar la página).

import type { RoomClient } from './room-client'

export type SignalMessage = { type: 'offer' | 'answer' | 'ready'; sdp?: string }

export type SignalingSession = {
  send(message: SignalMessage): void
  stop(): void
}

export type Signaling = (handlers: {
  onSignal: (message: SignalMessage) => void
  onError: (text: string) => void
}) => SignalingSession

export function localSignaling(url: string): Signaling {
  return ({ onSignal, onError }) => {
    const ws = new WebSocket(url)
    ws.onmessage = (event) => {
      try {
        onSignal(JSON.parse(event.data as string) as SignalMessage)
      } catch {
        // ignorar
      }
    }
    ws.onerror = () => onError(`No se pudo conectar a ${url}. ¿Está corriendo "ps4-agent serve"?`)
    return {
      send: (message) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(message)),
      stop: () => ws.close(),
    }
  }
}

export function roomSignaling(client: RoomClient): Signaling {
  return ({ onSignal }) => {
    const off = client.onMessage((message) => {
      if (message.type === 'signal') onSignal(message.data as SignalMessage)
    })
    return {
      send: (message) => client.send({ type: 'signal', data: message }),
      stop: off,
    }
  }
}
