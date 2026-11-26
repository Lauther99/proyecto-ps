# Contrato frontend y backend

Lo que `web/` espera del Worker (etapas 3 y 4). Los tipos exactos están en `lib/api.ts` y
`lib/room-client.ts`; `lib/demo/backend.ts` es una implementación de ejemplo en memoria.

Errores: estado HTTP 4xx/5xx con `{ "error": "texto para el usuario" }`. Las POST sin datos responden 204
o `null`. Todas las POST validan `Origin`. Horas en ms desde 1970.

## Público

| Ruta | Respuesta |
|---|---|
| `GET /api/health` | `{ ok }`. También la usa la prueba de conexión (21 pedidos por medición) |
| `GET /api/site` | `Site`: configuración, salas y juegos |
| `GET /api/me` | `{ user: User \| null, devLogin }`. Un bloqueado conserva su sesión para ver el motivo |
| `GET /api/auth/google/login?next=/ruta` | Login. Al volver, redirige a `next` (solo rutas internas que empiecen con una sola `/`) |
| `GET /api/room/ws` | WebSocket de la sala, con o sin sesión |

## Con sesión (no bloqueado)

| Ruta | Cuerpo | Efecto |
|---|---|---|
| `POST /api/me` | `{ nickname }` | Cambia el apodo (3 a 20 caracteres, único) |
| `POST /api/me/notice/dismiss` | | Cierra el aviso (`expired` o `interrupted`) |
| `POST /api/queue/join` | `{ minutes }` | Reserva créditos y entra a la cola. Borra el aviso |
| `POST /api/queue/leave` | | Sale de la cola; la reserva vuelve |
| `POST /api/turn/accept` | | Cobra la reserva y empieza el turno |
| `POST /api/turn/decline` | | Deja pasar la oferta; la reserva vuelve |
| `POST /api/turn/end` | | Termina su turno antes de tiempo, sin devolución |
| `GET /api/turn` | | Servidores ICE |
| `GET /api/turn/test` | | Servidores ICE por 2 minutos, para la prueba de conexión (con sesión) |
| `GET /api/speed` | | Hasta 25 MB al azar, para medir la velocidad de bajada (con sesión) |
| `GET /api/recharges` | | `{ recharges }`, la más nueva primero |
| `POST /api/recharges` | `{ amount, operation, key }` | Crea una pendiente. `operation` es texto (conserva ceros). `key` evita duplicados al reintentar |
| `GET /api/movements`, `GET /api/sessions` | | Historial, lo más nuevo primero |
| `POST /api/sessions/:id/rating` | `{ score, problems }` | Calificación, 1 a 5 |

## Admin

`GET /api/admin/summary`, `recharges?status=`, `users`, `sessions`, `sessions/:id/events`, `games`. Y `POST`:

| Ruta | Cuerpo |
|---|---|
| `/api/admin/recharges/:id` | `{ status: "approved" }` o `{ status: "rejected", reason }`. Solo si está pendiente |
| `/api/admin/users/:id` | `{ status, reason }` o `{ role }` |
| `/api/admin/users/:id/balance` | `{ delta, reason }`. Nunca deja saldo negativo |
| `/api/admin/games/:id` | `{ status }` |
| `/api/admin/config` | Precio, Yape y canal |
| `/api/admin/sessions/:id/refund` | `{ credits, reason, key }`: partida terminada, sin pasar de lo cobrado. `key` evita duplicados |
| `/api/admin/rooms/:id` | `{ name, console, game }`: lo que se muestra de la sala. `game` puede ir vacío |
| `/api/admin/room` | `RoomAction`: take, release, skip, pause, resume, reorder, refund, youtube |

## WebSocket

Sala a navegador: `{type:"state", state}` al conectar y en cada cambio, `{type:"me"}` al usuario cuyo saldo,
aviso o cuenta cambió, `{type:"signal", data}` solo al jugador, `{type:"error", message}`.
Navegador a sala: `{type:"signal", data}`, `{type:"quality", rtt, loss, jitter}` cada 30 s (solo quien juega) y `"ping"`.

- `state.queue`, `current` y `offer` llevan apodo, nunca correo. `minutes` es lo que jugará cada uno.
- `current.endsAt` es `null` cuando el admin tomó el control. El jugador detenido vuelve primero a la cola
  con sus minutos restantes en `minutes`, sin pagar otra vez al aceptar.
- El agente manda `{type:"status", ps4, fault}`; `fault` distingue una falla nuestra de que el jugador se fue.
- `outage: {since, until}` mientras hay una falla nuestra; el reloj del turno se muestra detenido en `since`.
- El agente manda `{type:"viewer", userId, connected}` cuando el video del jugador conecta o se corta.
- `paused` sin jugador se muestra como "En mantenimiento".
- `ps4Connected` no indica consola apagada (la sesión es bajo demanda). Para eso, `consoleOff: true`.
- Los cobros y devoluciones deben decidirse en el servidor. El frontend solo los muestra.
