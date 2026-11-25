// Durable Object "Room": una instancia por consola. Ordena las operaciones de la cola y los turnos, lleva
// el reloj, avisa a los navegadores por WebSocket y hace de puente WebRTC entre el jugador y el agente de
// la casa (que se conecta hacia afuera, así el CGNAT no molesta). La verdad está en D1: aquí solo hay una
// copia, y es el único que cambia 'bookings' y 'rooms'.
//
// Sala -> navegador:  {type:"state", state}  {type:"me"}  {type:"signal", data}
// Navegador -> sala:  {type:"signal", data}  (solo quien juega)
// Agente -> sala:     {type:"signal", data}  {type:"status", ps4, fault?}
//    fault: la sesión con la consola falló mientras alguien la necesitaba. ps4:false solo no es falla: el
//    agente también lo manda cuando el jugador cierra su pestaña.
// Sala -> agente:     {type:"player", player, iceServers}  {type:"youtube", on}  {type:"signal", data}
// Señales (data): navegador {type:"ready"} o {type:"answer", sdp}; agente {type:"offer", sdp}.

import { DurableObject } from 'cloudflare:workers'
import type { Env } from './env'
import * as logic from './room-logic'
import type { Change, State } from './room-logic'
import { ACTIVE_BOOKINGS, finalStatus, joinQueries, toQueries, type Query } from './store'
import { getIceServers } from './turn'

const MAX_MESSAGE_BYTES = 64 * 1024 // una SDP ocupa unos pocos KB
const MAX_BROWSERS = 500
const CONTROL_TTL_S = 4 * 60 * 60
const TTL_MARGIN_S = 15 * 60

type Attachment =
  | { kind: 'browser'; userId: string; sid: string } // userId vacío = visitante; sid: id de esta pestaña
  | { kind: 'agent' }

export type OpResult = { ok: true } | { ok: false; status: number; error: string }

