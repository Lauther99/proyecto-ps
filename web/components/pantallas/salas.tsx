"use client";
import { Pagina } from "@/components/marco";
import { Directo, EstadoConsola } from "@/components/sala";
import { Enlace, Mensaje } from "@/components/ui";
import { T } from "@/data/textos";
import { P } from "@/data/textos-publico";
import { espera } from "@/lib/config";
import { useVista } from "@/lib/vista";

const t = P.salas;

// Por ahora hay una sola sala en vivo (una consola).
function Contenido() {
  const { sitio, sala, consola, conTurno, cola, esperaNueva, sinEstimar, salaUrl } = useVista();
  const s = sitio.datos?.rooms[0];
  if (!s) return <Mensaje titulo={t.vacio} texto={t.vacioTexto} />;
  const jugador = conTurno ? T.sala.tu : (sala?.current?.name ?? t.nadie);
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2"><h1 className="t-heading">{t.titulo}</h1><p className="text-muted">{t.texto}</p></div>
      <ul className="flex flex-col gap-6">
        <li className="grid overflow-hidden rounded-md bg-surface lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <Directo />
          <div className="flex flex-col justify-between gap-6 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="t-heading">{s.name}</h2><EstadoConsola consola={consola} /></div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
              {[[t.consola, s.console], [t.juego, s.game || "-"], [T.sala.juega, jugador], [T.sala.enCola, String(cola.length)], [T.sala.espera, sinEstimar ? T.sala.pausa : espera(esperaNueva)]].map(([k, v]) => (
                <div key={k} className="min-w-0"><dt className="t-label text-muted">{k}</dt><dd className="font-semibold break-words">{v}</dd></div>
              ))}
            </dl>
            <Enlace href={salaUrl} className="self-start max-sm:w-full">{t.entrar}</Enlace>
          </div>
        </li>
      </ul>
    </div>
  );
}

export default function Salas() {
  return <Pagina><Contenido /></Pagina>;
}
