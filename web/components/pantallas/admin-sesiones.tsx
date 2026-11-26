"use client";
import { useState } from "react";
import { ErrorAccion } from "@/components/marco";
import { Carga, PaginaAdmin } from "@/components/pagina-admin";
import { Boton, Campo, Estado, Fila, Modal, Tabla } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { C } from "@/data/textos-cuenta";
import { refundSession, type AdminSession, type SessionEvent, type SessionReport } from "@/lib/api";
import { fecha, hora, minutos } from "@/lib/config";
import { useAccion, useDatos } from "@/lib/datos";

const t = A.sesiones;
const duracion = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : minutos(ms));

function detalle(e: SessionEvent): string {
  const d = e.detail;
  if (e.kind === "end" && typeof d?.result === "string") return C.resultados[d.result as keyof typeof C.resultados] ?? "";
  if (e.kind === "refund") return t.devuelto(Number(d?.credits ?? 0), d?.manual === true);
  return "";
}

function Registro({ s, d }: { s: AdminSession; d: SessionReport }) {
  const r = d.report;
  const v = t.veredictos[r.verdict];
  const linea = d.events.filter((e) => e.kind !== "quality");
  const muestras = d.events.filter((e) => e.kind === "quality" && typeof e.detail?.rtt === "number");
  const promedio = muestras.length ? Math.round(muestras.reduce((n, e) => n + Number(e.detail?.rtt), 0) / muestras.length) : null;
  return (
    <>
      <div className="flex flex-col items-start gap-2">
        <Estado tono={r.verdict === "ok" ? "bien" : r.verdict === "noData" ? "apagado" : "neutro"}>{v[0]}</Estado>
        <p className="text-muted">{v[1]}</p>
      </div>
      <dl className="flex flex-col gap-2">
        <Fila etiqueta={t.cortes}>{r.cuts ? `${r.cuts} (${duracion(r.playerOffMs)})` : "0"}</Fila>
        <Fila etiqueta={t.fallaNuestra}>{duracion(r.outageMs)}</Fila>
        <Fila etiqueta={t.ping}>{promedio === null ? "-" : `${promedio} ms`}</Fila>
        <Fila etiqueta={t.malas}>{r.samples ? t.deMuestras(r.badSamples, r.samples) : "-"}</Fila>
        <Fila etiqueta={t.cobrado}>{s.chargedCredits}</Fila>
        <Fila etiqueta={t.yaDevuelto}>{s.refundedCredits}</Fila>
      </dl>
      {linea.length > 0 && (
        <ol aria-label={t.linea} className="max-h-56 divide-y divide-raised overflow-y-auto border-y border-raised">
          {linea.map((e, i) => <li key={i} className="grid grid-cols-[80px_1fr] gap-2 py-2"><span className="t-data text-muted">{hora(e.at)}</span><span>{t.eventos[e.kind as keyof typeof t.eventos] ?? e.kind}{detalle(e) && <span className="text-muted">, {detalle(e)}</span>}</span></li>)}
        </ol>
      )}
      <p className="t-label font-normal text-muted">{t.aviso}</p>
    </>
  );
}

function Devolver({ s, alTerminar }: { s: AdminSession; alTerminar: () => void }) {
  const queda = s.chargedCredits - s.refundedCredits;
  const [creditos, setCreditos] = useState("");
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const [clave] = useState(() => crypto.randomUUID());
  const { ocupado, error, ejecutar } = useAccion();
  if (queda <= 0) return <p className="text-muted">{t.nadaPorDevolver}</p>;
  const n = Number(creditos);
  const ok = /^\d+$/.test(creditos) && n >= 1 && n <= queda;
  const enviar = async () => {
    setIntento(true);
    if (ok && motivo.trim() && (await ejecutar(() => refundSession(s.id, n, motivo.trim(), clave)))) alTerminar();
  };
  return (
    <form noValidate className="flex flex-col gap-4 border-t border-raised pt-4" onSubmit={(e) => { e.preventDefault(); void enviar(); }}>
      <Campo id="dev-cre" inputMode="numeric" etiqueta={t.creditos} ayuda={t.hasta(queda)} value={creditos} onChange={(e) => setCreditos(e.target.value)} error={intento && !ok ? t.hasta(queda) : undefined} />
      <Campo id="dev-mot" maxLength={200} etiqueta={A.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={intento && !motivo.trim() ? A.motivoError : undefined} />
      <ErrorAccion>{error}</ErrorAccion>
      <Boton type="submit" disabled={ocupado}>{t.devolver}</Boton>
    </form>
  );
}

function Contenido() {
  const { datos, error, recargar } = useDatos<{ sessions: AdminSession[] }>("/api/admin/sessions");
  const [id, setId] = useState<string | null>(null);
  const registro = useDatos<SessionReport>(id ? `/api/admin/sessions/${id}/events` : null);
  const s = datos?.sessions.find((x) => x.id === id);
  return (
    <>
      <Carga datos={datos} error={error} recargar={recargar}>
        {(d) => <Tabla titulo={t.titulo} columnas={t.columnas} vacio={t.vacio} filas={d.sessions.map((x) => ({ id: x.id, celdas: [fecha(x.startedAt), x.nickname, x.game || "-", minutos(x.playedMs), x.refundedCredits ? `${x.chargedCredits} (-${x.refundedCredits})` : x.chargedCredits, C.resultados[x.result], <Boton key="r" variante="secundario" className="!min-h-11 !px-4" onClick={() => setId(x.id)}>{t.ver}</Boton>] }))} />}
      </Carga>
      <Modal abierto={!!s} alCerrar={() => setId(null)} titulo={s ? t.registroDe(s.nickname, fecha(s.startedAt)) : ""}>
        {s && (
          <>
            <Carga datos={registro.datos} error={registro.error} recargar={registro.recargar}>{(d) => <Registro s={s} d={d} />}</Carga>
            <Devolver key={`${s.id}-${s.refundedCredits}`} s={s} alTerminar={() => { recargar(); registro.recargar(); }} />
          </>
        )}
      </Modal>
    </>
  );
}

export default function Sesiones() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
