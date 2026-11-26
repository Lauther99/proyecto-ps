"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icono } from "@/components/icono";
import { BotonAcceso, ErrorAccion, Pagina } from "@/components/marco";
import { Accion } from "@/components/sala";
import { Aviso, Boton, Corazon, Enlace, EnlaceTexto, Estado, Fila, Mensaje } from "@/components/ui";
import { T } from "@/data/textos";
import { joinQueue } from "@/lib/api";
import { useMedicion } from "@/lib/conexion";
import { bloquesDe, creditosDe, espera } from "@/lib/config";
import { useAccion } from "@/lib/datos";
import { useVista } from "@/lib/vista";

function Contenido() {
  const { usuario: u, saldo, detenida, esperaNueva, sinEstimar, conCuenta, precio, salaUrl, refrescar } = useVista();
  const bloques = bloquesDe(precio);
  const [elegido, setMin] = useState(0);
  const min = bloques.includes(elegido) ? elegido : bloques[0];
  const med = useMedicion();
  const { ocupado, error, ejecutar } = useAccion();
  const [acepta, setAcepta] = useState(false);
  const router = useRouter();
  const t = T.comprar;

  if (!["visitante", "conSaldo", "sinSaldo", "turnoVencido", "interrumpida"].includes(u)) return <div className="mx-auto max-w-md py-12"><h1 className="sr-only">{t.titulo}</h1><Accion /></div>;
  if (detenida) return <Mensaje titulo={t.vacio} texto={t.vacioTexto}><Enlace href={salaUrl} variante="secundario">{t.volver}</Enlace></Mensaje>;

  const costo = creditosDe(precio, min);
  const falta = costo - saldo.available;
  const c = med?.calidad ?? "sinProbar";
  const bloqueo = c === "mala" && !acepta;

  const reservar = async () => {
    if (await ejecutar(() => joinQueue(min))) {
      void refrescar();
      router.push(salaUrl);
    }
  };

  return (
    <div className="flex flex-col gap-8">
      <h1 className="t-heading">{t.titulo}</h1>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_400px]">
        <fieldset className="grid grid-cols-2 gap-3 sm:gap-4">
          <legend className="sr-only">{t.bloque}</legend>
          {bloques.map((m) => {
            const f = creditosDe(precio, m) - saldo.available;
            return (
              <label key={m} className="pulsable relative flex cursor-pointer flex-col gap-3 rounded-md border-2 border-surface bg-surface p-4 hover:bg-raised has-checked:border-accent has-checked:bg-accent-deep has-focus-visible:outline-3 has-focus-visible:outline-offset-3 has-focus-visible:outline-ink sm:p-6">
                <input type="radio" name="bloque" value={m} checked={min === m} onChange={() => setMin(m)} className="sr-only" />
                <span className="flex h-[92px] flex-wrap content-end gap-2 sm:h-[104px]">{Array.from({ length: m / precio.blockMinutes }, (_, i) => <Corazon key={i} decorativo className="w-12 self-end sm:w-16" />)}</span>
                <span className="font-mono text-2xl leading-8 font-bold whitespace-nowrap sm:text-[28px]">{t.minutos(m)}</span>
                <span className="text-muted">{t.creditos(creditosDe(precio, m))}</span>
                <span className="min-h-5 t-label">{min === m ? <span className="inline-flex items-center gap-1"><Icono nombre="check" t={16} />{t.elegido}</span> : conCuenta && f > 0 ? <span className="text-muted">{t.falta(f)}</span> : null}</span>
              </label>
            );
          })}
        </fieldset>

        <section aria-labelledby="resumen" className="flex flex-col gap-6 rounded-md bg-surface p-6">
          <h2 id="resumen" className="t-title">{t.resumen}</h2>
          <dl className="flex flex-col gap-3">
            {conCuenta && <Fila etiqueta={t.antes}><span className="font-mono">{saldo.available}</span></Fila>}
            <Fila etiqueta={t.reserva}><span className="font-mono">{costo}</span></Fila>
            {conCuenta && <Fila etiqueta={t.despues}><span className="font-mono">{falta > 0 ? t.falta(falta) : saldo.available - costo}</span></Fila>}
            <Fila etiqueta={t.esperaL}>{sinEstimar ? T.sala.pausa : espera(esperaNueva)}</Fila>
          </dl>
          <div className="flex flex-col gap-3 border-t border-raised pt-6">
            <div className="flex items-center justify-between gap-4">
              <h3 className="text-muted">{t.conexionL}</h3>
              <Estado tono={c === "buena" ? "bien" : c === "mala" ? "aviso" : c === "regular" ? "neutro" : "apagado"} icono={c === "buena" ? "check" : c === "sinProbar" ? undefined : c === "mala" ? "alerta" : "info"}>{t.nombres[c]}</Estado>
            </div>
            {med && <p className="t-data text-muted">{t.datos(med.ping, med.jitter, med.fallos)}</p>}
            {(med?.ruta === "TCP" || med?.ruta === "TLS") && <Aviso titulo={t.avisoTcp[0]}>{t.avisoTcp[1]}</Aviso>}
            {c === "mala" && <Aviso titulo={t.avisoMala[0]}>{t.avisoMala[1]}</Aviso>}
            {c === "regular" && <Aviso tono="neutro">{t.avisoRegular}</Aviso>}
            {c === "sinProbar" && <Aviso tono="neutro">{t.avisoSin}</Aviso>}
            <EnlaceTexto href="/prueba">{c === "sinProbar" ? t.probar : t.repetir}</EnlaceTexto>
            {c === "mala" && <label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="size-5" />{t.entiendo}</label>}
          </div>
          {!conCuenta ? <BotonAcceso /> : falta > 0 ? <Enlace href="/recargar">{T.accion.recargar}</Enlace> : (
            <Boton disabled={bloqueo || ocupado} onClick={() => void reservar()}>{t.confirmar(min)}</Boton>
          )}
          <ErrorAccion>{error}</ErrorAccion>
          <p className="text-muted">{t.nota(precio)}</p>
        </section>
      </div>
    </div>
  );
}

export default function Comprar() {
  return <Pagina><Contenido /></Pagina>;
}
