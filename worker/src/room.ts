// Durable Object "Room": una instancia por consola. Guarda la cola y el turno, avisa a todos los
// navegadores por WebSocket y hace de puente de señalización WebRTC entre el navegador del jugador
// y el agente de la casa (que se conecta hacia afuera, así el CGNAT no molesta).
//
// Mensajes navegador -> sala:
//   {type:"join"} {type:"leave"} {type:"accept"} {type:"signal", data}
//   {type:"admin", action:"skip"|"take"|"release"|"pause"|"resume"|"turnMinutes"|"youtube", value?}
// Sala -> navegador:
//   {type:"hello", me:{userId,name,isAdmin}}   al conectar
//   {type:"state", state:PublicState}          en cada cambio
//   {type:"signal", data}                      solo al jugador actual (viene del agente)
//   {type:"error", message}
// Agente -> sala:   {type:"signal", data}  {type:"status", ps4:boolean}
// Sala -> agente:   {type:"player", player:{userId,name,isAdmin}|null}  {type:"youtube", on}  {type:"signal", data}

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import * as logic from './room-logic'
import type { Result, RoomState } from './room-logic'

const MAX_MESSAGE_BYTES = 64 * 1024 // una SDP ocupa unos pocos KB

type Attachment =
  | { kind: 'browser'; userId: string; name: string; isAdmin: boolean }
  | { kind: 'agent' }

type Extras = {
  youtube: boolean // ¿el admin pidió transmitir a YouTube?
  ps4Connected: boolean // lo informa el agente
}

export type PublicState = RoomState & Extras & { agentOnline: boolean; now: number }

