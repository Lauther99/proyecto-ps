"use client";
import { useState } from "react";
import { ErrorAccion, Pagina, PedirCuenta } from "@/components/marco";
import { Carga } from "@/components/pagina-admin";
import { Boton, Corazon, Enlace, EnlaceTexto, Fila, Mensaje } from "@/components/ui";
import { C } from "@/data/textos-cuenta";
import { rateSession, type PlaySession } from "@/lib/api";
import { minutos } from "@/lib/config";
import { useAccion, useDatos } from "@/lib/datos";
import { useVista } from "@/lib/vista";

const t = C.fin;

function Calificacion({ id }: { id: string }) {
  const [nota, setNota] = useState(0);
  const [fallas, setFallas] = useState<string[]>([]);
  const [enviado, setEnviado] = useState(false);
  const { ocupado, error, ejecutar } = useAccion();
  const opcion = "pulsable min-h-11 rounded-md bg-surface px-3 t-label hover:bg-raised aria-pressed:bg-accent-deep aria-pressed:outline-2 aria-pressed:outline-accent";
  return (
    <section aria-labelledby="cal" className="flex flex-col gap-4">
      <h2 id="cal" className="t-title">{t.califica}</h2>
      {enviado ? <p role="status" className="text-muted">{t.gracias}</p> : (
        <>
          <div role="group" aria-labelledby="cal" className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {t.notas.map((n, i) => <button key={n} type="button" aria-pressed={nota === i + 1} onClick={() => setNota(i + 1)} className={opcion}>{n}</button>)}
          </div>
          {nota > 0 && nota < 4 && (
            <div className="flex flex-col gap-3">
              <h3 id="falla" className="t-label">{t.problema}</h3>
              <div role="group" aria-labelledby="falla" className="flex flex-wrap gap-2">{t.problemas.map((p) => <button key={p} type="button" aria-pressed={fallas.includes(p)} onClick={() => setFallas((f) => (f.includes(p) ? f.filter((x) => x !== p) : [...f, p]))} className={opcion}>{p}</button>)}</div>
            </div>
          )}
          {nota > 0 && <Boton variante="secundario" className="self-start" disabled={ocupado} onClick={async () => { if (await ejecutar(() => rateSession(id, nota, nota < 4 ? fallas : []))) setEnviado(true); }}>{t.enviar}</Boton>}
          <ErrorAccion>{error}</ErrorAccion>
        </>
      )}
    </section>
  );
}

function Resumen({ s }: { s: PlaySession }) {
  const { saldo, usuario, salaUrl } = useVista();
  const cortada = s.result === "interrupted";
  const sinSaldo = usuario === "sinSaldo";
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-10 pt-4">
      <div className="flex flex-col items-start gap-4">
        <Corazon minutos={0} decorativo className="w-32" />
        <h1 className="t-display">{cortada ? t.interrumpida : t.titulo}</h1>
        {cortada && <p className="text-muted">{t.textoInt}</p>}
      </div>
      <dl className="flex flex-col gap-3 border-y border-raised py-6 font-mono [&_dt]:font-sans">
        <Fila etiqueta={t.jugaste}>{minutos(s.playedMs)}</Fila><Fila etiqueta={t.cobrados}>{s.chargedCredits}</Fila>
        {s.refundedCredits > 0 && <Fila etiqueta={t.devueltos}>+{s.refundedCredits}</Fila>}
        <Fila etiqueta={t.saldo}>{C.creditos(saldo.available)}</Fila>
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-6">
        <Enlace href={sinSaldo ? "/recargar" : "/comprar"}>{sinSaldo ? C.recargar : t.otra}</Enlace>
        <EnlaceTexto href={salaUrl} className="justify-center">{t.sala}</EnlaceTexto>
      </div>
      <Calificacion id={s.id} />
    </div>
  );
}

function Contenido() {
  const { conCuenta, salaUrl } = useVista();
  const { datos, error, recargar } = useDatos<{ sessions: PlaySession[] }>(conCuenta ? "/api/sessions" : null);
  if (!conCuenta) return <PedirCuenta />;
  return (
    <Carga datos={datos} error={error} recargar={recargar}>
      {(d) => d.sessions[0] ? <Resumen s={d.sessions[0]} /> : <Mensaje titulo={C.sinSesion} texto={C.sinSesionTexto}><Enlace href={salaUrl}>{t.sala}</Enlace></Mensaje>}
    </Carga>
  );
}

export default function Fin() {
  return <Pagina><Contenido /></Pagina>;
}
