"use client";
import { Pagina } from "@/components/marco";
import { Corazon, Enlace, EnlaceTexto } from "@/components/ui";
import { P } from "@/data/textos-publico";
import { bloquesDe, creditosDe, soles } from "@/lib/config";
import { useSistema } from "@/lib/sistema";

const t = P.precios;

function Lista({ id, titulo, filas }: { id: string; titulo: string; filas: string[][] }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="t-title">{titulo}</h2>
      <dl className="divide-y divide-raised border-y border-raised">
        {filas.map(([a, b]) => <div key={a} className="grid gap-x-6 gap-y-1 py-4 sm:grid-cols-[200px_1fr]"><dt className="font-semibold">{a}</dt><dd className="text-muted">{b}</dd></div>)}
      </dl>
    </section>
  );
}

function Contenido() {
  const { precio } = useSistema();
  return (
      <div className="flex flex-col gap-12 md:gap-16">
        <div className="flex flex-col gap-2"><h1 className="t-heading">{t.titulo}</h1><p className="max-w-[60ch] text-muted">{t.texto(precio)}</p></div>
        <div className="flex flex-col items-start gap-6">
          <table className="w-full text-left">
            <caption className="sr-only">{t.tabla}</caption>
            <thead><tr>{t.columnas.map((c, i) => <th key={c} scope="col" className={`pb-3 t-label text-muted ${i > 1 ? "text-right" : ""} ${i === 0 ? "max-sm:sr-only" : ""}`}>{c}</th>)}</tr></thead>
            <tbody>
              {bloquesDe(precio).map((m) => (
                <tr key={m} className="border-t border-raised">
                  <td className="py-5 pr-4 max-sm:hidden"><span className="flex gap-2">{Array.from({ length: m / precio.blockMinutes }, (_, i) => <Corazon key={i} decorativo className="w-10 lg:w-14" />)}</span></td>
                  <th scope="row" className="py-5 font-mono text-xl font-bold whitespace-nowrap lg:text-[28px]">{m} min</th>
                  <td className="py-5 text-right font-mono">{creditosDe(precio, m)}</td>
                  <td className="py-5 text-right font-mono text-xl font-bold whitespace-nowrap">{soles(creditosDe(precio, m))}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Enlace href="/recargar" className="max-sm:w-full">{t.accion}</Enlace>
        </div>
        <div className="grid gap-12 lg:grid-cols-2">
          <Lista id="cobro" titulo={t.cobroTitulo} filas={t.cobro(precio)} />
          <div className="flex flex-col items-start gap-2 *:w-full"><Lista id="dev" titulo={t.devTitulo} filas={t.dev} /><EnlaceTexto href="/reembolsos">{t.masDev}</EnlaceTexto></div>
        </div>
      </div>
  );
}

export default function Precios() {
  return <Pagina requiere={["sitio"]}><Contenido /></Pagina>;
}