export class Room extends DurableObject<Env> {
  private state: RoomState = logic.initialState()
  private extras: Extras = { youtube: false, ps4Connected: false }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Los navegadores pueden mandar "ping" sin despertar al objeto (ahorra solicitudes).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    // Al despertar (después de hibernar) recuperamos el estado guardado.
    ctx.blockConcurrencyWhile(async () => {
      this.state = (await ctx.storage.get<RoomState>('state')) ?? logic.initialState()
      this.extras = (await ctx.storage.get<Extras>('extras')) ?? this.extras
    })
  }

  // El Worker ya verificó quién es y nos pasa los datos en cabeceras internas.
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 })
    const role = request.headers.get('X-Room-Role')
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    if (role === 'agent') {
      // Un solo agente por sala: si había otro conectado, lo cerramos.
      for (const old of this.ctx.getWebSockets('agent')) old.close(4000, 'Reemplazado por otro agente')
      this.ctx.acceptWebSocket(server, ['agent'])
      server.serializeAttachment({ kind: 'agent' } satisfies Attachment)
      this.send(server, { type: 'player', player: this.playerForAgent() })
      this.send(server, { type: 'youtube', on: this.extras.youtube })
      this.broadcastState()
    } else {
      const userId = request.headers.get('X-User-Id') ?? ''
      const attachment: Attachment = {
        kind: 'browser',
        userId,
        name: decodeURIComponent(request.headers.get('X-User-Name') ?? 'Jugador'),
        isAdmin: request.headers.get('X-User-Admin') === '1',
      }
      this.ctx.acceptWebSocket(server, ['browser', `user:${userId}`])
      server.serializeAttachment(attachment)
      this.send(server, { type: 'hello', me: { userId, name: attachment.name, isAdmin: attachment.isAdmin } })
      this.send(server, { type: 'state', state: this.publicState() })
    }
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return
    let msg: { type?: string; action?: string; value?: unknown; data?: unknown; ps4?: unknown }
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    const who = ws.deserializeAttachment() as Attachment | null
    if (!who) return
    if (who.kind === 'agent') return this.onAgentMessage(msg)

    const now = Date.now()
    const member = { userId: who.userId, name: who.name }
    switch (msg.type) {
      case 'join':
        return this.apply(logic.join(this.state, member, now))
      case 'leave':
        return this.apply(logic.leave(this.state, who.userId, now))
      case 'accept':
        return this.apply(logic.accept(this.state, who.userId, who.isAdmin, now))
      case 'signal':
        // Solo el jugador actual negocia WebRTC con el agente.
        if (this.state.current?.userId === who.userId) this.sendToAgent({ type: 'signal', data: msg.data })
        return
      case 'admin':
        if (!who.isAdmin) return this.send(ws, { type: 'error', message: 'Solo el admin puede hacer eso' })
        return this.onAdminAction(member, msg.action, msg.value)
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment | null
    // Si se va el agente, todos ven "consola desconectada". Los navegadores que se van conservan su
    // lugar (pueden recargar la página); si no vuelven, la oferta vence sola.
    if (who?.kind === 'agent') {
      this.extras.ps4Connected = false
      await this.ctx.storage.put('extras', this.extras)
      this.broadcastState()
    }
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  // Vence una oferta o un turno.
  override async alarm(): Promise<void> {
    await this.apply(logic.tick(this.state, Date.now()))
  }

  // --- internos ---

  private async onAdminAction(admin: { userId: string; name: string }, action?: string, value?: unknown) {
    const now = Date.now()
    switch (action) {
      case 'skip':
        return this.apply(logic.skip(this.state, now))
      case 'take':
        return this.apply(logic.takeControl(this.state, admin, now))
      case 'release':
        return this.apply(logic.leave(this.state, admin.userId, now))
      case 'pause':
        return this.apply(logic.setPaused(this.state, true, now))
      case 'resume':
        return this.apply(logic.setPaused(this.state, false, now))
      case 'turnMinutes':
        return this.apply(logic.setTurnMinutes(this.state, Number(value)))
      case 'youtube':
        this.extras.youtube = value === true
        await this.ctx.storage.put('extras', this.extras)
        this.sendToAgent({ type: 'youtube', on: this.extras.youtube })
        return this.broadcastState()
    }
  }

  private async onAgentMessage(msg: { type?: string; data?: unknown; ps4?: unknown }) {
    if (msg.type === 'signal') {
      const current = this.state.current
      if (!current) return
      for (const ws of this.ctx.getWebSockets(`user:${current.userId}`)) this.send(ws, { type: 'signal', data: msg.data })
    } else if (msg.type === 'status') {
      this.extras.ps4Connected = msg.ps4 === true
      await this.ctx.storage.put('extras', this.extras)
      this.broadcastState()
    }
  }

  // Guarda el nuevo estado, registra turnos terminados, reprograma la alarma y avisa a todos.
  private async apply(result: Result) {
    const before = this.state.current?.userId ?? null
    this.state = result.state
    await this.ctx.storage.put('state', this.state)

    if (result.ended.length) {
      await this.env.DB.batch(
        result.ended.map((e) =>
          this.env.DB.prepare('INSERT INTO turns (user_id, started_at, ended_at, reason) VALUES (?, ?, ?, ?)').bind(
            e.turn.userId,
            e.turn.startedAt,
            e.endedAt,
            e.reason,
          ),
        ),
      )
    }

    const deadline = logic.nextDeadline(this.state)
    if (deadline === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(deadline)

    if ((this.state.current?.userId ?? null) !== before) this.sendToAgent({ type: 'player', player: this.playerForAgent() })
    this.broadcastState()
  }

  private playerForAgent() {
    const c = this.state.current
    return c ? { userId: c.userId, name: c.name, isAdmin: c.isAdmin } : null
  }

  private publicState(): PublicState {
    return {
      ...this.state,
      ...this.extras,
      agentOnline: this.ctx.getWebSockets('agent').length > 0,
      now: Date.now(), // para que el navegador corrija la diferencia de reloj en la cuenta regresiva
    }
  }

  private broadcastState() {
    const message = { type: 'state', state: this.publicState() }
    for (const ws of this.ctx.getWebSockets('browser')) this.send(ws, message)
  }

  private sendToAgent(message: unknown) {
    for (const ws of this.ctx.getWebSockets('agent')) this.send(ws, message)
  }

  private send(ws: WebSocket, message: unknown) {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // socket cerrándose: lo ignora, se limpia solo
    }
  }
}
