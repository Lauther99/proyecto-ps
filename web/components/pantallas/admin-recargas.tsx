"use client";
import { useState } from "react";
import { ErrorAccion } from "@/components/marco";
import { Carga, PaginaAdmin } from "@/components/pagina-admin";
import { Icono } from "@/components/icono";
import { Aviso, Boton, Campo, Fila, Modal, Tabla } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { resolveRecharge, type AdminRecharge as Recarga, type RechargeStatus as Filtro } from "@/lib/api";
import { fecha, soles } from "@/lib/config";
import { useAccion, useDatos } from "@/lib/datos";
import { EtiquetaRecarga } from "./recargar";

const t = A.recargas;

function Contenido() {
  const [filtro, setFiltro] = useState<Filtro>("pending");
  const { datos, error: errorCarga, recargar } = useDatos<{ recharges: Recarga[] }>(`/api/admin/recharges?status=${filtro}`);
  const { ocupado, error, ejecutar, limpiar } = useAccion();
  const [accion, setAccion] = useState<{ tipo: "aprobar" | "rechazar"; r: Recarga } | null>(null);
  const [verificado, setVerificado] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [intento, setIntento] = useState(false);
  const abrir = (tipo: "aprobar" | "rechazar", r: Recarga) => { setVerificado(false); setMotivo(""); setIntento(false); limpiar(); setAccion({ tipo, r }); };
  const cerrar = () => setAccion(null);
  const resolver = async (cambio: Parameters<typeof resolveRecharge>[1]) => {
    const id = accion?.r.id;
    if (id && (await ejecutar(() => resolveRecharge(id, cambio)))) {
      cerrar();
      recargar();
    }
  };
  const visibles = datos?.recharges ?? [];
  const r = accion?.r;

  return (
    <>
      <div className="flex flex-col gap-4">
        <div role="group" aria-label={t.filtro} className="flex w-fit max-w-full overflow-x-auto rounded-md bg-surface">
          {(Object.keys(t.filtros) as Filtro[]).map((f) => <button key={f} type="button" aria-pressed={filtro === f} onClick={() => setFiltro(f)} className="min-h-11 rounded-md px-3 t-label text-muted -outline-offset-3 aria-pressed:bg-accent-deep aria-pressed:text-ink sm:px-4">{t.filtros[f]}</button>)}
        </div>
        {filtro === "pending" && visibles.some((x) => x.repeated) && <Aviso>{t.avisoRepetidas}</Aviso>}
      </div>
      <Carga datos={datos} error={errorCarga} recargar={recargar}>{() => <Tabla titulo={t.titulo} columnas={t.columnas} vacio={t.vacio} filas={visibles.map((x) => ({
        id: x.id,
        celdas: [
          <strong key="u" className="font-semibold">{x.nickname}</strong>,
          <span key="m" className="font-mono font-bold whitespace-nowrap">{soles(x.amount)}</span>,
          <span key="o" className="flex flex-col items-end gap-1 lg:items-start"><span className="font-mono">{x.operation}</span>{x.repeated && <span className="inline-flex items-center gap-1 t-label text-warn"><Icono nombre="alerta" t={16} />{t.repetida}</span>}</span>,
          <span key="f" className="whitespace-nowrap">{fecha(x.createdAt)}</span>,
          <span key="e" className="flex flex-col items-end gap-1 lg:items-start"><EtiquetaRecarga e={x.status} />{x.status === "rejected" && x.reason && <span className="t-label font-normal text-muted">{x.reason}</span>}</span>,
          x.status === "pending" ? <span key="a" className="flex gap-2"><Boton variante="secundario" className="!min-h-11 !px-4" onClick={() => abrir("aprobar", x)}>{t.aprobar}</Boton><Boton variante="peligro" className="!min-h-11 !px-4" onClick={() => abrir("rechazar", x)}>{t.rechazar}</Boton></span> : "-",
        ],
      }))} />}</Carga>

      <Modal abierto={accion?.tipo === "aprobar"} alCerrar={cerrar} titulo={r ? t.aprobarTitulo(soles(r.amount)) : ""}>
        {r && (
          <>
            <p className="text-muted">{t.aprobarTexto(r.nickname, r.amount)}</p>
            <dl><Fila etiqueta={t.columnas[2]}><span className="font-mono">{r.operation}</span></Fila></dl>
            {r.repeated && <Aviso titulo={t.repetida}>{t.repetidaTexto}</Aviso>}
            <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={verificado} onChange={(e) => setVerificado(e.target.checked)} className="size-5 shrink-0" />{t.verifique}</label>
            <ErrorAccion>{error}</ErrorAccion>
            <Boton disabled={!verificado || ocupado} onClick={() => void resolver({ status: "approved" })}>{t.confirmar}</Boton>
            <Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
          </>
        )}
      </Modal>
      <Modal abierto={accion?.tipo === "rechazar"} alCerrar={cerrar} titulo={t.rechazarTitulo}>
        {r && (
          <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setIntento(true); if (motivo.trim()) void resolver({ status: "rejected", reason: motivo.trim() }); }}>
            <p className="text-muted">{r.nickname}, {soles(r.amount)}. {t.rechazarTexto}</p>
            <Campo id="motivo" etiqueta={A.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={intento && !motivo.trim() ? A.motivoError : undefined} />
            <ErrorAccion>{error}</ErrorAccion>
            <Boton type="submit" variante="peligro" disabled={ocupado}>{t.confirmarRechazo}</Boton>
            <Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
          </form>
        )}
      </Modal>
    </>
  );
}

export default function Recargas() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
