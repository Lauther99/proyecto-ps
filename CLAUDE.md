# proyecto-ps: jugar la consola PlayStation desde el navegador

Sistema propio para jugar la PS4 de la casa (y pronto una PS5) desde un navegador: un jugador a la
vez por turnos, los demás miran el directo de YouTube. Para el dueño (admin), amigos (sobre todo en
Perú) y algunos testers de otros países. El Remote Play está vinculado a una cuenta PSN
**secundaria sin métodos de pago**.

Dominio elegido: `ps5.lautherplays.com` (todavía no desplegado).

## Estado actual (2026-11-22)

**Funciona en local, probado de punta a punta:**

- Agente C++ (`agent/`): descubre la PS4, se vincula, recibe video H.264 60 fps + audio Opus y los
  reenvía por WebRTC sin recodificar. Recibe controles (mando y teclado) por canal de datos.
  Reconexión automática, autodescubrimiento por ID de consola, sesión bajo demanda.
- Transmisión a YouTube (`serve --youtube`): probada grabando a archivo (NVENC, A/V sincronizados).
  Falta probarla en vivo: la cuenta de YouTube se estaba habilitando (espera de 24 h).
- Backend (`worker/`): login con Google (credenciales creadas, probado en localhost), aprobación de
  usuarios, cola y turnos, panel admin, puente de señalización con el agente. 15 pruebas unitarias
  + prueba de humo de 23 comprobaciones.
- Frontend (`web/`): sala, aviso de turno, reproductor del jugador, panel admin, `/admin`.
- Modo sala del agente (`serve --room`): con la PS4 encendida, el video llega a la sala a través del
  backend local.
- Red: laptop y PS4 por cable al router Movistar. 0 pérdidas de red en una sesión de ~5 min (en el
  router Nexxt anterior había ~3 por minuto).

**No hecho todavía:** desplegar en Cloudflare (ver "Despliegue pendiente"), probar desde una red
externa, clave de YouTube en vivo, soporte de PS5.

## Arquitectura

```
                      Cloudflare (un solo Worker)
        ┌───────────────────────────────────────────────────┐
        │ archivos de web/out  (/, /admin)                  │
        │ /api/*  login, usuarios, sala (Durable Object)    │
        │ D1 (usuarios, sesiones, historial)   TURN (relé)  │
        └───────▲──────────────────▲───────────────▲────────┘
                │ WebSocket saliente│ video/controles│
                │ (token)           │ vía TURN       │ WebSocket + WebRTC
   ┌────────────┴───────┐           │        ┌──────┴────────────┐
   │ Laptop en la casa  ├───────────┘        │ Navegador jugador │
   │ agente C++  ── LAN ── PS4               └───────────────────┘
   │ (detrás de CGNAT)  │──RTMPS──> YouTube Live ──> espectadores
   └────────────────────┘
```

- **Nada entra a la casa.** Movistar usa CGNAT: nadie de afuera puede iniciar conexiones hacia la
  laptop. El agente **sale** hacia Cloudflare (WebSocket) y el video va por el TURN de Cloudflare.
  No hay puertos abiertos, ni ngrok, ni IP pública.
- **Un solo despliegue.** Next exporta archivos estáticos (`web/out`) y el mismo Worker los sirve
  junto con `/api`. No hay servidor de Next en producción.
- **Un jugador por turno.** Solo el jugador recibe WebRTC (baja latencia). Los espectadores ven
  YouTube (retraso de segundos, gratis, sin límite de espectadores).

### Carpetas

| Carpeta | Qué es | Tecnología |
|---|---|---|
| `agent/` | Agente en la casa, junto a la PS4 | C++20, chiaki-ng (submódulo `third_party/chiaki-ng`), libdatachannel 0.19.5, nlohmann-json, ffmpeg (proceso aparte) |
| `worker/` | Backend: login, sala, señalización, sirve el frontend | Cloudflare Worker + Durable Object `Room` + D1, TypeScript |
| `web/` | Interfaz (corre entera en el navegador) | Next.js 16, React 19, Tailwind 4 |

