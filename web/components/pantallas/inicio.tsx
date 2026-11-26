"use client";
import { EstadoGeneral, Pagina } from "@/components/marco";
import { Cifras, Directo, EstadoConsola, Turno } from "@/components/sala";
import { Corazon, Enlace, EnlaceTexto } from "@/components/ui";
import { T } from "@/data/textos";
import { bloquesDe, creditosDe, soles } from "@/lib/config";
import { useSistema } from "@/lib/sistema";
import { useVista } from "@/lib/vista";

function Vivo() {
  const { consola, info } = useVista();
  return (
    <section aria-label={info.name} className="-mx-4 grid overflow-hidden bg-surface md:mx-0 md:rounded-md xl:grid-cols-[minmax(0,1fr)_400px]">
      <Directo />
      <div className="flex flex-col justify-between gap-6 p-4 py-6 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="t-heading">{info.name}</h2><EstadoConsola consola={consola} /></div>
        <Turno grande encender />
        <Cifras />
      </div>
    </section>
  );
}

export default function Inicio() {
  const t = T.inicio;
  const { precio, sitio } = useSistema();
  const sala = sitio.datos?.rooms[0];
  return (
    <Pagina requiere={[]}>
      <div className="flex flex-col gap-20 md:gap-28">
        <div className="flex flex-col gap-6 md:gap-8">
          <section className="flex flex-col gap-6 pt-4 lg:flex-row lg:items-end lg:justify-between">
            {/* <h1 className="t-display">{t.titulo[0]}<br />{t.titulo[1]}</h1> */}
              {/* <div className="flex max-w-[464px] flex-col gap-4">
                <p className="text-muted">{t.texto(precio)}</p>
                <div className="flex flex-col gap-x-6 gap-y-2 sm:flex-row sm:items-center">
                  <Enlace href={sala ? `/sala?id=${encodeURIComponent(sala.id)}` : "/salas"}>{t.accion}</Enlace>
                  <EnlaceTexto href="#como" className="justify-center">{t.como}</EnlaceTexto>
                </div>
              </div> */}
          </section>
          <EstadoGeneral requiere={["sitio", "sala"]}><Vivo /></EstadoGeneral>
        </div>

        {/* <section id="como" aria-labelledby="como-t" className="grid scroll-mt-8 gap-8 lg:grid-cols-[400px_1fr]">
          <h2 id="como-t" className="t-heading">{t.pasosTitulo}</h2>
          <ol className="flex flex-col divide-y divide-raised border-y border-raised">
            {t.pasos(precio).map(([tit, tex], i) => (
              <li key={tit} className="grid grid-cols-[40px_1fr] gap-x-2 gap-y-1 py-6 md:grid-cols-[40px_220px_1fr]">
                <span className="font-mono text-xl leading-7 font-bold text-accent">{i + 1}</span>
                <h3 className="t-title">{tit}</h3>
                <p className="col-start-2 max-w-[52ch] text-muted md:col-start-3">{tex}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="precio-t" className="flex flex-col gap-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-2"><h2 id="precio-t" className="t-heading">{t.preciosTitulo(precio)}</h2><p className="text-muted">{t.preciosTexto}</p></div>
            <EnlaceTexto href="/precios">{t.verPrecios}</EnlaceTexto>
          </div>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-10 lg:grid-cols-4">
            {bloquesDe(precio).map((m) => (
              <li key={m} className="flex flex-col gap-4">
                <div className="flex h-28 flex-wrap content-end items-end gap-2">{Array.from({ length: m / precio.blockMinutes }, (_, i) => <Corazon key={i} decorativo className="w-16" />)}</div>
                <p><span className="t-score block">{T.comprar.minutos(m)}</span><span className="text-muted">{soles(creditosDe(precio, m))}, {T.comprar.creditos(creditosDe(precio, m))}</span></p>
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-12 md:grid-cols-2 md:gap-8">
          {[[t.conexionTitulo, t.conexionTexto, t.conexionAccion, "/prueba"], [t.devolucionTitulo, t.devolucionTexto, t.devolucionAccion, "/reembolsos"]].map(([a, b, c, h]) => (
            <section key={h} className="flex max-w-[52ch] flex-col items-start gap-2"><h2 className="t-heading">{a}</h2><p className="text-muted">{b}</p><EnlaceTexto href={h}>{c}</EnlaceTexto></section>
          ))}
        </div> */}
      </div>
    </Pagina>
  );
}
