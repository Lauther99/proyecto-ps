"use client";
import { useState } from "react";
import { T } from "@/data/textos";
import { declineTurn, dismissNotice, leaveQueue } from "@/lib/api";
import { creditosDe, espera, reloj } from "@/lib/config";
import { useAccion } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";
import { useVista, type EstadoSala } from "@/lib/vista";
import { Icono } from "./icono";
import { BotonAcceso, ErrorAccion, useAceptar } from "./marco";
import { Boton, Corazon, Enlace, Estado, Modal } from "./ui";

const TONO = { ocupada: "neutro", libre: "bien", apagada: "apagado", mantenimiento: "pausa", cambio: "neutro" } as const;
export const EstadoConsola = ({ consola }: { consola: EstadoSala }) => <Estado tono={TONO[consola]}>{T.sala.estados[consola]}</Estado>;

const RESPALDO_CANAL = process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;

/** Canal de YouTube si hay directo para mostrar, o null. */
export function useDirecto(): string | null {
  const { sala, sitio, enLinea } = useSistema();
  const canal = sitio.datos?.config.youtubeChannelId || RESPALDO_CANAL;
  return enLinea && sala?.agentOnline && sala.youtube && canal ? canal : null;
}

export function Directo({ className = "" }: { className?: string }) {
  const { consola } = useVista();
  const canal = useDirecto();
  const apagada = consola === "apagada";
  if (!canal || apagada)
    return (
      <div className={`flex aspect-video flex-col items-center justify-center gap-1 bg-raised p-4 text-center md:p-6 ${className}`}>
        <p className="t-title">{apagada ? T.sala.mensajes.apagada[0] : T.sala.caido}</p>
        <p className="text-muted">{apagada ? T.sala.mensajes.apagada[1] : T.sala.caidoTexto}</p>
      </div>
    );
  return (
    <div className={`overflow-hidden bg-raised ${className}`}>
      {canal === "demo" ? <div className="flex aspect-video items-center justify-center t-data text-muted">{T.sala.directo}</div> : (
        <iframe className="aspect-video w-full" title={T.sala.directo} src={`https://www.youtube.com/embed/live_stream?channel=${encodeURIComponent(canal)}&autoplay=1&mute=1`} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen />
      )}
      <p className="flex flex-wrap items-center gap-x-3 px-4 py-2 t-label text-muted"><span className="inline-flex items-center gap-2 text-ink"><Icono nombre="vivo" t={16} className="text-accent" />{T.sala.vivo}</span>{T.sala.retraso}</p>
    </div>
  );
}

/** Quién juega y cuánto le queda, o por qué nadie juega. */
export function Turno({ grande = false, encender = false }: { grande?: boolean; encender?: boolean }) {
  const { consola, conTurno, sala, restanteMs, sinLimite, precio, usuario } = useVista();
  const ocupada = consola === "ocupada";
  const [tit, tex] = usuario === "turnoOfrecido" ? T.sala.miTurno : consola === "libre" && usuario === "bloqueado" ? [T.sala.mensajes.libre[0], ""] : T.sala.mensajes[consola];
  const restante = Math.ceil(restanteMs / 60_000);
  return (
    <div className={`flex gap-6 ${grande ? "flex-col" : "items-center justify-between"}`}>
      <div className="flex min-w-0 flex-col gap-2">
        {!grande && <div><EstadoConsola consola={consola} /></div>}
        {ocupada
          ? <p className="text-muted">{T.sala.juega} <strong className="font-semibold break-words text-ink">{conTurno ? T.sala.tu : sala?.current?.name}</strong></p>
          : <><p className="t-title">{tit}</p><p className="text-muted">{tex}</p></>}
        {ocupada && !grande && <p className="t-score">{sinLimite ? T.sala.sinLimite : reloj(restanteMs)}</p>}
      </div>
      <Corazon minutos={ocupada && !sinLimite ? restante : consola === "libre" || sinLimite ? precio.blockMinutes : 0} bloque={precio.blockMinutes} decorativo={!ocupada || sinLimite} encender={encender} className={grande ? "w-44 sm:w-52" : "w-20 shrink-0 min-[360px]:w-28"} />
    </div>
  );
}

export function Cifras() {
  const { consola, conTurno, cola, esperaNueva, sinEstimar, sinLimite, restanteMs } = useVista();
  const datos = [
    ...(consola === "ocupada" ? [[conTurno ? T.sala.teQueda : T.sala.queda, sinLimite ? T.sala.sinLimite : reloj(restanteMs)]] : []),
    [T.sala.enCola, String(cola.length)],
    [T.sala.espera, sinEstimar ? T.sala.pausa : espera(esperaNueva)],
  ];
  return (
    <dl className="flex flex-wrap gap-x-8 gap-y-4">
      {datos.map(([k, v]) => <div key={k}><dt className="t-label text-muted">{k}</dt><dd className="font-mono text-xl leading-8 font-bold whitespace-nowrap">{v}</dd></div>)}
    </dl>
  );
}

