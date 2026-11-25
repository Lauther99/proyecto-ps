"use client";
import { useEffect, useRef, useState } from "react";
import { Icono } from "@/components/icono";
import { Pagina } from "@/components/marco";
import { Boton, Enlace, Estado } from "@/components/ui";
import { T } from "@/data/textos";
import { P } from "@/data/textos-publico";
import { medir, useMedicion } from "@/lib/conexion";

const t = P.prueba;
const TONO = { buena: "bien", regular: "neutro", mala: "aviso", sinProbar: "apagado" } as const;
const ICONO = { buena: "check", regular: "info", mala: "alerta", sinProbar: undefined } as const;

function Conexion() {
  const m = useMedicion();
  const c = m?.calidad ?? "sinProbar";
  const [midiendo, setMidiendo] = useState(false);
  const [error, setError] = useState(false);
  const cancelado = useRef(false);
  useEffect(() => {
    cancelado.current = false;
    return () => { cancelado.current = true; };
  }, []);
  const iniciar = async () => {
    setMidiendo(true);
    setError(false);
    try {
      await medir(() => cancelado.current);
    } catch {
      if (!cancelado.current) setError(true);
    }
    if (!cancelado.current) setMidiendo(false);
  };
  const valores = m ? [`${m.ping} ms`, `${m.jitter} ms`, `${m.fallos} %`] : ["--", "--", "--"];
  return (
    <section aria-labelledby="con" className="flex flex-col gap-6 rounded-md bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="con" className="t-title">{t.conexion}</h2>{!midiendo && <Estado tono={TONO[c]} icono={ICONO[c]}>{T.comprar.nombres[c]}</Estado>}</div>
      <p className="text-muted">{t.conexionTexto}</p>
      <dl className={`grid grid-cols-3 gap-4 ${midiendo ? "pulso" : ""}`}>
        {t.medidas.map(([n, d], i) => <div key={n}><dt className="t-label">{n}</dt><dd className="font-mono text-xl leading-8 font-bold whitespace-nowrap sm:text-[28px] sm:leading-10">{midiendo ? "--" : valores[i]}</dd><dd className="t-label font-normal text-muted">{d}</dd></div>)}
      </dl>
      <p role="status" className="min-h-6">{midiendo ? t.midiendo : error ? t.falloMedir : c === "sinProbar" ? t.sin : t.resultado[c]}</p>
      <Boton variante={c === "sinProbar" ? "principal" : "secundario"} disabled={midiendo} onClick={() => void iniciar()}>{c === "sinProbar" ? t.medir : t.otra}</Boton>
    </section>
  );
}

type Lectura = { botones: boolean[]; ejes: number[]; hz: number; estandar: boolean };

/** Lee el mando en cada cuadro de pantalla. La frecuencia cuenta los datos nuevos que entrega el navegador. */
function useMando(): Lectura | null {
  const [lectura, setLectura] = useState<Lectura | null>(null);
  useEffect(() => {
    let cuadro = 0;
    let ultimo = 0;
    let nuevos = 0;
    let hz = 0;
    let inicio = performance.now();
    const leer = () => {
      cuadro = requestAnimationFrame(leer);
      const pad = (navigator.getGamepads?.() ?? []).find((p) => p?.connected);
      if (!pad) return setLectura(null);
      if (pad.timestamp !== ultimo) {
        nuevos++;
        ultimo = pad.timestamp;
      }
      const ahora = performance.now();
      if (ahora - inicio >= 1000) {
        hz = Math.round((nuevos * 1000) / (ahora - inicio));
        nuevos = 0;
        inicio = ahora;
      }
      setLectura({ botones: pad.buttons.map((b) => b.pressed || b.value > 0.1), ejes: [...pad.axes], hz, estandar: pad.mapping === "standard" });
    };
    cuadro = requestAnimationFrame(leer);
    return () => cancelAnimationFrame(cuadro);
  }, []);
  return lectura;
}

