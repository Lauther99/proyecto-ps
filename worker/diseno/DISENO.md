# Diseño del backend (etapa 3)

Cómo cumplir `web/API.md` en Cloudflare. Implementado en la etapa 4. El esquema vigente es
`../migrations/0002_credits.sql`; `0002_credits.sql` de esta carpeta es la propuesta original.

## 1. Piezas

```
Navegador ──HTTP──> Worker ──────────> D1 (la verdad: usuarios, dinero, cola, turnos)
    │                 │  RPC             ▲
    │                 └──> Durable Object Room (por sala): ordena las operaciones,
    └──WebSocket──────────> reloj, WebSockets, señalización ──WebSocket──> agente
```

| Decisión | Por qué |
|---|---|
| **D1 guarda dinero y turnos juntos** | Reservar créditos y entrar a la cola se hacen en un solo `batch`: pasan los dos o ninguno. Con la cola en el Durable Object y el saldo en D1, un corte a mitad dejaría créditos perdidos |
| **El Durable Object es el único que cambia `bookings` y `rooms`** | Una operación a la vez por sala. Su estado en memoria es una copia: al despertar o ante un error, se lee de D1 |
| **El saldo solo cambia por el libro (`ledger`)** | Un trigger aplica cada movimiento. Así el saldo y el historial no pueden separarse |
| **Sin R2, colas ni servicios nuevos** | No hay archivos que guardar |

Esperar a D1 dentro de un Durable Object deja entrar otros mensajes. Por eso `Room` tiene su **propia fila
de operaciones** (una promesa tras otra); no basta con `blockConcurrencyWhile`.

## 2. Dinero

| Momento | Movimiento | Disponible | Reservado |
|---|---|---|---|
| Recarga aprobada | `recharge:<id>` | +monto | |
| Entra a la cola | `reserve:<compra>` | -costo | +costo |
| Acepta | `charge:<compra>` | | -costo |
| Sale, deja pasar o vence sin haber pagado | `release:<compra>` | +costo | -costo |
| Falla nuestra o devolución del admin | `refund:<compra>:<motivo>` | +créditos | |
| Ajuste del admin | `adjust:<uuid>` | +/- | |

Reglas al programarlo:

1. `op_key` es único: repetir una operación no la aplica dos veces.
2. Cada `INSERT` del libro lleva su condición (`INSERT ... SELECT ... FROM bookings WHERE id = ? AND status =
   'playing'`). Un `UPDATE` que no cambia filas **no** cancela el batch.
3. Siempre se comprueba `meta.changes` del primer paso: si es 0, se responde 409.
4. Si el batch falla con resultado desconocido, se relee D1 antes de responder.
5. El costo se fija al comprar (`bookings.credits`). Cambiar el precio no afecta a quien ya está en la cola.
6. Devolución = `ceil(créditos × ms_sin_jugar / ms_comprados)`, sin pasar de lo cobrado. 22 min de 30 por
   15 créditos devuelven 11. Se redondea a favor del usuario.

## 3. Turnos

```
queued ──le toca──> offered ──acepta──> playing ──> done (complete | left | skipped | interrupted)
   │                   ├─ no acepta ──> expired   (aviso "expired")
   └─ sale ─> cancelled└─ deja pasar ─> cancelled
                  playing ──admin toma el control──> queued (primero, pagado, con su tiempo restante)
```

- Solo se ofrece si hay agente, no hay pausa, nadie tiene el control y no hay otro turno.
- Si el admin detuvo a alguien, al aceptar de nuevo no paga. Si sale o se le pasa, recupera lo que le
  faltaba, porque la interrupción fue nuestra.
- `pause` no corta al jugador. `skip` termina sin devolución (usar `refund` antes si corresponde).
- Bloquear a alguien: en cola, libera su reserva; jugando, termina su turno como `skipped`.
- Cerrar sesión no saca de la cola.
- La alarma del Durable Object usa el vencimiento más próximo: oferta, fin de turno o espera por falla.
  Puede repetirse sin daño, porque cada paso comprueba el `status`.

### Fallas de la consola

| Qué pasa | Qué se hace |
|---|---|
| Se cae el WebSocket del agente, o el agente informa `fault: true` | Se marca `outage_at` |
| Vuelve en menos de 90 s | El tiempo perdido se suma a `ends_at` |
| Pasan 90 s | `interrupted`, devolución desde `outage_at`, aviso al usuario y cola en pausa (`fault`) |
| Se corta el internet del jugador | Nada: su tiempo corre y puede volver |

**Hoy no se puede usar `ps4: false` como falla:** el agente también lo manda cuando cierra la sesión porque
el jugador cerró la pestaña. Cualquiera recuperaría sus créditos cerrando el navegador. Hace falta un cambio
pequeño en `agent/src/serve.cpp`: enviar `{type:"status", ps4, fault}`: `fault: true` solo si la sesión falla con el jugador conectado,
y `fault: false` si el jugador se va durante la falla (su tiempo vuelve a correr).

