// Prueba de humo contra un backend local de prueba. Levanta su propio wrangler con una base temporal,
// así no toca tus datos de desarrollo. Uso: npm run smoke
// Recorre: login, recarga, cola, turno, señalización, fallas del agente, admin y bloqueos.

import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PORT = 8799
const API = `http://localhost:${PORT}`
const ORIGIN = 'http://localhost:3000'
const AGENT_TOKEN = 'token-de-prueba'
const DATA = mkdtempSync(join(tmpdir(), 'wlg-smoke-'))
const WRANGLER = join(ROOT, 'node_modules/wrangler/bin/wrangler.js')

const migrate = spawnSync(process.execPath, [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', DATA], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' } })
if (migrate.status !== 0) {
  console.error(migrate.stdout, migrate.stderr)
  process.exit(1)
}
const vars = { APP_URL: ORIGIN, DEV_LOGIN: 'true', AGENT_TOKEN, ADMIN_EMAILS: 'admin@test.local', TURN_KEY_ID: '', TURN_KEY_API_TOKEN: '', GOOGLE_CLIENT_ID: 'prueba', GOOGLE_CLIENT_SECRET: 'prueba' }
const server = spawn(process.execPath, [WRANGLER, 'dev', '--port', String(PORT), '--local-upstream', `localhost:${PORT}`, '--persist-to', DATA, ...Object.entries(vars).flatMap(([k, v]) => ['--var', `${k}:${v}`])], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] })
let log = ''
server.stdout.on('data', (d) => (log += d))
server.stderr.on('data', (d) => (log += d))
function stop() {
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(server.pid), '/T', '/F'])
  else server.kill()
}

