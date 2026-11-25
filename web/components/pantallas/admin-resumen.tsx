"use client";
import { Carga, PaginaAdmin } from "@/components/pagina-admin";
import { Icono } from "@/components/icono";
import { EstadoConsola, useDirecto } from "@/components/sala";
import { Enlace, EnlaceTexto, Estado, Tabla } from "@/components/ui";
import { T } from "@/data/textos";
import { A } from "@/data/textos-admin";
import type { AdminSummary } from "@/lib/api";
import { fecha, minutos, soles } from "@/lib/config";
import { useDatos } from "@/lib/datos";
import { useVista } from "@/lib/vista";

const t = A.resumen;

function Resumen({ d }: { d: AdminSummary }) {
  const { sala, consola, cola } = useVista();
  const agente = !!sala?.agentOnline;
  const vivo = useDirecto() !== null;
  const servicio = [
    { n: t.agente, e: <Estado tono={agente ? "bien" : "aviso"} icono={agente ? "check" : "alerta"}>{agente ? t.conectado : t.desconectado}</Estado>, d: agente ? t.conSenal : d.agentLastSeen ? t.senal(fecha(d.agentLastSeen)) : t.sinSenal },
    { n: t.consola, e: <EstadoConsola consola={consola} />, d: sala?.current ? `${t.juega(sala.current.name)}, ${t.enCola(cola.length)}` : T.sala.mensajes[consola][1] },
    { n: t.directo, e: <Estado tono={vivo ? "bien" : "aviso"} icono={vivo ? "vivo" : "alerta"}>{vivo ? t.vivo : t.caido}</Estado>, d: t.detalleDirecto[vivo ? 0 : 1] },
  ];
  return (
    <>
      <section aria-labelledby="pend" className="flex flex-col gap-3">
        <h2 id="pend" className="t-title">{t.pendientes}</h2>
        {d.pendingRecharges === 0 ? <p className="rounded-md bg-surface p-4 text-muted">{A.sinPendientes}</p> : (
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-md bg-surface p-6">
            <ul className="flex flex-col gap-2">
              <li className="flex items-center gap-3"><Icono nombre="reloj" t={20} className="shrink-0" />{t.esperan(d.pendingRecharges)}</li>
              {d.repeatedRecharges > 0 && <li className="flex items-center gap-3"><Icono nombre="alerta" t={20} className="shrink-0 text-warn" />{t.repetidos(d.repeatedRecharges)}</li>}
            </ul>
            <Enlace href="/admin/recargas" className="max-sm:w-full">{t.verRecargas}</Enlace>
          </div>
        )}
      </section>
      <section aria-labelledby="serv" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4"><h2 id="serv" className="t-title">{t.servicio}</h2><EnlaceTexto href="/admin/sala">{t.verSala}</EnlaceTexto></div>
        <dl className="divide-y divide-raised border-y border-raised">
          {servicio.map((s) => <div key={s.n} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 py-4 md:grid-cols-[160px_200px_1fr]"><dt className="font-semibold">{s.n}</dt><dd>{s.e}</dd><dd className="col-span-2 text-muted md:col-span-1">{s.d}</dd></div>)}
        </dl>
      </section>
      <section aria-labelledby="ing" className="flex flex-col gap-3">
        <h2 id="ing" className="t-title">{t.ingresos}</h2>
        <Tabla titulo={t.ingresos} columnas={t.columnas} vacio={t.sinIngresos} filas={d.income.map((i) => ({ id: i.period, celdas: [t.periodos[i.period], <span key="n" className="font-mono">{i.recharges}</span>, <span key="s" className="font-mono font-bold">{soles(i.soles)}</span>, <span key="m" className="font-mono">{minutos(i.playedMs)}</span>] }))} />
      </section>
    </>
  );
}

function Contenido() {
  const { datos, error, recargar } = useDatos<AdminSummary>("/api/admin/summary");
  return <Carga datos={datos} error={error} recargar={recargar}>{(d) => <Resumen d={d} />}</Carga>;
}

export default function PaginaResumen() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
