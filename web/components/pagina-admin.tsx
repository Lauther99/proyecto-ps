"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { A } from "@/data/textos-admin";
import { T } from "@/data/textos";
import type { AdminSummary } from "@/lib/api";
import { SITIO } from "@/lib/config";
import { useDatos } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";
import { EstadoGeneral, PedirCuenta, SinConexion } from "./marco";
import { Boton, Enlace, Mensaje } from "./ui";

/** Error al cargar, espera o contenido, para las secciones que piden datos. */
export function Carga<D>({ datos, error, recargar, children }: { datos: D | null; error: string | null; recargar: () => void; children: (d: D) => ReactNode }) {
  if (datos) return children(datos);
  if (error) return <div className="flex flex-col items-start gap-4 rounded-md bg-surface p-6"><p role="alert">{error}</p><Boton variante="secundario" onClick={recargar}>{T.comun.reintentar}</Boton></div>;
  return <div role="status" aria-label={T.comun.cargando} className="pulso h-48 rounded-md bg-surface" />;
}

// El backend vuelve a comprobar el permiso en cada llamada; aquí solo se evita mostrar el panel.
function SoloAdmin({ children }: { children: ReactNode }) {
  const { sesion } = useSistema();
  const yo = sesion.datos?.user;
  if (!yo) return <PedirCuenta />;
  if (yo.role !== "admin") return <Mensaje titulo={A.soloAdmin} texto={A.soloAdminTexto}><Enlace href="/">{T.comun.volverInicio}</Enlace></Mensaje>;
  return children;
}

export function PaginaAdmin({ titulo, children }: { titulo: string; children: ReactNode }) {
  const ruta = usePathname();
  const { sesion } = useSistema();
  const admin = sesion.datos?.user?.role === "admin";
  const { datos } = useDatos<AdminSummary>(admin ? "/api/admin/summary" : null);
  const pendientes = datos?.pendingRecharges ?? 0;
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[232px_minmax(0,1fr)]">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-ink focus:p-3 focus:text-ground">{T.comun.saltar}</a>
      <div className="flex flex-col bg-surface lg:sticky lg:top-0 lg:h-dvh lg:p-4">
        <div className="flex items-center justify-between gap-4 px-4 py-3 lg:flex-col lg:items-start lg:gap-0 lg:px-3">
          <p className="font-display text-[17px] leading-6 font-extrabold whitespace-nowrap">{SITIO.nombre}</p>
          <Link prefetch={false} href="/" className="t-label inline-flex min-h-11 items-center text-muted hover:text-ink">{A.sitio}</Link>
        </div>
        {admin && (
          <nav aria-label={A.menu} className="flex gap-1 overflow-x-auto px-2 pb-2 lg:flex-col lg:p-0">
            {A.nav.map(([n, h]) => (
              <Link prefetch={false} key={h} href={h} aria-current={ruta === h ? "page" : undefined} className="t-label flex min-h-11 shrink-0 items-center justify-between gap-2 rounded-md px-3 -outline-offset-3 hover:bg-raised aria-[current=page]:bg-accent-deep">
                {n}{h === "/admin/recargas" && pendientes > 0 && <span className="rounded-full bg-accent px-2 font-mono text-ground">{pendientes}</span>}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <div className="min-w-0">
        <SinConexion />
        <main id="contenido" className="mx-auto flex max-w-[1080px] flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
          <h1 className="t-heading">{titulo}</h1>
          <EstadoGeneral requiere={["sitio", "sesion"]}><SoloAdmin>{children}</SoloAdmin></EstadoGeneral>
        </main>
      </div>
    </div>
  );
}
