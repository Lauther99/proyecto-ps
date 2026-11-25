"use client";
// Prueba de conexión: pide /api/health varias veces. Mide el camino hasta el servicio, no la demora
// total del juego. El último resultado vale media hora y se guarda en este navegador.
import { useSyncExternalStore } from "react";
import { request } from "./api";
import { networkQuality } from "./stream-stats";

export type Calidad = "buena" | "regular" | "mala";
export type Medicion = { ping: number; jitter: number; fallos: number; calidad: Calidad; hora: number };

const CLAVE = "wlg-conexion";
const VALIDEZ_MS = 30 * 60_000;
const INTENTOS = 20;
const LIMITE_MS = 2000;

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

async function unPing(): Promise<number | null> {
  const inicio = performance.now();
  try {
    const limite = new Promise<never>((_, no) => setTimeout(() => no(new Error("tarde")), LIMITE_MS));
    await Promise.race([request(`/api/health?t=${inicio}`), limite]);
    return performance.now() - inicio;
  } catch {
    return null;
  }
}

/** Devuelve null si se canceló; lanza error si el servicio no responde nunca. */
export async function medir(cancelado: () => boolean): Promise<Medicion | null> {
  await unPing(); // el primero abre la conexión y no cuenta
  const tiempos: number[] = [];
  let fallos = 0;
  for (let i = 0; i < INTENTOS && !cancelado(); i++) {
    const t = await unPing();
    if (t === null) fallos++;
    else tiempos.push(t);
    if (fallos >= 5 && !tiempos.length) break; // sin servicio: no hacemos esperar 40 s
  }
  if (cancelado()) return null;
  if (!tiempos.length) throw new Error("Sin respuesta");
  const ping = Math.round([...tiempos].sort((a, b) => a - b)[Math.floor(tiempos.length / 2)]);
  const saltos = tiempos.slice(1).map((t, i) => Math.abs(t - tiempos[i]));
  const jitter = Math.round(saltos.length ? saltos.reduce((a, b) => a + b, 0) / saltos.length : 0);
  const porcentaje = Math.round((fallos / (fallos + tiempos.length)) * 100);
  let calidad = networkQuality(ping, porcentaje).toLowerCase() as Calidad;
  if (jitter > 40) calidad = "mala";
  else if (jitter > 20 && calidad === "buena") calidad = "regular";
  const m = { ping, jitter, fallos: porcentaje, calidad, hora: Date.now() };
  guardarMedicion(m);
  return m;
}
