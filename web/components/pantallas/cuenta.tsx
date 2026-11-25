"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ErrorAccion, Pagina, PedirCuenta } from "@/components/marco";
import { Carga } from "@/components/pagina-admin";
import { Aviso, Boton, Campo, Enlace, EnlaceTexto, Tabla } from "@/components/ui";
import { C } from "@/data/textos-cuenta";
import { logout, updateNickname, type Movement, type PlaySession, type Recharge, type User } from "@/lib/api";
import { fecha, minutos, soles } from "@/lib/config";
import { useAccion, useDatos } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";
import { EtiquetaRecarga } from "./recargar";

type Pestana = keyof typeof C.pestanas;
const RUTAS = { movimientos: "/api/movements", recargas: "/api/recharges", sesiones: "/api/sessions" };
type Respuesta = { movements?: Movement[]; recharges?: Recharge[]; sessions?: PlaySession[] };

function Historial() {
  const [p, setP] = useState<Pestana>("movimientos");
  const { datos, error, recargar } = useDatos<Respuesta>(RUTAS[p]);
  const filas = (d: Respuesta) => [
    ...(d.movements ?? []).map((m) => ({ id: m.id, celdas: [fecha(m.createdAt), m.detail, <span key="n" className="font-mono font-bold">{m.credits > 0 ? `+${m.credits}` : m.credits}</span>] })),
    ...(d.recharges ?? []).map((r) => ({ id: r.id, celdas: [fecha(r.createdAt), <span key="o" className="font-mono">{r.operation}</span>, <span key="m" className="font-mono">{soles(r.amount)}</span>, <EtiquetaRecarga key="e" e={r.status} />] })),
    ...(d.sessions ?? []).map((s) => ({ id: s.id, celdas: [fecha(s.startedAt), s.game || "-", minutos(s.playedMs), s.chargedCredits - s.refundedCredits, C.resultados[s.result]] })),
  ];
  return (
    <section aria-labelledby="hist" className="flex min-w-0 flex-col gap-4">
      <h2 id="hist" className="t-title">{C.historial}</h2>
      <div role="group" aria-label={C.historial} className="flex w-fit max-w-full overflow-x-auto rounded-md bg-surface">
        {(Object.keys(C.pestanas) as Pestana[]).map((k) => <button key={k} type="button" aria-pressed={p === k} onClick={() => setP(k)} className="min-h-11 rounded-md px-3 t-label text-muted aria-pressed:bg-accent-deep aria-pressed:text-ink sm:px-4">{C.pestanas[k]}</button>)}
      </div>
      <Carga datos={datos} error={error} recargar={recargar}>{(d) => <Tabla titulo={C.pestanas[p]} columnas={{ movimientos: C.colMov, recargas: C.colRec, sesiones: C.colSes }[p]} vacio={C.vacio[p]} filas={filas(d)} />}</Carga>
    </section>
  );
}

function Apodo({ yo }: { yo: User }) {
  const { refrescar } = useSistema();
  const [apodo, setApodo] = useState(yo.nickname);
  const [estado, setEstado] = useState<"" | "invalido" | "ok">("");
  const { ocupado, error, ejecutar } = useAccion();
  const guardar = async () => {
    const limpio = apodo.trim();
    if (!/^[\p{L}\p{N}._-]{3,20}$/u.test(limpio)) return setEstado("invalido");
    if (await ejecutar(async () => { await updateNickname(limpio); await refrescar(); })) setEstado("ok");
  };
  return (
    <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void guardar(); }}>
      <Campo id="apodo" etiqueta={C.apodo} value={apodo} maxLength={20} onChange={(e) => { setApodo(e.target.value); setEstado(""); }} ayuda={C.apodoAyuda} error={estado === "invalido" ? C.apodoError : (error ?? undefined)} />
      <Boton type="submit" variante="secundario" disabled={ocupado}><span aria-live="polite">{estado === "ok" ? C.guardado : C.guardar}</span></Boton>
    </form>
  );
}

function Cuenta({ yo }: { yo: User }) {
  const { refrescar } = useSistema();
  const router = useRouter();
  const { ocupado, error, ejecutar } = useAccion();
  const bloqueado = yo.status === "blocked";
  const [tit, tex] = C.bloqueado(yo.blockedReason);
  return (
    <>
      {bloqueado && <Aviso titulo={tit}>{tex}</Aviso>}
      <div className="grid items-start gap-10 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-12">
        <div className="flex flex-col gap-10">
          <section aria-labelledby="saldo" className="flex flex-col gap-4 rounded-md bg-surface p-6">
            <h2 id="saldo" className="t-title">{C.saldo}</h2>
            <dl className="flex gap-10">
              <div><dt className="text-muted">{C.disponible}</dt><dd className="t-score">{yo.balance.available}</dd></div>
              <div><dt className="text-muted">{C.reservado}</dt><dd className="t-score">{yo.balance.reserved}</dd></div>
            </dl>
            {yo.balance.reserved > 0 && <p className="text-muted">{C.reservadoTexto}</p>}
            {!bloqueado && <Enlace href="/recargar">{C.recargar}</Enlace>}
          </section>
          <Apodo yo={yo} />
          <div className="flex flex-col items-start">
            {yo.role === "admin" && <EnlaceTexto href="/admin">{C.admin}</EnlaceTexto>}
            <button type="button" disabled={ocupado} onClick={async () => { if (await ejecutar(async () => { await logout(); await refrescar(); })) router.push("/"); }} className="t-label min-h-11 text-muted underline underline-offset-4 hover:text-ink">{C.salir}</button>
            <ErrorAccion>{error}</ErrorAccion>
          </div>
        </div>
        <Historial />
      </div>
    </>
  );
}

function Contenido() {
  const yo = useSistema().sesion.datos?.user;
  return <div className="flex flex-col gap-8"><h1 className="t-heading">{C.titulo}</h1>{yo ? <Cuenta key={yo.id} yo={yo} /> : <PedirCuenta />}</div>;
}

export default function PaginaCuenta() {
  return <Pagina requiere={["sitio", "sesion"]}><Contenido /></Pagina>;
}