### Piezas clave

- `agent/src/serve.cpp`: sesión con la PS4, WebRTC por navegador, controles, modo sala, YouTube.
- `agent/src/youtube.cpp`: ffmpeg en proceso aparte; el agente pone las marcas de tiempo (video en
  FLV sin recodificar, audio PCM continuo con relleno de silencio).
- `worker/src/room-logic.ts`: reglas de cola y turnos (funciones puras, probadas).
- `worker/src/room.ts`: Durable Object. Protocolo de mensajes documentado al inicio del archivo.
- `worker/src/index.ts`: rutas `/api/*` (documentadas al inicio del archivo).
- `web/components/ps4-player.tsx`: reproductor WebRTC; recibe un adaptador de señalización
  (`web/lib/signaling.ts`: local o sala).

## Decisiones tomadas (y por qué)

| Decisión | Por qué |
|---|---|
| C++ con chiaki-ng para el agente | Reenviar el H.264 de la PS4 sin recodificar (mínima latencia). El usuario quiere aprender C++. |
| Agente en Windows como carpeta portable, **no Docker** | Docker en Windows rompe el descubrimiento UDP en la LAN y WebRTC (NAT de Docker Desktop). Docker solo si el host pasa a Linux. |
| Cloudflare (Worker + Durable Object + D1 + TURN) | El Durable Object mantiene la sala con estado y WebSockets abiertos; las "functions" tradicionales no. Todo saliente, sirve con CGNAT. |
| Un solo Worker sirve frontend + API | Un despliegue. Se quitó `cacheComponents` de Next porque exige runtime de Node y Workers no lo es. |
| Login con Google propio, **no Cloudflare Access** | Access gratis limita a 50 usuarios; Google OAuth no cobra por usuario. Usuarios nuevos quedan "pendientes" hasta que el admin los aprueba. |
| D1 + Durable Objects, sin base externa (no Neon, Turso ni Firebase) | Costo 0 a esta escala, misma plataforma, sin otra cuenta ni latencia extra. El usuario tiene Workers Paid (5 USD/mes): no hay cortes por límites diarios. |
| Espectadores por YouTube, no por SFU | Gratis e ilimitado; los espectadores aceptan segundos de retraso. Se recodifica aparte con NVENC para no forzar fotogramas completos en el stream del jugador. |
| Turnos de 15 min (configurable 5 a 120), 60 s para aceptar | Definido con el usuario. El admin puede tomar el control, saltar turnos y pausar. |
| Botón PS filtrado en el agente | Nadie sale del juego ni cambia de perfil; solo pasa si el jugador es admin. |
| Sesión con la consola bajo demanda | Sin navegadores (ni YouTube) el agente no abre sesión y el mando físico queda libre. |
| Capturadora HDMI: mejora futura | Daría 1080p con la PS4 (Remote Play de PS4 llega a 720p). Con PS5, Remote Play ya da 1080p 60 fps. Remote Play no pasa de 1080p 60 fps en ninguna consola (verificado en el código de chiaki-ng). |

## Cómo correrlo en local

Requisitos (ya instalados en la laptop de desarrollo): VS 2022 con clang-cl, vcpkg del VS, CMake,
Python (siempre en venv), Node 26, ffmpeg (winget). El proyecto vive en `C:\dev\proyecto-ps`: **la
ruta no puede tener espacios** (rompió pkg-config cuando estaba en "Lauther V").

1. **Compilar el agente** (la primera vez tarda; recompila curl en cada corrida):
   ```powershell
   cd C:\dev\proyecto-ps\agent; .\build.ps1
   ```
2. **Backend** (puerto 8787). La primera vez: `npm install`, copiar `.dev.vars.example` a
   `.dev.vars` y `npm run db:migrate:local`.
   ```powershell
   cd C:\dev\proyecto-ps\worker; npm run dev
   ```
