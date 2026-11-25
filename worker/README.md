# worker/ (backend de la sala)

Cloudflare Worker + Durable Object `Room` + D1. Login con Google, créditos y recargas por Yape, cola de
turnos y señalización WebRTC entre el navegador del jugador y el agente de la casa.
Diseño en `diseno/DISENO.md`; contrato con el frontend en `../web/API.md`.

## Desarrollo local (sin desplegar nada)

```powershell
cd worker
npm install
copy .dev.vars.example .dev.vars   # y completa los valores
npm run db:migrate:local
npm run dev                        # http://localhost:8787
```

Mientras desarrollas, corre también el frontend (`npm run dev` en `web/`, puerto 3000): Next
reenvía `/api` a este backend.

Para ver la app como quedará desplegada (un solo Worker sirviendo frontend + API, sin Next):

```powershell
npm run preview                    # http://localhost:8787 (exporta web/ y la sirve desde el Worker)
```

Despliegue (un solo proyecto en Cloudflare):

```powershell
npm run db:migrate:remote          # la primera vez y cuando haya migraciones nuevas
npm run deploy                     # exporta web/ y sube el Worker con los archivos
```

Pruebas:

```powershell
npm test                           # reglas de la sala y SQL del dinero (vitest, Node 22 o más)
npm run typecheck
npm run smoke                      # flujo completo con su propio backend y base temporal (~2 min)
```

## Piezas

| Archivo | Qué hace |
|---|---|
| `src/room-logic.ts` | Reglas de la cola y los turnos (funciones puras, probadas en `test/`) |
| `src/store.ts` | SQL de la sala y del dinero |
| `src/room.ts` | Durable Object: fila de operaciones, WebSockets de navegadores y agente, alarmas |
| `src/player.ts`, `src/admin.ts` | Rutas del jugador y del admin |
| `src/http.ts` | Permisos, lectura del cuerpo y errores |
| `src/auth.ts` | Google OAuth + PKCE, sesiones (cookie), login de desarrollo solo en localhost |
| `src/index.ts` | Rutas `/api/*` y controles de acceso |
| `src/turn.ts` | Credenciales TURN de Cloudflare Realtime (STUN si no hay claves) |
| `migrations/` | Esquema de D1 |

Los mensajes de WebSocket están documentados al inicio de `src/room.ts` y las rutas en
`../web/API.md`.
