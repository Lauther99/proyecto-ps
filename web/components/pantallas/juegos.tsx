"use client";
import { Icono } from "@/components/icono";
import { Pagina } from "@/components/marco";
import { Enlace, Estado, Mensaje } from "@/components/ui";
import { P } from "@/data/textos-publico";
import { useVista } from "@/lib/vista";

const t = P.juegos;
const TONO = { available: "bien", soon: "pausa", unavailable: "apagado" } as const;

function Dibujo({ filas, apagado }: { filas: string[]; apagado: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 8 8" className={`w-2/5 ${apagado ? "fill-line" : "fill-ink"}`}>
      {filas.flatMap((f, y) => [...f].map((c, x) => c === "X" && <rect key={`${x}-${y}`} x={x + 0.06} y={y + 0.06} width={0.88} height={0.88} rx={0.12} />))}
    </svg>
  );
}

function Contenido() {
  const { sitio, salaUrl } = useVista();
  const juegos = sitio.datos?.games ?? [];
  if (!juegos.length) return <Mensaje titulo={t.vacio} texto={t.vacioTexto} />;
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2"><h1 className="t-heading">{t.titulo}</h1><p className="text-muted">{t.texto}</p></div>
        <Enlace href={salaUrl} className="max-sm:w-full">{t.accion}</Enlace>
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-3 lg:gap-x-6">
        {juegos.map((j) => (
          <li key={j.id} className="flex min-w-0 flex-col gap-3">
            <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-surface">{j.art ? <Dibujo filas={j.art} apagado={j.status !== "available"} /> : <Icono nombre="mando" t={56} className={j.status === "available" ? "" : "text-line"} />}</div>
            <div><h2 className="t-title text-pretty">{j.name}</h2><p className="text-muted">{j.genre}. {t.jugadores(j.players)}</p></div>
            <div><Estado tono={TONO[j.status]}>{t.estados[j.status]}</Estado></div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Juegos() {
  return <Pagina requiere={["sitio"]}><Contenido /></Pagina>;
}