let failures = 0
let total = 0
function check(label, ok, extra = '') {
  total++
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${label}${!ok && extra !== '' ? `  (${JSON.stringify(extra)})` : ''}`)
  if (!ok) failures++
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function call(user, path, body, origin = ORIGIN) {
  const res = await fetch(`${API}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    headers: { Cookie: user?.cookie ?? '', ...(body === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const data = res.status === 204 ? null : await res.json().catch(() => null)
  return { status: res.status, data, headers: res.headers }
}
async function login(email) {
  const r = await call(null, '/api/auth/dev-login', { email, name: 'Nombre Real' })
  const user = { cookie: (r.headers.get('set-cookie') ?? '').split(';')[0] }
  const me = await call(user, '/api/me')
  return { ...user, ...me.data.user }
}
const balance = async (u) => (await call(u, '/api/me')).data.user.balance

function connect(path, headers = {}, protocols) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${API.replace('http', 'ws')}${path}`, { headers, protocols })
    const c = { last: null, inbox: [], send: (m) => ws.send(JSON.stringify(m)), close: () => ws.close() }
    c.wait = async (match, ms = 4000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) {
        const i = c.inbox.findIndex(match)
        if (i >= 0) return c.inbox.splice(i, 1)[0]
      }
      throw new Error('tiempo agotado esperando un mensaje')
    }
    c.until = async (match, ms = 4000) => {
      for (const end = Date.now() + ms; Date.now() < end; await sleep(20)) if (c.last && match(c.last)) return c.last
      throw new Error(`la sala no llegó al estado esperado: ${JSON.stringify(c.last)}`)
    }
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data)
      if (m.type === 'state') c.last = m.state
      else c.inbox.push(m)
    }
    ws.onerror = () => reject(new Error(`no se pudo abrir ${path}`))
    ws.onopen = () => resolve(c)
  })
}
const room = (u) => connect('/api/room/ws', { Origin: ORIGIN, ...(u ? { Cookie: u.cookie } : {}) })
const agentConnect = () => connect('/api/agent/ws', {}, ['ps4-agent', AGENT_TOKEN])
const rejected = (p) => p.then((c) => (c.close(), false), () => true)

async function main() {
  for (let i = 0; i < 120; i++) {
    if (await fetch(`${API}/api/health`).then((r) => r.ok, () => false)) break
    await sleep(500)
  }
  const admin = await login('admin@test.local')
  const ana = await login('ana@test.local')
  const beto = await login('beto@test.local')

  // --- cuentas ---
  check('entrada automática, con apodo y sin nombre de Google', ana.status === 'approved' && ana.nickname.startsWith('Jugador-') && ana.balance.available === 0)
  check('correo de ADMIN_EMAILS entra como admin', admin.role === 'admin')
  check('visitante: /api/me responde 401 con user null', await call(null, '/api/me').then((r) => r.status === 401 && r.data.user === null))
  check('POST desde otra web se rechaza', (await call(ana, '/api/me', { nickname: 'Ana_1' }, 'https://otra.example')).status === 403)
  check('cambia el apodo', (await call(ana, '/api/me', { nickname: 'Ana_Ñ' })).status === 204)
  check('apodo repetido (mayúsculas y tildes incluidas) se rechaza', (await call(beto, '/api/me', { nickname: 'ana_ñ' })).status === 409)
  check('apodo inválido se rechaza', (await call(beto, '/api/me', { nickname: 'a b<c>' })).status === 400)
  check('jugador no entra al admin', (await call(ana, '/api/admin/users')).status === 403)
  const g = await call(null, '/api/auth/google/login?next=/sala?id=main')
  check('login de Google ata el navegador con una cookie', g.status === 302 && /ps_oauth=.+HttpOnly/.test(g.headers.get('set-cookie') ?? ''))
  const state = new URL(g.headers.get('location')).searchParams.get('state')
  const cb = await call(null, `/api/auth/google/callback?code=x&state=${state}`)
  check('callback sin la cookie del navegador se rechaza', cb.headers.get('location').includes('login_error=expirado'))

  // --- configuración y recargas ---
  check('sin Yape configurado no hay recargas', (await call(ana, '/api/recharges', { amount: 20, operation: '001234', key: 'k0' })).status === 409)
  const config = { blockMinutes: 30, blockCredits: 15, maxMinutes: 120, acceptSeconds: 15, yapeHolder: 'Prueba', yapeNumber: '900000000', youtubeChannelId: null }
  check('admin guarda la configuración', (await call(admin, '/api/admin/config', config)).status === 204)
  check('configuración imposible se rechaza', (await call(admin, '/api/admin/config', { ...config, maxMinutes: 100 })).status === 400)
  const site = (await call(null, '/api/site')).data
  check('/api/site es público y trae sala y precio', site.rooms[0]?.id === 'main' && site.config.acceptSeconds === 15)
  const r1 = await call(ana, '/api/recharges', { amount: 40, operation: '001234', key: 'k1' })
  check('el número de operación debe tener 6 dígitos', (await call(ana, '/api/recharges', { amount: 40, operation: '1234567', key: 'k9' })).status === 400)
  check('recarga creada, conserva los ceros', r1.status === 200 && r1.data.recharge.operation === '001234')
  check('reintento con la misma clave no duplica', (await call(ana, '/api/recharges', { amount: 40, operation: '001234', key: 'k1' })).data.recharge.id === r1.data.recharge.id)
  check('misma operación pendiente se rechaza', (await call(ana, '/api/recharges', { amount: 40, operation: '001234', key: 'k2' })).status === 409)
  const r2 = await call(beto, '/api/recharges', { amount: 20, operation: '001234', key: 'k3' })
  const list = (await call(admin, '/api/admin/recharges?status=pending')).data.recharges
  check('admin ve la operación repetida', list.length === 2 && list.every((r) => r.repeated))
  const both = await Promise.all([1, 2, 3].map(() => call(admin, `/api/admin/recharges/${r1.data.recharge.id}`, { status: 'approved' })))
  check('aprobar a la vez suma una sola vez', both.filter((r) => r.status === 204).length === 1 && (await balance(ana)).available === 40, both.map((r) => r.status))
  check('rechazar exige motivo', (await call(admin, `/api/admin/recharges/${r2.data.recharge.id}`, { status: 'rejected' })).status === 400)
  check('rechazar no suma', (await call(admin, `/api/admin/recharges/${r2.data.recharge.id}`, { status: 'rejected', reason: 'No llegó' })).status === 204 && (await balance(beto)).available === 0)
  check('ajuste a negativo se rechaza', (await call(admin, `/api/admin/users/${beto.id}/balance`, { delta: -1, reason: 'x' })).status === 409)
  check('ajuste suma', (await call(admin, `/api/admin/users/${beto.id}/balance`, { delta: 30, reason: 'regalo' })).status === 204 && (await balance(beto)).available === 30)

  // --- detalles de la sala ---
  check('jugador no edita la sala', (await call(ana, '/api/admin/rooms/main', { name: 'X', console: 'PS5', game: '' })).status === 403)
  check('sala sin nombre se rechaza', (await call(admin, '/api/admin/rooms/main', { name: ' ', console: 'PS5', game: '' })).status === 400)
  check('admin edita la sala y se publica', (await call(admin, '/api/admin/rooms/main', { name: 'Sala Azul', console: 'PS5', game: 'Juego A' })).status === 204 && JSON.stringify((await call(null, '/api/site')).data.rooms) === JSON.stringify([{ id: 'main', name: 'Sala Azul', console: 'PS5', game: 'Juego A' }]))
  check('sala que no existe', (await call(admin, '/api/admin/rooms/otra', { name: 'X', console: 'PS5', game: '' })).status === 404)

  // --- sala ---
  check('WebSocket desde otra web se rechaza', await rejected(connect('/api/room/ws', { Origin: 'https://otra.example' })))
  check('agente con token malo se rechaza', await rejected(connect('/api/agent/ws', {}, ['ps4-agent', 'malo'])))
  const visitor = await room(null)
  const wsAna = await room(ana)
  await visitor.until((s) => s.agentOnline === false)
  check('el visitante ve la sala', true)
  check('sin agente no se entra a la cola', (await call(ana, '/api/queue/join', { minutes: 30 })).status === 409)
  let agent = await agentConnect()
  await visitor.until((s) => s.agentOnline)
  check('bloque que no es múltiplo se rechaza', (await call(ana, '/api/queue/join', { minutes: 45 })).status === 400)
  const joins = await Promise.all([1, 2].map(() => call(ana, '/api/queue/join', { minutes: 30 })))
  check('doble clic entra y reserva una vez', joins.filter((r) => r.status === 204).length === 1 && JSON.stringify(await balance(ana)) === '{"available":25,"reserved":15}')
  const offer = await visitor.until((s) => s.offer)
  check('la sala publica apodo, nunca correo ni nombre', offer.offer.name === 'Ana_Ñ' && !JSON.stringify(offer).includes('@') && !JSON.stringify(offer).includes('Real'))
  check('quien no juega no recibe TURN', (await call(ana, '/api/turn')).status === 403 && (await call(beto, '/api/turn')).status === 403)
  check('la prueba de conexión exige sesión', (await fetch(`${API}/api/turn/test`)).status === 401 && (await call(beto, '/api/turn/test')).status === 200)
  check('la prueba de velocidad exige sesión', (await fetch(`${API}/api/speed`)).status === 401)
  check('beto entra detrás', (await call(beto, '/api/queue/join', { minutes: 60 })).status === 204)
  check('beto no puede aceptar el turno de ana', (await call(beto, '/api/turn/accept', {})).status === 409)
  const accepts = await Promise.all([1, 2].map(() => call(ana, '/api/turn/accept', {})))
  check('aceptar dos veces cobra una', accepts.filter((r) => r.status === 204).length === 1 && JSON.stringify(await balance(ana)) === '{"available":25,"reserved":0}')
  const pm = await agent.wait((m) => m.type === 'player' && m.player?.userId === ana.id)
  check('el agente recibe al jugador, sin permiso del botón PS', pm.player.isAdmin === false && Array.isArray(pm.iceServers))
  check('quien juega recibe TURN', (await call(ana, '/api/turn')).status === 200)
  visitor.send({ type: 'signal', data: { type: 'ready' } })
  wsAna.send({ type: 'signal', data: { type: 'ready' } })
  await agent.wait((m) => m.type === 'signal' && m.data.type === 'ready')
  await sleep(200)
  check('solo llega la señal de quien juega', !agent.inbox.some((m) => m.type === 'signal'))
  agent.send({ type: 'signal', data: { type: 'offer', sdp: 'x' } })
  check('la oferta llega al jugador y a nadie más', (await wsAna.wait((m) => m.type === 'signal')).data.sdp === 'x' && !visitor.inbox.length)

  agent.send({ type: 'viewer', userId: ana.id, connected: true })
  wsAna.send({ type: 'quality', rtt: 40, loss: 0, jitter: 3 })
  wsAna.send({ type: 'quality', rtt: 41, loss: 0, jitter: 3 })
  visitor.send({ type: 'quality', rtt: 1, loss: 0, jitter: 0 })
  agent.send({ type: 'viewer', userId: beto.id, connected: false })

  // --- fallas ---
  const before = (await visitor.until((s) => s.current)).current.endsAt
  agent.send({ type: 'status', ps4: false })
  await sleep(300)
  agent.send({ type: 'status', ps4: true, fault: false })
  await sleep(300)
  check('cerrar la pestaña (ps4:false sin falla) no regala tiempo', visitor.last.current.endsAt === before)
  agent.send({ type: 'status', ps4: false, fault: true })
  const out = await visitor.until((s) => s.outage)
  check('la sala avisa de la falla con su límite de 90 s', out.outage.until - out.outage.since === 90_000)
  await sleep(1200)
  agent.send({ type: 'status', ps4: true, fault: false })
  const extra = (await visitor.until((s) => s.current.endsAt > before)).current.endsAt - before
  check('una falla real suma el tiempo perdido', extra >= 1000 && extra < 5000, extra)
  agent.close()
  await visitor.until((s) => !s.agentOnline)
  await sleep(1000)
  agent = await agentConnect()
  const again = await visitor.until((s) => s.agentOnline && s.current.endsAt > before + extra + 800)
  check('si el agente se cae y vuelve, el turno sigue con lo perdido', again.current.userId === ana.id)
  await agent.wait((m) => m.type === 'player' && m.player?.userId === ana.id)

  // --- admin en la sala ---
  check('tomar el control', (await call(admin, '/api/admin/room', { action: 'take' })).status === 204)
  const taken = await visitor.until((s) => s.current?.isAdmin)
  check('el jugador vuelve primero con su tiempo', taken.queue[0].userId === ana.id && taken.queue[0].minutes === 30 && taken.current.endsAt === null)
  check('el agente permite el botón PS solo en control', (await agent.wait((m) => m.type === 'player' && m.player?.userId === admin.id)).player.isAdmin === true)
  check('reordenar con una cola vieja se rechaza', (await call(admin, '/api/admin/room', { action: 'reorder', userIds: [ana.id] })).status === 409)
  check('soltar el control', (await call(admin, '/api/admin/room', { action: 'release' })).status === 204)
  await visitor.until((s) => s.offer?.userId === ana.id)
  check('aceptar de nuevo no cobra', (await call(ana, '/api/turn/accept', {})).status === 204 && (await balance(ana)).available === 25)
  check('devolver 10 min suma 5', (await call(admin, '/api/admin/room', { action: 'refund', minutes: 10, reason: 'lag' })).status === 204 && (await balance(ana)).available === 30)
  check('terminar antes no devuelve', (await call(ana, '/api/turn/end', {})).status === 204 && (await balance(ana)).available === 30)
  const ses = (await call(ana, '/api/sessions')).data.sessions
  check('la sesión queda en el historial', ses.length === 1 && ses[0].game === 'Juego A' && ses[0].result === 'left' && ses[0].refundedCredits === 5, ses)
  check('jugador no ve el registro', (await call(ana, `/api/admin/sessions/${ses[0].id}/events`)).status === 403)
  const rep = (await call(admin, `/api/admin/sessions/${ses[0].id}/events`)).data
  const kinds = rep.events.map((e) => e.kind)
  check('el registro anota la partida', ['start', 'video_on', 'quality', 'console_fault', 'recovered', 'agent_off', 'agent_on', 'held', 'refund', 'end'].every((k) => kinds.includes(k)) && kinds.filter((k) => k === 'quality').length === 1 && !kinds.includes('video_off'), kinds)
  check('veredicto: falla nuestra', rep.report.verdict === 'ours', rep.report)
  const refund = (credits, key) => call(admin, `/api/admin/sessions/${ses[0].id}/refund`, { credits, reason: 'reclamo', key })
  check('devolver más de lo cobrado se rechaza', (await refund(11, 'a')).status === 409 && (await balance(ana)).available === 30)
  const same = await Promise.all([1, 2].map(() => refund(2, 'b')))
  check('devolución manual con doble clic suma una vez', same.filter((r) => r.status === 204).length === 1 && (await balance(ana)).available === 32)
  check('el admin ve cuántas devoluciones manuales tuvo', (await call(admin, '/api/admin/users')).data.users.find((u) => u.id === ana.id).manualRefunds === 2)
  await call(admin, `/api/admin/users/${ana.id}/balance`, { delta: -2, reason: 'fin de la prueba' })
  check('calificar la sesión propia', (await call(ana, `/api/sessions/${ses[0].id}/rating`, { score: 4, problems: [] })).status === 204 && (await call(beto, `/api/sessions/${ses[0].id}/rating`, { score: 1, problems: [] })).status === 404)
  const mov = (await call(ana, '/api/movements')).data.movements
  check('los movimientos cuadran con el saldo', mov.reduce((t, m) => t + m.credits, 0) === 30 && mov.length === 5, mov)

  // --- oferta vencida (15 s) ---
  await visitor.until((s) => s.offer?.userId === beto.id)
  console.log('     esperando que venza la oferta de beto (15 s)...')
  await visitor.until((s) => !s.offer, 20_000)
  const b = (await call(beto, '/api/me')).data.user
  check('al vencer vuelven los créditos y queda el aviso', JSON.stringify(b.balance) === '{"available":30,"reserved":0}' && b.notice?.kind === 'expired', b)
  check('cerrar el aviso', (await call(beto, '/api/me/notice/dismiss', {})).status === 204 && (await call(beto, '/api/me')).data.user.notice === null)

  // --- pausa y bloqueo ---
  await call(admin, '/api/admin/room', { action: 'pause' })
  check('en pausa no se entra', (await call(beto, '/api/queue/join', { minutes: 30 })).status === 409)
  await call(admin, '/api/admin/room', { action: 'resume' })
  await call(beto, '/api/queue/join', { minutes: 30 })
  const wsBeto = await room(beto)
  check('bloquear exige motivo', (await call(admin, `/api/admin/users/${beto.id}`, { status: 'blocked' })).status === 400)
  check('bloquear', (await call(admin, `/api/admin/users/${beto.id}`, { status: 'blocked', reason: 'prueba' })).status === 204)
  const bb = (await call(beto, '/api/me')).data.user
  check('el bloqueado recupera la reserva y ve el motivo', bb.status === 'blocked' && bb.blockedReason === 'prueba' && bb.balance.available === 30 && bb.balance.reserved === 0, bb)
  await wsBeto.wait((m) => m.type === 'me')
  check('se le avisa y no puede entrar a la cola', (await call(beto, '/api/queue/join', { minutes: 30 })).status === 403)
  check('el admin no puede bloquearse a sí mismo', (await call(admin, `/api/admin/users/${admin.id}`, { status: 'blocked', reason: 'x' })).status === 400)

  // --- falla larga (90 s) ---
  await call(ana, '/api/queue/join', { minutes: 30 })
  await visitor.until((s) => s.offer?.userId === ana.id)
  await call(ana, '/api/turn/accept', {})
  agent.close()
  console.log('     esperando la falla larga (90 s)...')
  await visitor.until((s) => s.current === null && s.paused, 100_000)
  const a = (await call(ana, '/api/me')).data.user
  check('falla de 90 s: devuelve lo no jugado, avisa y pausa', a.balance.available === 30 && a.notice?.kind === 'interrupted' && a.notice.refundedCredits === 15, a)
  const sum = (await call(admin, '/api/admin/summary')).data
  check('el resumen del admin cuadra', sum.income[0].soles === 40 && sum.income[0].recharges === 1 && sum.agentLastSeen > 0 && sum.pendingRecharges === 0, sum)
  check('listas del admin responden', (await Promise.all(['users', 'sessions', 'games'].map((s) => call(admin, `/api/admin/${s}`)))).every((r) => r.status === 200))
  check('cerrar sesión', (await call(ana, '/api/auth/logout', {})).status === 204 && (await call(ana, '/api/me')).status === 401)
}

try {
  await main()
} catch (e) {
  failures++
  console.error('FALLA', e)
} finally {
  stop()
  await sleep(1500)
  rmSync(DATA, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
}
const errors = log.split('\n').filter((l) => /\[ERROR\]|✘|Uncaught/.test(l))
if (failures || errors.length) console.log(errors.join('\n') || log.slice(-2000))
console.log(failures ? `\n${failures} de ${total} fallaron` : `\nTodo bien: ${total} comprobaciones`)
process.exit(failures ? 1 : 0)
