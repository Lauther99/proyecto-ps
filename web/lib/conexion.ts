"use client";
// Prueba de conexión: manda paquetes por el relé TURN (el mismo del juego) y los recibe de vuelta en este
// navegador. No usa la página web, que Cloudflare puede atender desde otro país. No mide el tramo hasta
// la consola ni la demora del video. Al final mide la velocidad de bajada (esa sí, por la página). El último resultado vale media hora y se guarda en este navegador.
import { useSyncExternalStore } from "react";
import { DEMO, fetchTestIceServers } from "./api";
import { localCandidateInUse, networkName, networkQuality, relayProtocolOf, type RelayProtocol } from "./stream-stats";

export type Calidad = "buena" | "regular" | "mala";
export type Medicion = { ping: number; jitter: number; fallos: number; corte: number; velocidad: number | null; red: string | null; ruta: RelayProtocol | null; calidad: Calidad; hora: number };

const CLAVE = "wlg-conexion-ruta";
const VALIDEZ_MS = 30 * 60_000;
const INTENTOS = 300; // 15 s
const CADA_MS = 50;
const ESPERA_FINAL_MS = 1000; // para los últimos paquetes en camino
const VELOCIDAD_MS = 5000;
const ARRANQUE_MS = 1000; // la descarga empieza lenta: ese tramo no cuenta
const CORTE_REGULAR_MS = 200;
const CORTE_MALO_MS = 1000;
// El video pide unos 10 Mbps. La descarga viene de más lejos que el relé y puede dar de menos.
const MBPS_MINIMO = 10;
const MBPS_COMODO = 15;
const CONEXION_MS = 10_000;
const CASA_MS = 20; // ida y vuelta entre la consola y el relé (medido 2026-11-24): se suma al calificar

let actual: Medicion | null = null;
let leido = false;
const oyentes = new Set<() => void>();

function leer(): Medicion | null {
  if (!leido) {
    leido = true;
    try {
      const m = JSON.parse(localStorage.getItem(CLAVE) ?? "null") as Medicion | null;
      if (m && typeof m.ping === "number" && ["buena", "regular", "mala"].includes(m.calidad)) actual = m;
    } catch {}
  }
  if (actual && Date.now() - actual.hora > VALIDEZ_MS) actual = null;
  return actual;
}

export function guardarMedicion(m: Medicion | null) {
  leido = true;
  actual = m;
  try {
    if (m) localStorage.setItem(CLAVE, JSON.stringify(m));
    else localStorage.removeItem(CLAVE);
  } catch {}
  oyentes.forEach((f) => f());
}

const suscribir = (f: () => void) => {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
};
export const useMedicion = () => useSyncExternalStore(suscribir, leer, () => null);

/** En una pestaña oculta el navegador frena los relojes y la medición no vale. */
export class PestanaOculta extends Error {}

const pausa = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Devuelve null si se canceló; lanza error si no se pudo conectar por el relé. */
export async function medir(cancelado: () => boolean): Promise<Medicion | null> {
  const iceServers = (await fetchTestIceServers()) as RTCIceServer[];
  if (cancelado()) return null;
  const conTurn = iceServers.some((s) => [s.urls].flat().some((u) => u.startsWith("turn")));
  // Sin relé mediríamos este mismo equipo y saldría casi 0: solo se acepta en la demo.
  if (!conTurn && !DEMO) throw new Error("Sin relé");
  const config: RTCConfiguration = { iceServers, iceTransportPolicy: conTurn ? "relay" : "all" };
  let oculta = document.hidden;
  const vigilar = () => { oculta ||= document.hidden; };
  document.addEventListener("visibilitychange", vigilar);
  const a = new RTCPeerConnection(config);
  const b = new RTCPeerConnection(config);
  try {
    a.onicecandidate = ({ candidate }) => candidate && void b.addIceCandidate(candidate).catch(() => undefined);
    b.onicecandidate = ({ candidate }) => candidate && void a.addIceCandidate(candidate).catch(() => undefined);
    b.ondatachannel = ({ channel }) => {
      channel.onmessage = (e) => {
        if (channel.readyState === "open") channel.send(e.data);
      };
    };
    // Sin orden ni reenvíos, como los controles: un paquete perdido cuenta como perdido.
    const canal = a.createDataChannel("prueba", { ordered: false, maxRetransmits: 0 });
    const abierto = new Promise<void>((r) => {
      canal.onopen = () => r();
    });
    await a.setLocalDescription();
    await b.setRemoteDescription(a.localDescription!);
    await b.setLocalDescription();
    await a.setRemoteDescription(b.localDescription!);
    await Promise.race([abierto, pausa(CONEXION_MS)]);
    if (cancelado()) return null;
    if (canal.readyState !== "open") throw new Error("Sin respuesta");

    const enviados: number[] = [];
    const inicio = performance.now();
    const tiempos: (number | undefined)[] = new Array(INTENTOS).fill(undefined);
    canal.onmessage = (e) => {
      const i = Number(e.data);
      // El eco recorre dos veces la red del jugador: la mitad es una ida y vuelta al relé.
      if (enviados[i] !== undefined) tiempos[i] ??= (performance.now() - enviados[i]) / 2;
    };
    for (let i = 0; i < INTENTOS; i++) {
      if (cancelado()) return null;
      if (oculta) throw new PestanaOculta();
      if (canal.readyState !== "open") throw new Error("Se cortó");
      enviados[i] = performance.now();
      canal.send(String(i));
      await pausa(Math.max(0, inicio + (i + 1) * CADA_MS - performance.now())); // sin acumular atrasos
    }
    await pausa(ESPERA_FINAL_MS);
    if (cancelado()) return null;
    // UDP es lo normal. TCP o TLS: la red bloquea UDP y el juego irá por un camino más lento.
    const ruta = relayProtocolOf(await localCandidateInUse(a).catch(() => undefined));
    const velocidad = await medirVelocidad();
    if (cancelado()) return null;
    if (oculta) throw new PestanaOculta();
    return calificar(tiempos, velocidad, ruta);
  } finally {
    document.removeEventListener("visibilitychange", vigilar);
    a.close();
    b.close();
  }
}