3. **Frontend** (puerto 3000, reenvía `/api` al backend):
   ```powershell
   cd C:\dev\proyecto-ps\web; npm run dev
   ```
4. **Agente** (con la PS4 encendida o en reposo):
   ```powershell
   cd C:\dev\proyecto-ps\agent; .\build\release\ps4-agent.exe serve --room
   ```
   Otros modos: `serve` (solo la página local `/local-player`), `serve --youtube`, `discover --all`,
   `register <codigo>`, `stream <seg>`. Cerrar siempre con **Ctrl+C**: si se mata a la fuerza, la
   consola dice "Remote Play ya en uso" unos segundos.
5. Entrar a `http://localhost:3000` con Google, o con el login de desarrollo (solo localhost, con
   `DEV_LOGIN=true`).

Ver la app tal como quedará desplegada (un Worker sirviendo todo): `npm run preview` en `worker/`.

Pruebas: `npm test`, `npm run typecheck` y `node scripts/smoke-local.mjs` (con el backend corriendo)
en `worker/`; `npx tsc --noEmit` y `npx eslint` en `web/`.

## Configuración y secretos

Ningún archivo de esta tabla se sube a git (están en `.gitignore`), salvo los `.example`.

| Archivo | Contenido |
|---|---|
| `agent/.env` | `PSN_ACCOUNT_ID`, `PS4_HOST`, `ROOM_URL`, `AGENT_TOKEN`, `YOUTUBE_STREAM_KEY` (opcional) |
| `agent/registration.env` | Claves de vinculación con la consola. **Secreto: nunca mostrar `RP_KEY` ni `RP_REGIST_KEY`.** |
| `worker/.dev.vars` | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `AGENT_TOKEN`, `ADMIN_EMAILS`, `DEV_LOGIN`, `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` |

Red de la casa: router Movistar 192.168.1.1 (CGNAT), laptop 192.168.1.44 por cable, PS4
192.168.1.50 por cable (MAC C8:63:F1:14:28:44). El perfil de red de Windows debe ser **Privado**:
las reglas del firewall para `ps4-agent.exe` solo valen en redes privadas.

## Despliegue pendiente (en orden)

1. **Dominio en Cloudflare.** Confirmar que `lautherplays.com` usa los DNS de Cloudflare en la cuenta
   del usuario.
2. **Claves de TURN.** En el panel de Cloudflare: Realtime → TURN → crear una clave. Da
   `TURN_KEY_ID` y `TURN_KEY_API_TOKEN`. Probarlas en local poniéndolas en `worker/.dev.vars`.
3. **Base D1 real.**
   ```powershell
   cd C:\dev\proyecto-ps\worker; npx wrangler login
   npx wrangler d1 create ps4-room
   ```
   Reemplazar `database_id` en `worker/wrangler.jsonc` por el que devuelve, y aplicar el esquema:
   `npm run db:migrate:remote`.
4. **Configuración de producción en `worker/wrangler.jsonc`.**
   - `vars.APP_URL` = `https://ps5.lautherplays.com`
   - Dominio propio: `"routes": [{ "pattern": "ps5.lautherplays.com", "custom_domain": true }]`
   - `ADMIN_EMAILS` mejor como secreto (paso 5) para no subir el correo a git.
5. **Secretos** (cada uno pide el valor; nunca en el chat ni en git):
   ```powershell
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put AGENT_TOKEN          # token NUEVO, largo y aleatorio, no el de desarrollo
   npx wrangler secret put ADMIN_EMAILS
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```
   **No** definir `DEV_LOGIN` en producción (además, el código lo exige junto con `APP_URL` en
   localhost).
6. **YouTube en la sala (opcional para el primer despliegue).** El id del canal (`UC...`) se fija al
   compilar el frontend: `NEXT_PUBLIC_YOUTUBE_CHANNEL_ID` en `web/.env.production` (o como variable al
   correr el build).
