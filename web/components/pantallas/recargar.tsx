"use client";
import { useEffect, useState } from "react";
import { Icono } from "@/components/icono";
import { ErrorAccion, Pagina, PedirCuenta } from "@/components/marco";
import { Carga } from "@/components/pagina-admin";
import { Accion } from "@/components/sala";
import { Boton, Campo, Enlace, Estado, Fila, Mensaje } from "@/components/ui";
import { T } from "@/data/textos";
import { createRecharge, type Recharge, type RechargeStatus, type SiteConfig } from "@/lib/api";
import { fecha, soles } from "@/lib/config";
import { useAccion, useDatos } from "@/lib/datos";
import { useVista } from "@/lib/vista";

const t = T.recargar;
const MONTOS = [15, 30, 45, 60];
// Una recarga resuelta se muestra en grande un día; después queda solo en la lista.
const RECIENTE_MS = 24 * 60 * 60_000;
const TONO = { pending: "neutro", approved: "bien", rejected: "aviso" } as const;
const ICONO = { pending: "reloj", approved: "check", rejected: "x" } as const;
const NOMBRE = { pending: t.estados.pendiente, approved: t.estados.aprobada, rejected: t.estados.rechazada };
export const EtiquetaRecarga = ({ e }: { e: RechargeStatus }) => <Estado tono={TONO[e]} icono={ICONO[e]}>{NOMBRE[e]}</Estado>;

function Copiar({ texto }: { texto: string }) {
  const [estado, setEstado] = useState<"" | "ok" | "error">("");
  const copiar = () => navigator.clipboard.writeText(texto).then(() => setEstado("ok"), () => setEstado("error"));
  return <Boton variante="secundario" onClick={() => void copiar()}><Icono nombre={estado === "ok" ? "check" : "copiar"} t={20} /><span aria-live="polite">{estado === "ok" ? t.copiado : estado === "error" ? t.noCopio : t.copiar}</span></Boton>;
}

function Formulario({ config, previa, alEnviar }: { config: SiteConfig; previa: Recharge | null; alEnviar: (r: Recharge) => void }) {
  const [monto, setMonto] = useState(String(previa?.amount ?? 15));
  const [op, setOp] = useState(previa?.operation ?? "");
  const [enviado, setEnviado] = useState(false);
  // La misma clave en los reintentos: si la respuesta se pierde, el backend no crea dos recargas.
  const [clave] = useState(() => crypto.randomUUID());
  const { ocupado, error, ejecutar } = useAccion();
  const n = Number(monto);
  const montoOk = /^\d{1,4}$/.test(monto) && n >= 1;
  const opOk = /^\d{4,20}$/.test(op.trim());
  return (
    <form noValidate className="flex flex-col gap-10" onSubmit={(e) => {
      e.preventDefault();
      setEnviado(true);
      if (montoOk && opOk) void ejecutar(async () => alEnviar((await createRecharge(n, op.trim(), `${clave}-${n}-${op.trim()}`)).recharge));
    }}>
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-4 t-title">{t.monto}</legend>
        <div className="grid grid-cols-4 gap-2 sm:gap-3">
          {MONTOS.map((m) => <button key={m} type="button" aria-pressed={n === m} onClick={() => setMonto(String(m))} className="pulsable min-h-12 rounded-md border-2 border-surface bg-surface font-mono font-bold whitespace-nowrap hover:bg-raised aria-pressed:border-accent aria-pressed:bg-accent-deep">{soles(m)}</button>)}
        </div>
        <Campo id="monto" inputMode="numeric" etiqueta={t.otro} value={monto} onChange={(e) => setMonto(e.target.value)} ayuda={montoOk ? t.recibes(n) : t.montoError} error={enviado && !montoOk ? t.montoError : undefined} />
      </fieldset>

      <section className="flex flex-col gap-6">
        <h2 className="t-title">{t.yapea(montoOk ? soles(n) : soles(0))}</h2>
        <div className="grid gap-6 sm:grid-cols-[208px_1fr]">
          {config.yapeQrUrl
            // eslint-disable-next-line @next/next/no-img-element -- exportación estática: no hay optimizador
            ? <img src={config.yapeQrUrl} alt={t.qr} className="aspect-square w-52 justify-self-center rounded-md bg-white object-contain p-2" />
            : <div className="flex aspect-square w-52 flex-col items-center justify-center gap-2 justify-self-center rounded-md border border-dashed border-line bg-surface p-4 text-center"><p className="t-label">{t.qr}</p><p className="t-data text-muted">{t.sinQr}</p></div>}
          <div className="flex flex-col gap-4">
            <dl className="flex flex-col gap-2"><Fila etiqueta={t.titular}>{config.yapeHolder}</Fila><Fila etiqueta={t.numero}>{config.yapeNumber}</Fila></dl>
            <Copiar texto={config.yapeNumber.replace(/\s/g, "")} />
            <ol className="flex list-decimal flex-col gap-2 pl-5 text-muted marker:font-mono marker:text-ink">{t.pasos.map((p) => <li key={p}>{p}</li>)}</ol>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4">
        <Campo id="op" inputMode="numeric" autoComplete="off" etiqueta={t.operacion} value={op} onChange={(e) => setOp(e.target.value)} ayuda={t.ayuda} error={enviado && !opOk ? t.errorOp : undefined} />
        <Boton type="submit" disabled={ocupado}>{t.enviar}</Boton>
        <ErrorAccion>{error}</ErrorAccion>
        <p className="text-muted">{t.nota}</p>
      </div>
    </form>
  );
}

