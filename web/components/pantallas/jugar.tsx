"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Icono, type NombreIcono } from "@/components/icono";
import { ErrorAccion, Pagina } from "@/components/marco";
import { Boton, Corazon, Enlace, Mensaje, Modal } from "@/components/ui";
import { T } from "@/data/textos";
import { endTurn, fetchIceServers, roomAction } from "@/lib/api";
import { reloj } from "@/lib/config";
import { mensaje, useAccion } from "@/lib/datos";
import type { Room } from "@/lib/room-client";
import { roomSignaling } from "@/lib/signaling";
import { networkQuality } from "@/lib/stream-stats";
import { usePlayer } from "@/lib/use-player";
import { useVista } from "@/lib/vista";

const t = T.jugar;
const REINTENTO_MS = 5000;
const CALIDAD_MS = 30_000;

function Dato({ icono, etiqueta, children, alerta }: { icono: NombreIcono; etiqueta: string; children: ReactNode; alerta?: boolean }) {
  return <span className={`inline-flex items-center gap-2 t-data whitespace-nowrap ${alerta ? "text-warn" : ""}`}><Icono nombre={alerta ? "alerta" : icono} t={20} /><span className="sr-only">{etiqueta}: </span>{children}</span>;
}

function Cubierta({ titulo, texto, children }: { titulo: string; texto: string; children?: ReactNode }) {
  return (
    <div role="alert" className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-ground/90 p-6 text-center">
      <h2 className="t-heading">{titulo}</h2><p className="max-w-[44ch] text-muted">{texto}</p>{children}
    </div>
  );
}

function usePantallaCompleta() {
  const ref = useRef<HTMLDivElement>(null);
  const [activa, setActiva] = useState(false);
  useEffect(() => {
    const alCambiar = () => setActiva(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", alCambiar);
    return () => document.removeEventListener("fullscreenchange", alCambiar);
  }, []);
  const alternar = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void ref.current?.requestFullscreen?.().catch(() => undefined);
  };
  return { ref, activa, alternar };
}