7. **Desplegar:** `npm run deploy` en `worker/` (exporta `web/` y sube el Worker con los archivos).
8. **Agente apuntando a producción:** en `agent/.env`, `ROOM_URL=wss://ps5.lautherplays.com/api/agent/ws`
   y `AGENT_TOKEN` igual al secreto del paso 5. Correr `serve --room`.
9. **Google en producción:** el cliente OAuth ya tiene las direcciones de `ps5.lautherplays.com`.
   Mientras esté en modo prueba solo entran los "usuarios de prueba" (máx. 100). Para abrirlo hay que
   publicar la app; Google pide página de inicio y política de privacidad en el dominio.
10. **Prueba de fuego:** el celular con datos móviles (Wi-Fi apagado) entrando a la sala y jugando.

## Otros pendientes

- **PS5** (la trae el hermano del usuario): volver a vincular con código; `cmd_register` está fijado a
  `CHIAKI_TARGET_PS4_10` y hay que ajustarlo; pedir H.264 (los navegadores no reciben H.265 por WebRTC
  de forma confiable).
- Clave de YouTube en `agent/.env` y prueba en vivo.
- Reservas DHCP en el router Movistar para la PS4 y la laptop (el agente igual la encuentra por ID).
- Interruptor de admin para pausar la reconexión del agente.
- Empaquetar el agente como carpeta portable para moverlo a otra máquina (la i5).
- `build.ps1` recompila curl en cada corrida (la copia parchada se renueva al configurar).
- Licencia AGPL de chiaki-ng: el código del agente debe ser público si se ofrece por red (el usuario
  está de acuerdo con un repo público en GitHub).
- Términos de servicio de Sony para dejar jugar a otros: pendiente de revisar (el usuario lo pospuso).

## Cómo trabajar en este proyecto (para Claude)

- **Responder siempre en español**, también en resúmenes técnicos largos. El usuario dicta por voz:
  "PC4" o "BS" es PS4, "VCBKG" es vcpkg.
- No usar la raya larga (U+2014) en ningún texto.
- Mostrar la propuesta y preguntar antes de crear archivos o correr comandos con efectos. Commit solo
  cuando el usuario lo pide.
- Python siempre en entorno virtual (`python -m venv venv`), nunca pip global.
- Nunca mostrar secretos: claves de `registration.env`, tokens, secretos de Google, clave de YouTube,
  ni el correo del usuario en archivos que se suben.
- Cambios del sistema (firewall, perfil de red, drivers, Control Inteligente de Aplicaciones, router)
  los hace el usuario; Claude da los pasos.
- No dejar el agente corriendo si la consola está apagada: manda la señal de encendido y la
  prendería si estuviera en reposo.
- Al cerrar procesos propios, verificar con la lista de procesos que murieron (wrangler, node,
  workerd, ps4-agent); detener la tarea puede dejar hijos vivos ocupando puertos.
- C++/Windows: PowerShell 5.1 con `$ErrorActionPreference='Continue'` antes de comandos nativos;
  usar `(std::min)` por la macro de windows.h; `GIT_CEILING_DIRECTORIES` en `build.ps1` evita que el
  parche de curl de chiaki se salte; el binario nuevo no firmado lo bloqueaba Control Inteligente de
  Aplicaciones (ya desactivado).
- Agente: la PS4 manda SPS/PPS solo al inicio; se guardan y se anteponen a cada IDR. Responder PLI/FIR
  pidiendo IDR (como mucho cada 500 ms). Crear el canal de datos con `disableAutoNegotiation`, o la
  oferta sale antes de registrar los callbacks.
- Worker: **no exportar nada que no sea handler o clase** desde `worker/src/index.ts` (workerd no
  arranca). Cambios en `.dev.vars` requieren reiniciar `wrangler dev`.
- Next 16 de este repo tiene cambios: leer la guía en `web/node_modules/next/dist/docs/` antes de
  tocar configuración. En producción es exportación estática: no hay rewrites, cookies del servidor
  ni server actions. Las páginas `page.dev.tsx` solo existen en `next dev`.
