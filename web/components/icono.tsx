/** Juego propio de íconos: trazo de 2 px con puntas redondeadas. */
const TRAZOS = {
  menu: "M4 8h16M4 16h16",
  x: "M6 6l12 12M18 6L6 18",
  check: "M5 12l5 5 9-10",
  reloj: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 7v5l3 2",
  vivo: "M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4M7 7a7 7 0 0 0 0 10M17 7a7 7 0 0 1 0 10",
  alerta: "M12 4L2.5 20h19L12 4M12 10v4M12 17h.01",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18M12 11v5M12 8h.01",
  mando: "M7 7h10a5 5 0 0 1 4.6 7l-1 2.6a2 2 0 0 1-3.4.6L15 15H9l-2.2 2.2a2 2 0 0 1-3.4-.6l-1-2.6A5 5 0 0 1 7 7M7 10v3M5.500 11.500h3M16 11.500h.01M18 10.500h.01",
  volumen: "M4 10v4h3l5 4V6L7 10H4M16 9a4 4 0 0 1 0 6M18.500 6.500a8 8 0 0 1 0 11",
  senal: "M5 20v-3M10 20v-7M15 20V9M20 20V4",
  datos: "M4 19V5M4 19h16M8 15l4-5 3 3 5-7",
  copiar: "M9 9h11v11H9zM5 15H4V4h11v1",
  nube: "M3 3l18 18M8 8a6 6 0 0 0-1 10h10M11 6a6 6 0 0 1 7 5 4 4 0 0 1 2 6",
  girar: "M4 12a8 8 0 0 1 14-5l2 2M20 4v5h-5M20 12a8 8 0 0 1-14 5l-2-2M4 20v-5h5",
  ojo: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6",
};
export type NombreIcono = keyof typeof TRAZOS;

export function Icono({ nombre, t = 24, className = "" }: { nombre: NombreIcono; t?: number; className?: string }) {
  return (
    <svg aria-hidden="true" width={t} height={t} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={TRAZOS[nombre]} />
    </svg>
  );
}