function Seguimiento({ r, alCerrar }: { r: Recharge; alCerrar: (corregir: boolean) => void }) {
  const texto = r.status === "pending" ? t.mensajes.pendiente : r.status === "approved" ? t.mensajes.aprobada(r.amount) : t.mensajes.rechazada(r.reason);
  return (
    <section aria-labelledby="seg" className="flex flex-col gap-6 rounded-md bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="seg" className="t-title">{t.seguimiento}</h2><EtiquetaRecarga e={r.status} /></div>
      <p className="t-score">{soles(r.amount)}</p>
      <p className="t-data text-muted">{t.op(r.operation)}<br />{fecha(r.createdAt)}</p>
      <p role="status">{texto}</p>
      {r.status === "approved" && <Enlace href="/comprar">{t.jugar}</Enlace>}
      {r.status === "rejected" && <Boton onClick={() => alCerrar(true)}>{t.corregir}</Boton>}
      {r.status !== "rejected" && <Boton variante="secundario" onClick={() => alCerrar(false)}>{t.nueva}</Boton>}
    </section>
  );
}

function Recargas({ lista, recargar, config }: { lista: Recharge[]; recargar: () => void; config: SiteConfig }) {
  const { ahora } = useVista();
  const [cerrada, setCerrada] = useState<string | null>(null);
  const [previa, setPrevia] = useState<Recharge | null>(null);
  const [nueva, setNueva] = useState<Recharge | null>(null);
  const todas = nueva && !lista.some((r) => r.id === nueva.id) ? [nueva, ...lista] : lista;
  const ultima = todas[0];
  const actual = ultima && ultima.id !== cerrada && (ultima.status === "pending" || ahora - ultima.createdAt < RECIENTE_MS) ? ultima : null;
  return (
    <div className="grid items-start gap-12 lg:grid-cols-[minmax(0,1fr)_400px]">
      <div className="max-w-[640px]">
        {actual
          ? <Seguimiento r={actual} alCerrar={(corregir) => { setPrevia(corregir ? actual : null); setCerrada(actual.id); }} />
          : !config.yapeNumber || !config.yapeHolder ? <Mensaje titulo={t.cerrado} texto={t.cerradoTexto} />
          : <Formulario config={config} previa={previa} alEnviar={(r) => { setNueva(r); recargar(); }} />}
      </div>
      <section aria-labelledby="hist" className="flex flex-col gap-3">
        <h2 id="hist" className="t-title">{t.historial}</h2>
        {todas.length === 0 ? <p className="rounded-md bg-surface p-4 text-muted">{t.sinHistorial}</p> : (
          <ul className="divide-y divide-raised border-y border-raised">
            {todas.map((r) => <li key={r.id} className="flex items-center justify-between gap-4 py-4"><div><p className="font-mono font-bold">{soles(r.amount)}</p><p className="t-data text-muted">{fecha(r.createdAt)}<br />{t.op(r.operation)}</p></div><EtiquetaRecarga e={r.status} /></li>)}
          </ul>
        )}
      </section>
    </div>
  );
}

function Contenido() {
  const { yo, saldo, conCuenta, usuario, sitio } = useVista();
  const { datos, error, recargar } = useDatos<{ recharges: Recharge[] }>(conCuenta ? "/api/recharges" : null);
  // Cuando el admin resuelve una recarga cambia la sesión: volvemos a pedir la lista.
  useEffect(() => recargar(), [yo, recargar]);
  if (usuario === "bloqueado") return <div className="mx-auto max-w-md py-12"><h1 className="sr-only">{t.titulo}</h1><Accion /></div>;
  const config = sitio.datos?.config;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="t-heading">{t.titulo}</h1>
        {conCuenta && <p className="text-muted">{t.saldo}: <span className="font-mono font-bold text-ink">{T.comun.saldo(saldo.available)}</span></p>}
      </div>
      {!conCuenta ? <PedirCuenta /> : <Carga datos={datos} error={error} recargar={recargar}>{(d) => config && <Recargas lista={d.recharges} recargar={recargar} config={config} />}</Carga>}
    </div>
  );
}

export default function Recargar() {
  return <Pagina requiere={["sitio", "sesion"]}><Contenido /></Pagina>;
}
