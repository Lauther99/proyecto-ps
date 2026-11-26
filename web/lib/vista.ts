"use client";
// Traduce sesión + sala a lo que pintan las pantallas (estado del usuario y de la consola).
import { useAhora, useSistema } from "./sistema";

export type EstadoUsuario = "visitante" | "conSaldo" | "sinSaldo" | "enCola" | "turnoOfrecido" | "turnoVencido" | "jugando" | "reconectando" | "interrumpida" | "bloqueado";
export type EstadoSala = "ocupada" | "libre" | "apagada" | "mantenimiento" | "cambio";

const SALA_BASE = { id: "", name: "Sala 1", console: "PS4", game: "" };

export function useVista() {
  const sistema = useSistema();
  const ahora = useAhora();
  const { sala, sesion, sitio, precio, conectada } = sistema;
  const yo = sesion.datos?.user ?? null;
  const info = sitio.datos?.rooms[0] ?? SALA_BASE;
  const saldo = yo?.balance ?? { available: 0, reserved: 0 };

  const conTurno = !!yo && sala?.current?.userId === yo.id;
  const ofrecido = !!yo && sala?.offer?.userId === yo.id;
  const lista = sala?.queue ?? [];

  let usuario: EstadoUsuario = "visitante";
  if (yo) {
    if (yo.status === "blocked") usuario = "bloqueado";
    else if (conTurno) usuario = conectada ? "jugando" : "reconectando";
    else if (ofrecido) usuario = "turnoOfrecido";
    else if (lista.some((p) => p.userId === yo.id)) usuario = "enCola";
    else if (yo.notice?.kind === "interrupted") usuario = "interrumpida";
    else if (yo.notice?.kind === "expired") usuario = "turnoVencido";
    else usuario = saldo.available < precio.blockCredits ? "sinSaldo" : "conSaldo";
  }

  let consola: EstadoSala = "libre";
  if (!sala || !sala.agentOnline || sala.consoleOff) consola = "apagada";
  else if (sala.current) consola = "ocupada";
  else if (sala.paused) consola = "mantenimiento";
  else if (sala.offer) consola = "cambio";

  // Con el admin jugando (sin límite) o la cola en pausa no se puede estimar la espera.
  const sinLimite = !!sala?.current && sala.current.endsAt === null;
  const detenida = consola === "apagada" || consola === "mantenimiento" || !!sala?.paused;
  const restanteMs = sala?.current?.endsAt ? Math.max(0, sala.current.endsAt - (sala.outage?.since ?? ahora)) : 0;
  const base = sala?.current ? Math.ceil(restanteMs / 60_000) : (sala?.offer?.minutes ?? 0);
  const cola = lista.map((p, i) => ({ ...p, yo: p.userId === yo?.id, en: lista.slice(0, i).reduce((t, x) => t + x.minutes, base) }));

  return {
    ...sistema, ahora, yo, info, saldo, usuario, consola, conTurno, detenida, sinLimite, restanteMs, cola,
    sinEstimar: detenida || sinLimite,
    salaUrl: `/sala?id=${encodeURIComponent(info.id)}`,
    esperaNueva: lista.reduce((t, p) => t + p.minutes, base),
    miPuesto: cola.findIndex((p) => p.yo),
    fallaMs: sala?.outage ? Math.max(0, sala.outage.until - ahora) : null,
    ofertaMs: ofrecido && sala?.offer ? Math.max(0, sala.offer.expiresAt - ahora) : 0,
    ofertaMinutos: sala?.offer?.minutes ?? precio.blockMinutes,
    conCuenta: !!yo,
  };
}
