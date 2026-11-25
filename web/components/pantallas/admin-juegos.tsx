"use client";
import { ErrorAccion } from "@/components/marco";
import { Carga, PaginaAdmin } from "@/components/pagina-admin";
import { Tabla } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { P } from "@/data/textos-publico";
import { updateGame, type Game, type GameStatus } from "@/lib/api";
import { useAccion, useDatos } from "@/lib/datos";

const t = A.juegos;
const ESTADOS = Object.keys(P.juegos.estados) as GameStatus[];

function Contenido() {
  const { datos, error, recargar } = useDatos<{ games: Game[] }>("/api/admin/games");
  const accion = useAccion();
  const cambiar = async (id: string, estado: GameStatus) => {
    await accion.ejecutar(() => updateGame(id, estado));
    recargar();
  };
  return (
    <>
      <ErrorAccion>{accion.error}</ErrorAccion>
      <Carga datos={datos} error={error} recargar={recargar}>
        {(d) => <Tabla titulo={t.titulo} columnas={t.columnas} vacio={t.vacio} filas={d.games.map((j) => ({
          id: j.id,
          celdas: [
            <strong key="n" className="font-semibold">{j.name}</strong>, j.genre, <span key="j" className="font-mono">{j.players}</span>,
            <select key="e" aria-label={t.cambiar(j.name)} disabled={accion.ocupado} value={j.status} onChange={(e) => void cambiar(j.id, e.target.value as GameStatus)} className="min-h-11 rounded-md border border-line bg-raised px-3 text-ink">
              {ESTADOS.map((k) => <option key={k} value={k}>{P.juegos.estados[k]}</option>)}
            </select>,
          ],
        }))} />}
      </Carga>
    </>
  );
}

export default function JuegosAdmin() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
