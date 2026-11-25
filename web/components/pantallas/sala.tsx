"use client";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { Pagina } from "@/components/marco";
import { Accion, Cola, Directo, Turno } from "@/components/sala";
import { Enlace, Mensaje } from "@/components/ui";
import { T } from "@/data/textos";
import { useSistema } from "@/lib/sistema";

function Contenido() {
  const id = useSearchParams().get("id");
  const { sitio } = useSistema();
  const primera = sitio.datos?.rooms[0];
  // Solo hay una sala en vivo; sin id en el enlace se muestra esa.
  const sala = !id || primera?.id === id ? primera : undefined;
  if (!sala) return <Mensaje titulo={T.sala.noExiste} texto={T.sala.noExisteTexto}><Enlace href="/salas">{T.sala.verSalas}</Enlace></Mensaje>;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-8">
      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-wrap items-baseline gap-x-4 lg:order-none">
          <h1 className="t-heading">{sala.name}</h1>
          <p className="text-muted">{[sala.console, sala.game].filter(Boolean).join(", ")}</p>
        </div>
        <Directo className="-mx-4 md:mx-0 md:rounded-md" />
        <div className="hidden lg:block"><Turno /></div>
      </div>
      <div className="flex flex-col gap-6 lg:pt-[60px]">
        <Accion />
        <div className="lg:hidden"><Turno /></div>
        <Cola />
      </div>
    </div>
  );
}

export default function Sala() {
  return <Pagina barra={false}><Suspense><Contenido /></Suspense></Pagina>;
}
