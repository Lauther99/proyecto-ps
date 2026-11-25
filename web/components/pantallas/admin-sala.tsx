"use client";
import { useState } from "react";
import { ErrorAccion } from "@/components/marco";
import { PaginaAdmin } from "@/components/pagina-admin";
import { Turno } from "@/components/sala";
import { Aviso, Boton, Campo, Enlace, Modal } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { roomAction, updateRoom, type RoomAction } from "@/lib/api";
import { creditosDe } from "@/lib/config";
import { useAccion } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";
import { useVista } from "@/lib/vista";

const t = A.sala;
type Accion = "tomar" | "saltar" | "devolver" | null;

function Flecha({ abajo }: { abajo?: boolean }) {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={abajo ? "rotate-180" : ""}><path d="M12 20V4M5 11l7-7 7 7" /></svg>;
}

function Detalles() {
  const { sitio, reintentar } = useSistema();
  const sala = sitio.datos?.rooms[0];
  const [guardado, setGuardado] = useState(false);
  const [invalido, setInvalido] = useState(false);
  const { ocupado, error, ejecutar } = useAccion();
  if (!sala) return null;
  const guardar = async (f: FormData) => {
    const leer = (k: string) => String(f.get(k) ?? "").trim();
    const datos = { name: leer("nombre"), console: leer("consola"), game: leer("juego") };
    const ok = !!datos.name && !!datos.console;
    setInvalido(!ok);
    if (ok && (await ejecutar(() => updateRoom(sala.id, datos)))) {
      setGuardado(true);
      reintentar(); // vuelve a pedir los datos del sitio
    }
  };
  return (
    <section aria-labelledby="det" className="flex flex-col gap-4 border-t border-raised pt-6">
      <div><h2 id="det" className="t-title">{t.detalles}</h2><p className="text-muted">{t.detallesTexto}</p></div>
      <form noValidate className="flex flex-col gap-4" onChange={() => { setGuardado(false); setInvalido(false); }} onSubmit={(e) => { e.preventDefault(); void guardar(new FormData(e.currentTarget)); }}>
        <div className="grid items-start gap-4 sm:grid-cols-3">
          <Campo id="s-nom" name="nombre" maxLength={40} etiqueta={t.nombreSala} defaultValue={sala.name} />
          <Campo id="s-con" name="consola" maxLength={30} etiqueta={t.consola} ayuda={t.consolaAyuda} defaultValue={sala.console} />
          <Campo id="s-jue" name="juego" maxLength={60} etiqueta={t.juego} ayuda={t.juegoAyuda} defaultValue={sala.game} />
        </div>
        <Boton type="submit" className="self-start max-sm:w-full" disabled={ocupado}>{t.guardar}</Boton>
        <ErrorAccion>{invalido ? t.detallesError : error}</ErrorAccion>
        <p role="status" className="min-h-6 t-label">{guardado && t.guardado}</p>
      </form>
    </section>
  );
}

