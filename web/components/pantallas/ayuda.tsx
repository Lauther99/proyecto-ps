import { Pagina } from "@/components/marco";
import { P } from "@/data/textos-publico";

const t = P.ayuda;

export default function Ayuda() {
  return (
    <Pagina requiere={[]}>
      <div className="grid gap-10 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="flex flex-col gap-2"><h1 className="t-heading">{t.titulo}</h1><p className="text-muted">{t.texto}</p></div>
        <div className="flex max-w-[70ch] flex-col gap-10">
          <div className="divide-y divide-raised border-y border-raised">
            {t.faq.map(([a, b]) => (
              <details key={a} className="group py-2">
                <summary className="flex min-h-12 items-center justify-between gap-4 font-semibold marker:content-none">{a}<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 group-open:rotate-180"><path d="M5 9l7 7 7-7" /></svg></summary>
                <p className="pb-4 text-muted">{b}</p>
              </details>
            ))}
          </div>
          <section className="flex flex-col gap-2"><h2 className="t-title">{t.contacto}</h2><p className="text-muted">{t.contactoTexto}</p></section>
        </div>
      </div>
    </Pagina>
  );
}
