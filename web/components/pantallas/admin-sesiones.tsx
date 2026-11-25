"use client";
import { Carga, PaginaAdmin } from "@/components/pagina-admin";
import { Tabla } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { C } from "@/data/textos-cuenta";
import type { AdminSession } from "@/lib/api";
import { fecha, minutos } from "@/lib/config";
import { useDatos } from "@/lib/datos";

const t = A.sesiones;

function Contenido() {
  const { datos, error, recargar } = useDatos<{ sessions: AdminSession[] }>("/api/admin/sessions");
  return (
    <Carga datos={datos} error={error} recargar={recargar}>
      {(d) => <Tabla titulo={t.titulo} columnas={t.columnas} vacio={t.vacio} filas={d.sessions.map((s) => ({ id: s.id, celdas: [fecha(s.startedAt), s.nickname, s.game || "-", minutos(s.playedMs), s.refundedCredits ? `${s.chargedCredits} (-${s.refundedCredits})` : s.chargedCredits, C.resultados[s.result]] }))} />}
    </Carga>
  );
}

export default function Sesiones() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