function Contenido() {
  const { sala, consola, cola, conTurno, sinLimite, precio } = useVista();
  const { ocupado, error, ejecutar, limpiar } = useAccion();
  const [accion, setAccion] = useState<Accion>(null);
  const control = conTurno && sinLimite;
  const pausada = !!sala?.paused;
  const [min, setMin] = useState("");
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const [hecho, setHecho] = useState(false);
  const abrir = (a: Accion) => { setMin(""); setMotivo(""); setIntento(false); setHecho(false); limpiar(); setAccion(a); };
  const cerrar = () => setAccion(null);
  const hacer = async (a: RoomAction) => {
    setHecho(false);
    if (await ejecutar(() => roomAction(a))) {
      cerrar();
      setHecho(true);
    }
  };
  const mover = (i: number, d: number) => {
    const ids = cola.map((p) => p.userId);
    [ids[i], ids[i + d]] = [ids[i + d], ids[i]];
    void hacer({ action: "reorder", userIds: ids });
  };
  const n = Number(min);
  const minOk = /^\d+$/.test(min) && n >= 1 && n <= 120;
  const ocupada = consola === "ocupada";
  const ICONO = "pulsable grid size-11 place-items-center rounded-md -outline-offset-3 hover:bg-raised disabled:text-line disabled:hover:bg-transparent";

  return (
    <>
      <div className="flex flex-col gap-3 empty:hidden">
        {control && <Aviso tono="neutro">{t.control}</Aviso>}
        {pausada && <Aviso>{t.pausada}</Aviso>}
        {accion === null && <ErrorAccion>{error}</ErrorAccion>}
        {hecho && <p role="status" className="t-label">{t.hecho}</p>}
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-2">
        <section aria-labelledby="jug" className="flex flex-col gap-6 rounded-md bg-surface p-6">
          <h2 id="jug" className="t-title">{t.jugador}</h2>
          <Turno />
          <div className="grid gap-3 sm:grid-cols-2">
            {control ? <><Enlace href="/jugar">{t.irJugar}</Enlace><Boton variante="secundario" disabled={ocupado} onClick={() => void hacer({ action: "release" })}>{t.soltar}</Boton></> : <Boton onClick={() => abrir("tomar")} disabled={consola === "apagada" || conTurno}>{t.tomar}</Boton>}
            <Boton variante="peligro" disabled={!ocupada || control} onClick={() => abrir("saltar")}>{t.saltar}</Boton>
            <Boton variante="secundario" disabled={ocupado} onClick={() => void hacer({ action: pausada ? "resume" : "pause" })} aria-pressed={pausada}>{pausada ? t.reanudar : t.pausar}</Boton>
            <Boton variante="secundario" disabled={!ocupada || control} onClick={() => abrir("devolver")}>{t.devolver}</Boton>
          </div>
          <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5" disabled={ocupado} checked={!!sala?.youtube} onChange={(e) => void hacer({ action: "youtube", on: e.target.checked })} />{t.directo}</label>
        </section>
        <section aria-labelledby="cola-a" className="flex flex-col gap-3">
          <h2 id="cola-a" className="t-title">{t.cola}</h2>
          {cola.length === 0 ? <p className="rounded-md bg-surface p-4 text-muted">{t.vacio}</p> : (
            <ol className="divide-y divide-raised border-y border-raised">
              {cola.map((p, i) => (
                <li key={p.userId} className="grid grid-cols-[24px_1fr_auto_auto] items-center gap-3 py-2">
                  <span className="t-data text-muted">{i + 1}</span><span className="min-w-0 truncate font-semibold">{p.name}</span><span className="t-data whitespace-nowrap text-muted">{t.minutosDe(p.minutes)}</span>
                  <span className="flex">
                    <button type="button" aria-label={t.subir(p.name)} disabled={i === 0 || ocupado} onClick={() => mover(i, -1)} className={ICONO}><Flecha /></button>
                    <button type="button" aria-label={t.bajar(p.name)} disabled={i === cola.length - 1 || ocupado} onClick={() => mover(i, 1)} className={ICONO}><Flecha abajo /></button>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>

      <Detalles />

      <Modal abierto={accion === "tomar"} alCerrar={cerrar} titulo={t.tomarTitulo}>
        <p className="text-muted">{t.tomarTexto}</p>
        <ErrorAccion>{error}</ErrorAccion>
        <Boton disabled={ocupado} onClick={() => void hacer({ action: "take" })}>{t.tomar}</Boton><Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
      </Modal>
      <Modal abierto={accion === "saltar"} alCerrar={cerrar} titulo={t.saltarTitulo}>
        <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setIntento(true); if (motivo.trim()) void hacer({ action: "skip", reason: motivo.trim() }); }}>
          <p className="text-muted">{t.saltarTexto}</p>
          <Campo id="motivo-sal" etiqueta={A.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={intento && !motivo.trim() ? A.motivoError : undefined} />
          <ErrorAccion>{error}</ErrorAccion>
          <Boton type="submit" disabled={ocupado} variante="peligro">{t.saltar}</Boton><Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
        </form>
      </Modal>
      <Modal abierto={accion === "devolver"} alCerrar={cerrar} titulo={t.devolverTitulo}>
        <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setIntento(true); if (minOk && motivo.trim()) void hacer({ action: "refund", minutes: n, reason: motivo.trim() }); }}>
          <p className="text-muted">{sala?.current?.name}</p>
          <Campo id="min-dev" inputMode="numeric" etiqueta={t.minutos} value={min} onChange={(e) => setMin(e.target.value)} ayuda={minOk ? t.equivale(creditosDe(precio, n)) : undefined} error={intento && !minOk ? t.minutosError : undefined} />
          <Campo id="motivo-dev" etiqueta={A.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={intento && !motivo.trim() ? A.motivoError : undefined} />
          <ErrorAccion>{error}</ErrorAccion>
          <Boton type="submit" disabled={ocupado}>{t.confirmar}</Boton><Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
        </form>
      </Modal>
    </>
  );
}

export default function SalaAdmin() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
