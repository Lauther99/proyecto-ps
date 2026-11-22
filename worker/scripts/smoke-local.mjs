// Prueba de humo contra "wrangler dev" local (necesita .dev.vars con DEV_LOGIN=true,
// AGENT_TOKEN=dev-agent-token y ADMIN_EMAILS=admin@test.local).
// Uso: node scripts/smoke-local.mjs
// Simula: admin y jugador entran, el jugador queda pendiente, el admin lo aprueba, el agente se
// conecta, el jugador entra a la cola, acepta, intercambian señalización y el admin toma el control.

const API = process.env.API ?? 'http://localhost:8787'
const ORIGIN = 'http://localhost:3000'
const AGENT_TOKEN = process.env.AGENT_TOKEN ?? 'dev-agent-token'

let failures = 0
function check(label, ok, extra = '') {
  console.log(`${ok ? 'OK  ' : 'FALLA'} ${label}${extra ? `  (${extra})` : ''}`)
  if (!ok) failures++
}

async function login(email, name) {
  const res = await fetch(`${API}/api/auth/dev-login`, {
    method: 'POST',
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name }),
  })
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
  return { user: await res.json(), cookie }
}

function api(path, cookie, init = {}) {
  return fetch(`${API}${path}`, { ...init, headers: { Origin: ORIGIN, Cookie: cookie, ...(init.headers ?? {}) } })
}