// Índices de la distribución estándar: arriba, derecha, abajo, izquierda (los cuatro de la derecha) y hombros.
const INDICES = [3, 1, 0, 2, 4, 5, 6, 7];

function Mando() {
  const mando = useMando();
  const pulsado = INDICES.map((i) => !!mando?.botones[i]);
  return (
    <section aria-labelledby="man" className="flex flex-col gap-6 rounded-md bg-surface p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="man" className="t-title">{t.mando}</h2><Estado tono={mando ? "bien" : "aviso"} icono={mando ? "check" : "alerta"}>{mando ? T.jugar.conectado : T.jugar.desconectado}</Estado></div>
      <p className="text-muted">{t.mandoTexto}</p>
      {!mando ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center"><Icono nombre="mando" t={48} className="text-muted" /><p className="t-title">{t.sinMando}</p><p className="text-muted">{t.sinMandoTexto}</p></div>
      ) : (
        <>
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="flex flex-col gap-3">
              <h3 className="t-label">{t.botones}</h3>
              <svg viewBox="0 0 120 120" aria-hidden="true" className="w-36 self-center">
                {[[60, 22], [98, 60], [60, 98], [22, 60]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={18} strokeWidth={2} className={pulsado[i] ? "fill-accent stroke-accent" : "fill-raised stroke-line"} />)}
              </svg>
              <ul className="grid grid-cols-2 gap-2 t-label">
                {[...t.nombres, ...t.gatillos].map((n, i) => <li key={n} className={`rounded px-2 py-1 ${pulsado[i] ? "bg-accent text-ground" : "bg-raised text-muted"}`}>{n}{pulsado[i] && <span className="sr-only">, {t.presionado}</span>}</li>)}
              </ul>
            </div>
            <div className="flex flex-col gap-3">
              <h3 className="t-label">{t.palancas}</h3>
              {[t.izq, t.der].map((n, i) => {
                const x = mando.ejes[i * 2] ?? 0;
                const y = mando.ejes[i * 2 + 1] ?? 0;
                return (
                  <div key={n} className="flex items-center gap-4">
                    <svg aria-hidden="true" viewBox="-50 -50 100 100" className="w-20"><circle r={46} strokeWidth={2} className="fill-raised stroke-line" /><path d="M-46 0H46M0-46V46" strokeWidth={1} className="stroke-line" /><circle cx={x * 34} cy={y * 34} r={11} className="fill-accent" /></svg>
                    <p><span className="t-label block">{n}</span><span className="t-data text-muted">X {x.toFixed(2)}<br />Y {y.toFixed(2)}</span></p>
                  </div>
                );
              })}
              <p className="mt-auto flex items-baseline justify-between gap-4"><span className="t-label">{t.frecuencia}</span><span className="font-mono text-xl font-bold">{mando.hz ? `${mando.hz} Hz` : "--"}</span></p>
              <p className="t-label font-normal text-muted">{t.mueve}</p>
            </div>
          </div>
          <p>{mando.estandar ? t.mandoBien : t.noEstandar}</p>
        </>
      )}
    </section>
  );
}

export default function Prueba() {
  return (
    <Pagina requiere={[]}>
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-2"><h1 className="t-heading">{t.titulo}</h1><p className="max-w-[65ch] text-muted">{t.texto}</p></div>
        <div className="grid items-start gap-6 lg:grid-cols-2"><Conexion /><Mando /></div>
        <section aria-labelledby="tips" className="flex flex-col gap-4">
          <h2 id="tips" className="t-title">{t.consejos}</h2>
          <dl className="divide-y divide-raised border-y border-raised">{t.lista.map(([a, b]) => <div key={a} className="grid gap-x-6 gap-y-1 py-4 md:grid-cols-[320px_1fr]"><dt className="font-semibold">{a}</dt><dd className="text-muted">{b}</dd></div>)}</dl>
        </section>
        <div className="flex flex-wrap items-center gap-6"><Enlace href="/comprar" className="max-sm:w-full">{t.listo}</Enlace></div>
      </div>
    </Pagina>
  );
}