export function Cola() {
  const { cola, sinEstimar } = useVista();
  return (
    <section aria-labelledby="cola" className="flex flex-col gap-3">
      <h2 id="cola" className="t-title">{T.sala.cola}</h2>
      {cola.length === 0 ? <p className="rounded-md bg-surface p-4 text-muted">{T.sala.colaVacia}</p> : (
        <ol className="overflow-hidden rounded-md bg-surface">
          {cola.map((p, i) => (
            <li key={p.userId} className={`grid min-h-13 grid-cols-[28px_1fr_auto] items-center gap-2 px-4 ${p.yo ? "bg-accent text-ground" : ""}`}>
              <span className={`t-data ${p.yo ? "" : "text-muted"}`}>{i + 1}</span>
              <span className="min-w-0 truncate font-semibold">{p.yo ? T.sala.tu : p.name}</span>
              <span className={`t-data ${p.yo ? "" : "text-muted"}`}>{sinEstimar ? T.sala.pausa : p.en === 0 ? T.sala.sigue : T.sala.en(espera(p.en))}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Lo que cada persona puede hacer ahora en la sala. */
export function Accion() {
  const { usuario: u, consola, detenida, saldo, cola, miPuesto, sinEstimar, ofertaMs, ofertaMinutos, precio, yo, refrescar } = useVista();
  const [salir, setSalir] = useState(false);
  const { ocupado, error, ejecutar } = useAccion();
  const aceptacion = useAceptar();

  if (u === "turnoOfrecido") {
    const [tit, tex] = T.accion.turnoOfrecido(creditosDe(precio, ofertaMinutos));
    return (
      <section className="sobre-acento flex flex-col gap-4 rounded-md bg-accent p-6 text-ground">
        <div className="flex items-start justify-between gap-4"><h2 role="alert" className="t-heading">{tit}</h2><span role="timer" className="t-score">{reloj(ofertaMs)}</span></div>
        <p>{tex}</p>
        <Boton variante="inverso" disabled={ocupado || aceptacion.ocupado} onClick={() => void aceptacion.aceptar()}>{T.accion.aceptar}</Boton>
        <Boton variante="inversoSuave" disabled={ocupado || aceptacion.ocupado} onClick={() => void ejecutar(async () => { await declineTurn(); await refrescar(); })}>{T.accion.pasar}</Boton>
        {(aceptacion.error ?? error) && <p role="alert" className="t-label">{aceptacion.error ?? error}</p>}
      </section>
    );
  }

  if (u === "enCola")
    return (
      <section className="flex flex-col gap-4 rounded-md bg-surface p-6">
        <h2 className="t-title">{T.accion.posicion(miPuesto + 1)}</h2>
        <p className="t-score">{sinEstimar ? T.sala.pausa : espera(cola[miPuesto].en)}</p>
        <p className="text-muted">{T.accion.reservados(saldo.reserved)}</p>
        <Boton variante="secundario" onClick={() => setSalir(true)}>{T.accion.salir}</Boton>
        <Modal abierto={salir} alCerrar={() => setSalir(false)} titulo={T.accion.salirTitulo}>
          <p className="text-muted">{T.accion.salirTexto(saldo.reserved)}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Boton variante="secundario" onClick={() => setSalir(false)}>{T.accion.quedarme}</Boton>
            <Boton variante="peligro" disabled={ocupado} onClick={() => void ejecutar(async () => { await leaveQueue(); await refrescar(); setSalir(false); })}>{T.accion.salir}</Boton>
          </div>
          <ErrorAccion>{error}</ErrorAccion>
        </Modal>
      </section>
    );

  const aviso = yo?.notice?.kind === "interrupted" ? yo.notice : null;
  const libre = consola === "libre" && cola.length === 0 && u === "conSaldo";
  const pausada = u === "conSaldo" && detenida && consola !== "apagada";
  const [tit, tex] = libre ? T.accion.libre
    : pausada ? T.accion.pausada
    : u === "sinSaldo" ? T.accion.sinSaldo(precio.blockCredits - saldo.available, precio.blockMinutes)
    : u === "interrumpida" ? T.accion.interrumpida(aviso?.refundedCredits ?? 0, aviso?.unplayedMinutes ?? 0)
    : T.accion[u];
  const cerrar = <Boton variante="secundario" disabled={ocupado} onClick={() => void ejecutar(async () => { await dismissNotice(); await refrescar(); })}>{T.accion.entendido}</Boton>;
  return (
    <section className="flex flex-col gap-4 rounded-md bg-surface p-6">
      <div className="flex flex-col gap-1"><h2 className="t-title">{tit}</h2><p className="text-muted">{tex}</p></div>
      {u === "visitante" && <BotonAcceso />}
      {u === "conSaldo" && (detenida ? <Boton disabled>{T.accion.noDisponible}</Boton> : <Enlace href="/comprar">{libre ? T.accion.jugarAhora : T.accion.hacerCola}</Enlace>)}
      {u === "sinSaldo" && <Enlace href="/recargar">{T.accion.recargar}</Enlace>}
      {u === "turnoVencido" && <>{detenida ? <Boton disabled>{T.accion.noDisponible}</Boton> : <Enlace href="/comprar">{T.accion.volverCola}</Enlace>}{cerrar}</>}
      {u === "jugando" && <Enlace href="/jugar">{T.accion.volverJuego}</Enlace>}
      {u === "reconectando" && <Enlace href="/jugar">{T.accion.reconectar}</Enlace>}
      {u === "interrumpida" && <><Enlace href="/cuenta" variante="secundario">{T.accion.movimientos}</Enlace>{!detenida && <Enlace href="/comprar">{T.accion.volverCola}</Enlace>}{cerrar}</>}
      {u === "bloqueado" && <Enlace href="/ayuda" variante="secundario">{T.accion.ayuda}</Enlace>}
      <ErrorAccion>{error}</ErrorAccion>
    </section>
  );
}