function Juego({ cliente, iceServers }: { cliente: Room; iceServers: RTCIceServer[] }) {
  const { usuario, sala, salaUrl, restanteMs, fallaMs, sinLimite, precio, refrescar } = useVista();
  const [signaling] = useState(() => roomSignaling(cliente));
  const { videoRef, status, inputSource, stats, diagnostics, drops, muted, setVolume, latencyMode, changeLatencyMode, onPlaying } = usePlayer(signaling, iceServers);
  const [terminar, setTerminar] = useState(false);
  const [visibles, setVisibles] = useState(true);
  const [verStats, setVerStats] = useState(false);
  const [vol, setVol] = useState(100);
  const [mandoVisto, setMandoVisto] = useState(false);
  const [mandoFuera, setMandoFuera] = useState(false);
  const { ocupado, error, ejecutar } = useAccion();
  const { ref, activa, alternar } = usePantallaCompleta();

  useEffect(() => {
    const entra = () => { setMandoVisto(true); setMandoFuera(false); };
    const sale = () => setMandoFuera(!(navigator.getGamepads?.() ?? []).some((p) => p?.connected));
    window.addEventListener("gamepadconnected", entra);
    window.addEventListener("gamepaddisconnected", sale);
    return () => { window.removeEventListener("gamepadconnected", entra); window.removeEventListener("gamepaddisconnected", sale); };
  }, []);

  // Ping y pérdida cada 30 s para el registro de la partida (pista para revisar reclamos).
  const ultimas = useRef(stats);
  useEffect(() => { ultimas.current = stats; }, [stats]);
  useEffect(() => {
    const id = setInterval(() => {
      const s = ultimas.current;
      if (s && s.rttMs !== null) cliente.send({ type: "quality", rtt: s.rttMs, loss: s.lossPercent, jitter: s.jitterMs, route: s.route });
    }, CALIDAD_MS);
    return () => clearInterval(id);
  }, [cliente]);

  // Escape abre "Terminar" (Tab y Enter son botones del juego). En pantalla completa, Escape sale de ella.
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.fullscreenElement || document.querySelector("dialog[open]")) return;
      e.preventDefault();
      setTerminar(true);
    };
    window.addEventListener("keydown", alPulsar);
    return () => window.removeEventListener("keydown", alPulsar);
  }, []);

  const minutosRestantes = Math.ceil(restanteMs / 60_000);
  const aviso = sinLimite ? null : restanteMs <= 60_000 ? "uno" : restanteMs <= 5 * 60_000 && restanteMs > 5 * 60_000 - 15_000 ? "cinco" : null;
  const conTeclado = inputSource === "teclado";
  const conMando = inputSource !== "ninguno" && !conTeclado && !mandoFuera;
  // Si se corta solo la sala pero el video sigue llegando, no se interrumpe la partida.
  const cortado = status === "desconectado" || (usuario === "reconectando" && status !== "reproduciendo");
  const textoControl = conMando ? t.conectado : conTeclado ? t.teclado : t.desconectado;
  const calidad = stats && stats.rttMs !== null ? networkQuality(stats.rttMs, stats.lossPercent) : null;
  const datos = stats && {
    ping: stats.rttMs === null ? "--" : `${stats.rttMs} ms`, jitter: `${stats.jitterMs} ms`, perdida: `${stats.lossPercent} %`,
    fps: String(stats.fpsShown), resolucion: `${stats.width}×${stats.height}`, tasa: `${stats.mbps} Mbps`,
    bufer: `${stats.bufferMs} ms`, ruta: stats.route ?? "--", cortes: String(drops),
  };
  const control = "pulsable grid size-11 shrink-0 place-items-center rounded-md hover:bg-raised aria-pressed:bg-accent-deep";
  // Un botón con foco reaccionaría a la barra espaciadora mientras se juega.
  const soltarFoco = (e: MouseEvent<HTMLElement>) => { if (e.target instanceof Element) e.target.closest<HTMLElement>("button, input")?.blur(); };
  const alTerminar = () => ejecutar(async () => {
    // Si manda el admin sin límite, suelta el control; si es un turno comprado, lo termina.
    if (sinLimite) await roomAction({ action: "release" });
    else await endTurn();
    await refrescar();
  });

  return (
    <div ref={ref} className="flex h-dvh flex-col bg-black pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)]">
      <h1 className="sr-only">{t.titulo}</h1>
      {visibles && (
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-x-4 px-3 sm:px-4 [@media(max-height:480px)]:min-h-11">
          <div className="flex items-center gap-3" role="timer" aria-label={sinLimite ? T.sala.sinLimite : `${t.queda} ${minutosRestantes} min`}>
            {!sinLimite && <Corazon minutos={minutosRestantes} bloque={precio.blockMinutes} className="w-9 [@media(max-height:480px)]:w-7" />}
            <span className="font-mono text-xl font-bold">{sinLimite ? T.sala.sinLimite : reloj(restanteMs)}</span>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <Dato icono="senal" etiqueta={t.ping} alerta={calidad === "Mala"}>{datos?.ping ?? "--"}</Dato>
            <span className="inline-flex max-sm:hidden"><Dato icono="ojo" etiqueta={t.calidad}>{datos ? `${stats?.height}p${calidad ? `, ${calidad}` : ""}` : "--"}</Dato></span>
            <Dato icono="mando" etiqueta={t.mando} alerta={!conMando && !conTeclado}><span className="max-sm:hidden">{textoControl}</span></Dato>
          </div>
        </header>
      )}

      <div className="relative flex min-h-0 flex-1 items-center justify-center" onDoubleClick={alternar}>
        <video ref={videoRef} autoPlay playsInline muted onPlaying={() => onPlaying()} className="h-full w-full bg-black object-contain" />

        {aviso && <p role="alert" className={`absolute top-3 left-1/2 z-[5] w-max max-w-[calc(100%-24px)] -translate-x-1/2 rounded-md px-4 py-2 text-center t-label ${aviso === "uno" ? "bg-warn text-ground" : "bg-ink text-ground"}`}>{t[aviso]}</p>}
        {mandoVisto && mandoFuera && <p role="alert" className="absolute bottom-3 left-1/2 z-[5] flex w-max max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 rounded-md border border-warn bg-ground px-4 py-2 t-label"><Icono nombre="alerta" t={20} className="shrink-0 text-warn" />{t.sinMando}</p>}
        {muted && vol > 0 && status === "reproduciendo" && <Boton variante="inverso" className="absolute top-16 left-1/2 z-[5] -translate-x-1/2" onClick={(e) => { setVolume(vol / 100); soltarFoco(e); }}><Icono nombre="volumen" t={20} />{t.sonido}</Boton>}
        {verStats && (datos ? (
          <dl className="pointer-events-none absolute right-3 bottom-3 z-[4] grid grid-cols-[auto_auto] gap-x-6 gap-y-1 rounded-md bg-ground/90 p-4 t-data">
            {(Object.keys(t.stats) as (keyof typeof t.stats)[]).map((k) => <div key={k} className="contents"><dt className="text-muted">{t.stats[k]}</dt><dd className="text-right">{datos[k]}</dd></div>)}
          </dl>
        ) : <div className="pointer-events-none absolute right-3 bottom-3 z-[11] rounded-md bg-ground/90 p-4 t-data">{diagnostics.map((l) => <p key={l}>{l}</p>)}</div>)}
        {!visibles && <button type="button" aria-label={t.mostrar} onClick={() => setVisibles(true)} className={`${control} absolute bottom-3 left-3 z-[12] bg-ground/80`}><Icono nombre="ojo" /></button>}
        {fallaMs !== null ? (
          <Cubierta titulo={t.fallaTitulo} texto={t.fallaTexto}><p role="timer" className="t-score">{reloj(fallaMs)}</p><Enlace href={salaUrl} variante="secundario">{t.salir}</Enlace></Cubierta>
        ) : cortado ? (
          <Cubierta titulo={t.reconTitulo} texto={sala?.agentOnline === false ? t.sinAgente : t.reconTexto}>{!sinLimite && <p className="t-score">{reloj(restanteMs)}</p>}<Enlace href={salaUrl} variante="secundario">{t.salir}</Enlace></Cubierta>
        ) : status !== "reproduciendo" && (
          <Cubierta titulo={t.conectando} texto={sala?.agentOnline === false ? t.sinAgente : t.conectandoTexto}><Enlace href={salaUrl} variante="secundario">{t.salir}</Enlace></Cubierta>
        )}
      </div>

      {visibles && <p className="flex items-center justify-center gap-2 px-4 py-2 t-label text-muted landscape:hidden sm:hidden"><Icono nombre="girar" t={20} />{t.gira}</p>}

      {visibles && (
        <div role="toolbar" aria-label={t.controles} onClick={soltarFoco} className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2 pb-[max(8px,env(safe-area-inset-bottom))] sm:px-4 [@media(max-height:480px)]:py-0">
          <div className="flex items-center gap-2 sm:gap-4">
            <label className="flex items-center gap-2"><Icono nombre="volumen" /><span className="sr-only">{t.volumen}</span><input type="range" min={0} max={100} value={vol} onChange={(e) => { setVol(Number(e.target.value)); setVolume(Number(e.target.value) / 100); }} className="h-11 w-20 sm:w-28" /></label>
            <div role="group" aria-label={t.modo} className="flex rounded-md bg-surface">
              {(["estable", "baja"] as const).map((m) => <button key={m} type="button" aria-pressed={latencyMode === m} onClick={() => changeLatencyMode(m)} className="pulsable min-h-11 rounded-md px-3 t-label whitespace-nowrap text-muted aria-pressed:bg-accent-deep aria-pressed:text-ink">{t[m]}</button>)}
            </div>
          </div>
          <div className="flex items-center gap-1 sm:gap-2 max-sm:w-full max-sm:justify-between">
            <span className="flex">
              <button type="button" aria-label={activa ? t.salirCompleta : t.completa} aria-pressed={activa} onClick={alternar} className={control}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" /></svg></button>
              <button type="button" aria-label={t.estadisticas} aria-pressed={verStats} onClick={() => setVerStats(!verStats)} className={control}><Icono nombre="datos" /></button>
              <button type="button" aria-label={t.ocultar} onClick={() => setVisibles(false)} className={control}><Icono nombre="ojo" /></button>
            </span>
            <Boton variante="peligro" className="!min-h-11 !px-4" onClick={() => setTerminar(true)}>{sinLimite ? t.soltar : t.terminar}</Boton>
          </div>
        </div>
      )}

      <Modal abierto={terminar} alCerrar={() => setTerminar(false)} titulo={sinLimite ? t.soltar : t.terminarTitulo}>
        <p className="text-muted">{sinLimite ? t.soltarTexto : t.terminarTexto(minutosRestantes)}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Boton onClick={() => setTerminar(false)}>{t.seguir}</Boton>
          <Boton variante="peligro" disabled={ocupado} onClick={() => void alTerminar()}>{sinLimite ? t.soltar : t.terminar}</Boton>
        </div>
        <ErrorAccion>{error}</ErrorAccion>
      </Modal>
    </div>
  );
}