export class Room extends DurableObject<Env> {
  private readonly roomId = 'main'
  private state: State | null = null // null = hay que leerlo de D1
  private ps4Connected = false
  private playerSid: string | null = null // pestaña del jugador que negocia con el agente
  private agentPlayer: string | null = null // último jugador avisado al agente
  private tail: Promise<unknown> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    // Los navegadores pueden mandar "ping" sin despertar al objeto (ahorra solicitudes).
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
    ctx.blockConcurrencyWhile(async () => {
      this.ps4Connected = (await ctx.storage.get<boolean>('ps4Connected')) ?? false
      this.playerSid = (await ctx.storage.get<string>('playerSid')) ?? null
      this.agentPlayer = (await ctx.storage.get<string>('agentPlayer')) ?? null
    })
  }

  // --- Fila de operaciones: esperar a D1 deja entrar otros mensajes, así que van de una en una ---

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.tail.then(job, job)
    this.tail = run.catch(() => undefined)
    return run
  }

  private agentOnline = () => this.ctx.getWebSockets('agent').some((ws) => ws.readyState === 1)

  private async load(): Promise<State> {
    if (this.state) {
      this.state.agentOnline = this.agentOnline()
      return this.state
    }
    const [room, bookings, settings] = await Promise.all([
      this.env.DB.prepare(
        'SELECT r.paused, r.youtube, r.control_user, r.control_since, u.nickname FROM rooms r LEFT JOIN users u ON u.id = r.control_user WHERE r.id = ?',
      )
        .bind(this.roomId)
        .first<{ paused: number; youtube: number; control_user: string | null; control_since: number | null; nickname: string | null }>(),
      this.env.DB.prepare(ACTIVE_BOOKINGS).bind(this.roomId).all<logic.Booking & { charged: number | boolean }>(),
      this.env.DB.prepare('SELECT accept_seconds FROM settings WHERE id = 1').first<{ accept_seconds: number }>(),
    ])
    if (!room || !settings) throw new Error('Falta la sala o la configuración en D1')
    this.state = {
      bookings: bookings.results.map((b) => ({ ...b, charged: Boolean(b.charged) })),
      paused: room.paused === 1,
      youtube: room.youtube === 1,
      control: room.control_user ? { userId: room.control_user, name: room.nickname ?? 'Admin', since: room.control_since ?? 0 } : null,
      agentOnline: this.agentOnline(),
      acceptSeconds: settings.accept_seconds,
    }
    return this.state
  }

  private async batch(queries: Query[]) {
    return this.env.DB.batch(queries.map((q) => this.env.DB.prepare(q.sql).bind(...q.params)))
  }

  // Guarda los cambios de una vez, reprograma la alarma y avisa a todos. 'extra' va en el mismo batch.
  private async commit(changes: Change[], extra: Query[] = []) {
    const before = await this.load()
    if (changes.length || extra.length) {
      const { queries, checks } = toQueries(changes, this.roomId, finalStatus(before.bookings, changes), Date.now())
      try {
        const results = await this.batch([...queries, ...extra])
        const bad = checks.filter((i) => results[i]?.meta.changes !== 1)
        // No debería pasar (somos los únicos que escriben). El trigger suma cambios: solo importa el cero.
        if (bad.some((i) => results[i]?.meta.changes === 0)) {
          console.error('Room: la base no coincidía con la memoria', JSON.stringify(changes))
          this.state = null
          throw new Error('estado desactualizado')
        } else this.state = logic.applyChanges(before, changes)
      } catch (e) {
        this.state = null // resultado desconocido: la próxima lectura viene de D1
        throw e
      }
    }
    await this.after(new Set(changes.flatMap((c) => (c.type === 'ledger' ? [c.entry.userId] : c.type === 'notice' ? [c.userId] : []))))
  }

  private async after(touched: Set<string> = new Set()) {
    const state = await this.load()
    const deadline = logic.nextDeadline(state)
    if (deadline === null) await this.ctx.storage.deleteAlarm()
    else await this.ctx.storage.setAlarm(deadline)

    const player = this.player(state)
    const key = player ? `${player.userId}:${player.isAdmin}` : ''
    if (key !== this.agentPlayer) {
      this.agentPlayer = key
      await this.ctx.storage.put('agentPlayer', key)
      this.sendToAgent(await this.playerMessage(state))
    }
    this.broadcast(state)
    for (const id of touched) this.notifyNow(id)
  }

  // Una operación con reglas: la lista de cambios sale del estado actual ya puesto al día.
  private op(make: (s: State, now: number) => Change[], extra: Query[] = []): Promise<OpResult> {
    return this.enqueue(async () => {
      try {
        const now = Date.now()
        const due = logic.tick(await this.load(), now)
        if (due.length) await this.commit(due)
        await this.commit(make(await this.load(), now), extra)
        return { ok: true as const }
      } catch (e) {
        return failure(e)
      }
    })
  }

  // --- RPC que usa el Worker (ya validó sesión, rol y Origin) ---

  join(userId: string, minutes: number, credits: number): Promise<OpResult> {
    return this.enqueue(async () => {
      try {
        const now = Date.now()
        const due = logic.tick(await this.load(), now)
        if (due.length) await this.commit(due)
        const state = await this.load()
        logic.checkJoin(state, userId)
        try {
          const results = await this.batch(
            joinQueries({ id: crypto.randomUUID(), roomId: this.roomId, userId, position: logic.nextPosition(state), minutes, credits, now }),
          )
          if (results[0]?.meta.changes === 0) throw new logic.RuleError('Tu cuenta está bloqueada.', 403)
        } finally {
          this.state = null
        }
        await this.commit(logic.next(await this.load(), now))
        this.notifyNow(userId)
        return { ok: true as const }
      } catch (e) {
        return failure(e)
      }
    })
  }

  leave(userId: string) {
    return this.op((s, now) => logic.leave(s, userId, now))
  }

  accept(userId: string) {
    return this.op((s, now) => logic.accept(s, userId, now))
  }

  decline(userId: string) {
    return this.op((s, now) => logic.decline(s, userId, now))
  }

  end(userId: string) {
    return this.op((s, now) => logic.end(s, userId, now))
  }

  async admin(admin: { userId: string; name: string }, a: AdminAction): Promise<OpResult> {
    const reason = 'reason' in a ? a.reason : null
    const audit: Query = {
      sql: 'INSERT INTO audit (admin_id, action, target, reason, created_at) VALUES (?, ?, ?, ?, ?)',
      params: [admin.userId, `room.${a.action}`, this.roomId, reason, Date.now()],
    }
    const result = await this.op((s, now) => {
      switch (a.action) {
        case 'take':
          return logic.take(s, admin, now)
        case 'release':
          return logic.release(s, admin.userId, now)
        case 'skip':
          return logic.skip(s, now)
        case 'pause':
          return logic.setPaused(s, true, now)
        case 'resume':
          return logic.setPaused(s, false, now)
        case 'reorder':
          return logic.reorder(s, a.userIds)
        case 'refund':
          return logic.refundMinutes(s, a.minutes, a.reason, admin.userId, crypto.randomUUID())
        case 'youtube':
          return [{ type: 'room', set: { youtube: a.on } }]
      }
    }, [audit])
    if (result.ok && a.action === 'youtube') this.sendToAgent({ type: 'youtube', on: a.on })
    return result
  }

  // Usuario bloqueado (sale de todo) o admin sin rol (suelta el control). Su conexión puede
  // seguir abierta: no guarda permisos, y las señales solo pasan a quien juega.
  async removeUser(userId: string, onlyControl: boolean): Promise<OpResult> {
    const result = await this.op((s, now) => logic.removeUser(s, userId, now, { onlyControl }))
    this.notifyNow(userId)
    return result
  }

  // Cambió algo guardado fuera de la sala (apodo, configuración).
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      this.state = null
      await this.after()
    })
  }

  notify(userId: string): void {
    this.notifyNow(userId)
  }

  // Segundos de vida para las credenciales TURN de quien juega; null si no le toca.
  turnTtl(userId: string): Promise<number | null> {
    return this.enqueue(async () => {
      const state = await this.load()
      return this.player(state)?.userId === userId ? this.ttl(state) : null
    })
  }

  async info(): Promise<{ agentLastSeen: number | null }> {
    return { agentLastSeen: this.agentOnline() ? Date.now() : ((await this.ctx.storage.get<number>('agentLastSeen')) ?? null) }
  }

  // --- WebSockets ---

  // El Worker ya verificó quién es y nos pasa los datos en cabeceras internas.
  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Se esperaba WebSocket', { status: 426 })
    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    if (request.headers.get('X-Room-Role') === 'agent') {
      // Un solo agente por sala: si había otro conectado, lo cerramos.
      for (const old of this.ctx.getWebSockets('agent')) old.close(4000, 'Reemplazado por otro agente')
      this.ctx.acceptWebSocket(server, ['agent'])
      server.serializeAttachment({ kind: 'agent' } satisfies Attachment)
      await this.enqueue(async () => {
        const state = await this.load()
        this.send(server, await this.playerMessage(state))
        this.send(server, { type: 'youtube', on: state.youtube })
        // Volvió el agente: si alguien jugaba, sigue con el tiempo perdido a su favor.
        const now = Date.now()
        await this.commit(playerInOutage(state) ? logic.outageEnd(state, now) : logic.tick(state, now))
      })
      const headers = request.headers.get('X-Agent-Subprotocol') ? { 'Sec-WebSocket-Protocol': 'ps4-agent' } : undefined
      return new Response(null, { status: 101, webSocket: client, headers })
    }

    if (this.ctx.getWebSockets('browser').length >= MAX_BROWSERS) return new Response('Sala llena', { status: 503 })
    const userId = request.headers.get('X-User-Id') ?? ''
    this.ctx.acceptWebSocket(server, userId ? ['browser', `user:${userId}`] : ['browser'])
    server.serializeAttachment({ kind: 'browser', userId, sid: crypto.randomUUID() } satisfies Attachment)
    await this.enqueue(async () => this.send(server, { type: 'state', state: this.publicState(await this.load()) }))
    return new Response(null, { status: 101, webSocket: client })
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_BYTES) return
    const who = ws.deserializeAttachment() as Attachment | null
    if (!who || (who.kind === 'browser' && !who.userId)) return // los visitantes solo miran
    let msg: { type?: string; data?: unknown; ps4?: unknown; fault?: unknown } | null
    try {
      msg = JSON.parse(message)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    const body = msg
    await this.enqueue(async () => {
      try {
        if (who.kind === 'agent') await this.onAgentMessage(body)
        else if (body.type === 'signal') await this.onBrowserSignal(who, body.data)
      } catch (e) {
        console.error('Room: mensaje', e)
      }
    })
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    const who = ws.deserializeAttachment() as Attachment | null
    // Los navegadores que se van conservan su lugar: pueden recargar la página.
    if (who?.kind !== 'agent') return
    await this.enqueue(async () => {
      if (this.agentOnline()) return // ya entró otro agente
      this.ps4Connected = false
      await this.ctx.storage.put({ ps4Connected: false, agentLastSeen: Date.now() })
      const state = await this.load()
      await this.commit(logic.outageStart({ ...state, agentOnline: false }, Date.now()))
    })
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  // Vence una oferta, un turno o la espera por una falla. Si falla D1, Cloudflare la repite.
  override async alarm(): Promise<void> {
    await this.enqueue(async () => {
      const state = await this.load()
      const now = Date.now()
      // Tras un despliegue no llega el cierre del agente: si alguien juega sin agente, es una falla.
      const lost = state.agentOnline ? [] : logic.outageStart(state, now)
      if (lost.length) await this.commit(lost)
      await this.commit(logic.tick(await this.load(), now))
    })
  }

  // --- internos ---

  private async onBrowserSignal(who: { userId: string; sid: string }, data: unknown) {
    // Solo quien juega negocia WebRTC con el agente. Si tiene la sala abierta en varias pestañas, juega la
    // última que pidió oferta ("ready"): las respuestas del agente van solo ahí.
    if (this.player(await this.load())?.userId !== who.userId) return
    const kind = (data as { type?: string } | null)?.type
    if (kind === 'ready') {
      this.playerSid = who.sid
      await this.ctx.storage.put('playerSid', who.sid)
    } else if (who.sid !== this.playerSid) return // respuesta de una pestaña que ya no es la activa
    this.sendToAgent({ type: 'signal', data })
  }

  private async onAgentMessage(msg: { type?: string; data?: unknown; ps4?: unknown; fault?: unknown }) {
    if (msg.type === 'signal') {
      const player = this.player(await this.load())
      if (!player) return
      for (const ws of this.ctx.getWebSockets(`user:${player.userId}`)) {
        const who = ws.deserializeAttachment() as Attachment | null
        if (who?.kind === 'browser' && who.sid === this.playerSid) this.send(ws, { type: 'signal', data: msg.data })
      }
    } else if (msg.type === 'status') {
      this.ps4Connected = msg.ps4 === true
      await this.ctx.storage.put('ps4Connected', this.ps4Connected)
      const state = await this.load()
      const now = Date.now()
      // fault:false sin consola: el jugador se fue durante la falla, así que su tiempo vuelve a correr.
      if ((this.ps4Connected || msg.fault === false) && playerInOutage(state)) await this.commit(logic.outageEnd(state, now))
      else if (msg.fault === true) await this.commit(logic.outageStart(state, now))
      else await this.after()
    }
  }

  // Quien manda ahora: el admin en control o el jugador del turno. El botón PS solo pasa en control.
  private player(state: State): { userId: string; name: string; isAdmin: boolean } | null {
    if (state.control) return { userId: state.control.userId, name: state.control.name, isAdmin: true }
    const p = logic.playing(state)
    return p ? { userId: p.userId, name: p.name, isAdmin: false } : null
  }

  private ttl(state: State): number {
    const p = logic.playing(state)
    if (state.control || !p?.endsAt) return CONTROL_TTL_S
    return Math.max(0, Math.ceil((p.endsAt - Date.now()) / 1000)) + TTL_MARGIN_S
  }

  // Incluye los servidores ICE (TURN), así el agente no necesita pedirlos por HTTP.
  private async playerMessage(state: State) {
    const player = this.player(state)
    return { type: 'player', player, iceServers: player ? await getIceServers(this.env, this.ttl(state)) : [] }
  }

  // Lo que ve cualquiera: apodos, nunca correos.
  private publicState(state: State) {
    const p = logic.playing(state)
    const o = logic.offered(state)
    const minutes = (b: logic.Booking) => Math.ceil(b.remainingMs / 60_000)
    return {
      queue: logic.queue(state).map((b) => ({ userId: b.userId, name: b.name, minutes: minutes(b) })),
      current: state.control
        ? { userId: state.control.userId, name: state.control.name, isAdmin: true, startedAt: state.control.since, endsAt: null }
        : p
          ? { userId: p.userId, name: p.name, isAdmin: false, startedAt: p.startedAt, endsAt: p.endsAt }
          : null,
      offer: o ? { userId: o.userId, name: o.name, minutes: minutes(o), expiresAt: o.offerExpiresAt } : null,
      paused: state.paused,
      youtube: state.youtube,
      agentOnline: state.agentOnline,
      ps4Connected: this.ps4Connected,
      now: Date.now(), // para que el navegador corrija la diferencia de reloj
    }
  }

  private broadcast(state: State) {
    const message = { type: 'state', state: this.publicState(state) }
    for (const ws of this.ctx.getWebSockets('browser')) this.send(ws, message)
  }

  private notifyNow(userId: string) {
    for (const ws of this.ctx.getWebSockets(`user:${userId}`)) this.send(ws, { type: 'me' })
  }

  private sendToAgent(message: unknown) {
    for (const ws of this.ctx.getWebSockets('agent')) this.send(ws, message)
  }

  private send(ws: WebSocket, message: unknown) {
    try {
      ws.send(JSON.stringify(message))
    } catch {
      // socket cerrándose: se limpia solo
    }
  }
}

export type AdminAction =
  | { action: 'take' | 'release' | 'pause' | 'resume' }
  | { action: 'skip'; reason: string }
  | { action: 'reorder'; userIds: string[] }
  | { action: 'refund'; minutes: number; reason: string }
  | { action: 'youtube'; on: boolean }

const playerInOutage = (s: State) => {
  const p = logic.playing(s)
  return p !== null && p.outageAt !== null
}

function failure(e: unknown): OpResult {
  if (e instanceof logic.RuleError) return { ok: false, status: e.status, error: e.message }
  const text = String(e)
  if (text.includes('CHECK constraint failed: available')) return { ok: false, status: 409, error: 'No tienes créditos suficientes.' }
  if (text.includes('UNIQUE constraint failed')) return { ok: false, status: 409, error: 'Eso ya se hizo. Actualiza la página.' }
  console.error('Room:', e)
  return { ok: false, status: 500, error: 'No se pudo completar. Intenta otra vez.' }
}