/** Mbps de bajada, o null si no se pudo medir (no impide el resto de la prueba). */
async function medirVelocidad(): Promise<number | null> {
  if (DEMO) return null;
  const corte = new AbortController();
  const limite = setTimeout(() => corte.abort(), VELOCIDAD_MS + 3000);
  try {
    const res = await fetch("/api/speed", { credentials: "same-origin", cache: "no-store", signal: corte.signal });
    if (!res.ok || !res.body) return null;
    const lector = res.body.getReader();
    const inicio = performance.now();
    let total = 0;
    let base: { t: number; bytes: number } | null = null;
    let ahora = inicio;
    while (ahora - inicio < VELOCIDAD_MS) {
      const { done, value } = await lector.read();
      ahora = performance.now();
      if (done) break;
      total += value.byteLength;
      if (!base && ahora - inicio >= ARRANQUE_MS) base = { t: ahora, bytes: total };
    }
    // En redes rápidas termina casi en el arranque: ahí vale el promedio completo.
    const desde = base && ahora - base.t > 500 ? base : { t: inicio, bytes: 0 };
    return Math.round((((total - desde.bytes) * 8) / (ahora - desde.t) / 1000) * 10) / 10;
  } catch {
    return null;
  } finally {
    clearTimeout(limite);
    corte.abort();
  }
}

// La pausa más larga: un paquete retenido (llegó tarde) o una racha de paquetes perdidos.
function peorCorte(todos: (number | undefined)[], ping: number): number {
  let peor = 0;
  let racha = 0;
  for (const t of todos) {
    racha = t === undefined ? racha + 1 : 0;
    // 't' es medio recorrido, pero una pausa retiene el paquete una sola vez.
    peor = Math.max(peor, t === undefined ? (racha > 1 ? racha * CADA_MS : 0) : (t - ping) * 2);
  }
  return Math.round(peor);
}

function calificar(todos: (number | undefined)[], velocidad: number | null, ruta: RelayProtocol | null): Medicion {
  const tiempos = todos.filter((t) => t !== undefined);
  if (!tiempos.length) throw new Error("Sin respuesta");
  const ping = Math.round([...tiempos].sort((x, y) => x - y)[Math.floor(tiempos.length / 2)]);
  const saltos = tiempos.slice(1).map((t, i) => Math.abs(t - tiempos[i]));
  const jitter = Math.round(saltos.length ? saltos.reduce((x, y) => x + y, 0) / saltos.length : 0);
  // El eco cruza la red del jugador el doble de veces: la raíz da la pérdida de una ida y vuelta.
  const porcentaje = Math.round((1 - Math.sqrt(tiempos.length / INTENTOS)) * 1000) / 10;
  let calidad = networkQuality(ping + CASA_MS, porcentaje).toLowerCase() as Calidad;
  const corte = peorCorte(todos, ping);
  const lenta = velocidad ?? Infinity;
  if (jitter > 40 || corte > CORTE_MALO_MS || lenta < MBPS_MINIMO) calidad = "mala";
  else if ((jitter > 20 || corte > CORTE_REGULAR_MS || lenta < MBPS_COMODO || ruta === "TCP" || ruta === "TLS") && calidad === "buena") calidad = "regular";
  const m = { ping, jitter, fallos: porcentaje, corte, velocidad, red: networkName(), ruta, calidad, hora: Date.now() };
  guardarMedicion(m);
  return m;
}