Después de una falla, la cola queda en pausa hasta que el admin la reanude. Detectar sola si la consola está
apagada (`consoleOff`) queda para después.

## 4. Operaciones de la sala (RPC del Worker al Durable Object)

`join`, `leave`, `accept`, `decline`, `end`, `admin(action)`, `removeUser`, `notify(userId)`. El Worker
valida sesión, bloqueo, rol y `Origin`; el Durable Object valida la regla y responde
`{ ok: true }` o `{ ok: false, status, error }`.

Límites por valor: `minutes` múltiplo del bloque y hasta el máximo; `refund` de 1 a 120 sin pasar de lo
cobrado; `reorder` debe traer exactamente a los que están en la cola o responde 409.

## 5. Seguridad

| Punto | Cambio |
|---|---|
| **TURN** | `/api/turn` solo para quien tiene el turno o el control. Hoy basta estar aprobado y, con entrada automática, cualquiera gastaría tu relé. Duración: lo que resta del turno más 15 min |
| **Login con Google** | El `state` se ata al navegador con una cookie. Hoy no lo está: alguien podría hacer que otra persona entre, sin notarlo, en una cuenta ajena y recargue ahí |
| **`next`** | Solo rutas internas: empieza con `/`, sin `//`, sin `\` y fuera de `/api` |
| **Identidad** | Se busca primero por `google_sub` y luego por correo. `google_sub` y correo en conflicto: se rechaza |
| **Apodo** | Nunca se publica el nombre de Google. Al crear la cuenta se asigna `Jugador-XXXXXXXX` |
| **Bloqueados** | Conservan la sesión para ver el motivo; toda acción responde 403 |
| **WebSocket público** | Valida `Origin`, ignora mensajes de visitantes y admite hasta 500 conexiones |
| **Abuso** | Máximo 3 recargas pendientes por persona y 500 soles por recarga. Límite de pedidos por IP o usuario (binding de Cloudflare) en login, apodo y recargas |
| **Admin** | Todo queda en `audit` con motivo. No puede bloquearse ni quitarse el rol a sí mismo |
| **Rol retirado o usuario bloqueado** | Pierde la cola, el turno o el control al instante. Su WebSocket no guarda permisos |

El número de operación repetido **no se bloquea, se marca**: el admin decide después de mirar Yape.

## 6. Archivos

| Archivo | Contenido |
|---|---|
| `src/index.ts` | Rutas. Solo exporta el handler y `Room` |
| `src/auth.ts` | Login: `next`, cookie del `state`, apodo, entrada automática |
| `src/http.ts` | Respuestas, `Origin`, permisos, lectura segura del cuerpo |
| `src/wallet.ts` | Consultas preparadas del libro y cálculo de devoluciones |
| `src/recharges.ts`, `src/history.ts`, `src/admin.ts`, `src/site.ts` | Rutas por tema |
| `src/room-logic.ts` | Reglas puras: de un estado a los cambios que hay que guardar |
| `src/room.ts` | Durable Object: fila, D1, alarma, WebSockets |
| `migrations/0002_credits.sql` | Esquema aprobado |

## 7. Migración y despliegue

La cola actual del Durable Object se descarta, así que debe hacerse sin nadie jugando. Los usuarios
pendientes pasan a aprobados y los bloqueados siguen bloqueados.

1. Respaldo: `npx wrangler d1 export ps4-room --remote --output respaldo.sql` (guardar fuera de git).
2. Pausar la sala y cerrar el agente.
3. `npm run db:migrate:remote` y `npm run deploy`, seguidos. Entre ambos el sitio viejo puede fallar al
   crear cuentas nuevas, porque no les pone apodo ni saldo; el código nuevo los crea si faltan al entrar.
4. Agente nuevo. Completar Yape y precio en `/admin/configuracion`.
5. Prueba completa con una recarga de 1 sol antes de abrirlo.

Volver atrás: Worker anterior (`wrangler rollback`) y, si hace falta, D1 Time Travel. Después de aceptar
recargas reales **no** se restaura la base, porque se perderían pagos: se corrige con ajustes.

## 8. Pruebas de la etapa 4

- Unitarias: turnos, fallas, devoluciones, redondeos, admin y alarmas repetidas.
- Integración con D1 local: doble clic, dos admins aprobando, aceptar justo al vencer, batch cortado.
- Invariante después de cada prueba: saldo = suma del libro, y reservado = compras en cola u ofrecidas sin
  cobrar.
- Humo: de la recarga al fin del turno, visitante, bloqueado, agente que se cae y vuelve.
- Manual: consola, mando y celular con datos.

## 9. Orden de implementación

1. Migración, `wallet` y pruebas de dinero.
2. Login, `/api/site`, `/api/me`, apodo.
3. Recargas e historial, con su admin.
4. Sala: cola, turnos, WebSocket público, TURN, admin de sala.
5. Fallas y cambio del agente.
6. Integración con `web/`, humo y prueba real.