// WebSocket con cola de mensajes para poder esperar uno concreto.
function connect(path, headers) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${API.replace('http', 'ws')}${path}`, { headers })
    const inbox = []
    const waiters = []
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data)
      const i = waiters.findIndex((w) => w.match(msg))
      if (i >= 0) waiters.splice(i, 1)[0].resolve(msg)
      else inbox.push(msg)
    }
    ws.onerror = () => reject(new Error(`no se pudo abrir ${path}`))
    ws.onopen = () =>
      resolve({
        send: (m) => ws.send(JSON.stringify(m)),
        close: () => ws.close(),
        wait: (match, ms = 3000) =>
          new Promise((res, rej) => {
            const i = inbox.findIndex(match)
            if (i >= 0) return res(inbox.splice(i, 1)[0])
            const t = setTimeout(() => rej(new Error('tiempo agotado esperando mensaje')), ms)
            waiters.push({ match, resolve: (m) => (clearTimeout(t), res(m)) })
          }),
      })
  })
}

// true si el servidor rechaza abrir el WebSocket.
function rejected(path, headers) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`${API.replace('http', 'ws')}${path}`, { headers })
    ws.onopen = () => (ws.close(), resolve(false))
    ws.onerror = () => resolve(true)
  })
}

const admin = await login('admin@test.local', 'Admin')
const player = await login(`jugador${Date.now()}@test.local`, 'Jugador Ñandú')
check('admin entra aprobado y como admin', admin.user.status === 'approved' && admin.user.role === 'admin')
check('jugador nuevo queda pendiente', player.user.status === 'pending')

const me = await (await api('/api/me', player.cookie)).json()
check('/api/me devuelve al jugador', me.user?.id === player.user.id)

check('pendiente no puede entrar a la sala', await rejected('/api/room/ws', { Origin: ORIGIN, Cookie: player.cookie }))
check(
  'sala rechaza WebSocket desde otra web',
  await rejected('/api/room/ws', { Origin: 'https://otra-web.example', Cookie: admin.cookie }),
)
check('agente con token incorrecto no abre WebSocket', await rejected('/api/agent/ws', { Authorization: 'Bearer otro' }))

const badAgent = await fetch(`${API}/api/agent/turn`, { headers: { Authorization: 'Bearer otro' } })
check('agente con token incorrecto es rechazado', badAgent.status === 401)

const approve = await api(`/api/admin/users/${player.user.id}`, admin.cookie, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ status: 'approved' }),
})
check('admin aprueba al jugador', (await approve.json()).user?.status === 'approved')

const notAdmin = await api('/api/admin/users', player.cookie)
check('jugador no ve el panel de usuarios', notAdmin.status === 403)

const turn = await (await api('/api/turn', player.cookie)).json()
check('jugador aprobado recibe servidores ICE', Array.isArray(turn.iceServers) && turn.iceServers.length > 0)

const agent = await connect('/api/agent/ws', { Authorization: `Bearer ${AGENT_TOKEN}` })
await agent.wait((m) => m.type === 'player')
check('agente conectado recibe "player"', true)

const adminWs = await connect('/api/room/ws', { Origin: ORIGIN, Cookie: admin.cookie })
const playerWs = await connect('/api/room/ws', { Origin: ORIGIN, Cookie: player.cookie })
const hello = await playerWs.wait((m) => m.type === 'hello')
check('nombre con tildes llega bien', hello.me.name === 'Jugador Ñandú', hello.me.name)
const initial = await playerWs.wait((m) => m.type === 'state')
check('estado muestra agente en línea', initial.state.agentOnline === true)

// Limpieza por si quedó algo de una corrida anterior.
adminWs.send({ type: 'admin', action: 'release' })
adminWs.send({ type: 'admin', action: 'resume' })

playerWs.send({ type: 'join' })
const offered = await playerWs.wait((m) => m.type === 'state' && m.state.offer?.userId === player.user.id)
check('jugador recibe la oferta de turno', Boolean(offered))

playerWs.send({ type: 'accept' })
const toAgent = await agent.wait((m) => m.type === 'player' && m.player?.userId === player.user.id)
check('agente recibe al nuevo jugador', toAgent.player.isAdmin === false)

// El jugador tiene la sala abierta en dos pestañas: juega la que pide oferta ("ready").
const secondTab = await connect('/api/room/ws', { Origin: ORIGIN, Cookie: player.cookie })
playerWs.send({ type: 'signal', data: { type: 'ready' } })
const ready = await agent.wait((m) => m.type === 'signal' && m.data?.type === 'ready')
check('agente recibe "ready" del jugador', Boolean(ready))

agent.send({ type: 'signal', data: { type: 'offer', sdp: 'v=0 prueba' } })
const sig = await playerWs.wait((m) => m.type === 'signal')
check('señal agente -> jugador', sig.data.sdp === 'v=0 prueba')
const leaked = await secondTab.wait((m) => m.type === 'signal', 500).then(() => true, () => false)
check('la otra pestaña del mismo jugador no recibe la oferta', !leaked)
secondTab.close()

playerWs.send({ type: 'signal', data: { type: 'answer', sdp: 'v=0 respuesta' } })
const back = await agent.wait((m) => m.type === 'signal')
check('señal jugador -> agente', back.data.sdp === 'v=0 respuesta')

adminWs.send({ type: 'admin', action: 'turnMinutes', value: 30 })
await adminWs.wait((m) => m.type === 'state' && m.state.turnMinutes === 30)
check('admin cambia duración del turno a 30 min', true)

playerWs.send({ type: 'admin', action: 'skip' })
const denied = await playerWs.wait((m) => m.type === 'error')
check('jugador no puede usar acciones de admin', Boolean(denied))

adminWs.send({ type: 'admin', action: 'take' })
const take = await agent.wait((m) => m.type === 'player' && m.player?.isAdmin === true)
check('admin toma el control (agente recibe admin)', Boolean(take))
const afterTake = await playerWs.wait((m) => m.type === 'state' && m.state.current?.isAdmin === true)
check('jugador interrumpido vuelve primero a la cola', afterTake.state.queue[0]?.userId === player.user.id)

// Deja la sala limpia.
playerWs.send({ type: 'leave' })
adminWs.send({ type: 'admin', action: 'release' })
adminWs.send({ type: 'admin', action: 'turnMinutes', value: 15 })
await new Promise((r) => setTimeout(r, 300))
for (const ws of [agent, adminWs, playerWs]) ws.close()

console.log(failures ? `\n${failures} prueba(s) fallaron` : '\nTodo OK')
process.exit(failures ? 1 : 0)
