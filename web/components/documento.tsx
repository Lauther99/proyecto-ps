"use client";
import { P } from "@/data/textos-publico";
import { Pagina } from "./marco";
import { Aviso } from "./ui";

export function Documento({ cual }: { cual: keyof typeof P.documentos }) {
  const d = P.documentos[cual];
  return (
    <Pagina requiere={[]}>
      <article className="flex flex-col gap-8">
        <div className="flex flex-col gap-2"><h1 className="t-heading">{d.titulo}</h1><p className="t-data text-muted">{P.actualizado}</p></div>
        <div className="max-w-[70ch]"><Aviso tono="neutro">{P.plantilla}</Aviso></div>
        <div className="grid gap-10 lg:grid-cols-[260px_minmax(0,1fr)]">
          <nav aria-label={P.indice} className="lg:sticky lg:top-8 lg:self-start">
            <p className="t-label text-muted">{P.indice}</p>
            <ul>{d.secciones.map(([a], i) => <li key={a}><a href={`#s${i + 1}`} className="flex min-h-11 items-center hover:text-accent">{a}</a></li>)}</ul>
          </nav>
          <div className="flex max-w-[70ch] flex-col gap-10">
            {d.secciones.map(([a, b], i) => <section key={a} id={`s${i + 1}`} className="flex scroll-mt-8 flex-col gap-2"><h2 className="t-title">{a}</h2><p className="text-muted">{b}</p></section>)}
          </div>
        </div>
      </article>
    </Pagina>
  );
}