/** Pide los servidores ICE (TURN) y, si falla, reintenta mientras dure el turno. */
function Preparar({ cliente }: { cliente: Room }) {
  const [ice, setIce] = useState<RTCIceServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    let espera: ReturnType<typeof setTimeout>;
    const pedir = () => fetchIceServers().then(
      (s) => { if (vivo) setIce(s as RTCIceServer[]); },
      (e) => {
        if (!vivo) return;
        setError(mensaje(e));
        espera = setTimeout(() => void pedir(), REINTENTO_MS);
      },
    );
    void pedir();
    return () => { vivo = false; clearTimeout(espera); };
  }, []);
  if (ice) return <Juego cliente={cliente} iceServers={ice} />;
  return <div className="relative h-dvh bg-black"><Cubierta titulo={error ? t.errorConexion : t.conectando} texto={error ?? t.conectandoTexto} /></div>;
}

export default function Jugar() {
  const { conTurno, usuario, sinLimite, cliente, yo, salaUrl } = useVista();
  const router = useRouter();
  const jugando = useRef<"turno" | "admin" | null>(null);
  // Al terminar el turno (por tiempo, por decisión propia o por una falla), al resumen.
  useEffect(() => {
    if (conTurno) jugando.current = sinLimite ? "admin" : "turno";
    else if (jugando.current) {
      router.replace(jugando.current === "admin" ? "/admin/sala" : "/jugar/fin");
      jugando.current = null;
    }
  }, [conTurno, sinLimite, router]);

  if (conTurno && cliente) return <Preparar cliente={cliente} />;
  const aviso = usuario === "interrumpida" && yo?.notice?.kind === "interrupted" ? yo.notice : null;
  const [a, b] = aviso ? T.accion.interrumpida(aviso.refundedCredits, aviso.unplayedMinutes) : [t.sinTurno, t.sinTurnoTexto];
  return <Pagina><Mensaje titulo={a} texto={b}><Enlace href={salaUrl}>{T.accion.irSala}</Enlace></Mensaje></Pagina>;
}
