"use client";
import Link from "next/link";
import {
  useEffect,
  useRef,
  type ComponentProps,
  type CSSProperties,
  type ReactNode,
} from "react";
import { T } from "@/data/textos";
import { Icono, type NombreIcono } from "./icono";

const VARIANTES = {
  principal:
    "bg-accent text-ground hover:bg-[#66b4ff] disabled:bg-raised disabled:text-muted",
  secundario:
    "border border-line text-ink hover:bg-raised disabled:text-muted disabled:border-raised",
  inverso: "bg-ground text-ink hover:bg-raised",
  inversoSuave: "border-2 border-ground text-ground hover:bg-ground/10",
  peligro: "border border-warn text-warn hover:bg-raised",
};
const BASE =
  "pulsable inline-flex min-h-12 items-center justify-center gap-2 rounded-md px-6 t-label text-center no-underline";
type Variante = keyof typeof VARIANTES;

export function Boton({
  variante = "principal",
  className = "",
  ...p
}: ComponentProps<"button"> & { variante?: Variante }) {
  return (
    <button
      type="button"
      className={`${BASE} ${VARIANTES[variante]} ${className}`}
      {...p}
    />
  );
}
export function Enlace({
  variante = "principal",
  className = "",
  ...p
}: ComponentProps<typeof Link> & { variante?: Variante }) {
  return (
    <Link
      prefetch={false}
      className={`${BASE} ${VARIANTES[variante]} ${className}`}
      {...p}
    />
  );
}
export function EnlaceTexto({
  className = "",
  ...p
}: ComponentProps<typeof Link>) {
  return (
    <Link
      prefetch={false}
      className={`t-label inline-flex min-h-11 items-center underline hover:text-accent ${className}`}
      {...p}
    />
  );
}

const TONOS = {
  bien: "bg-ink text-ground",
  neutro: "bg-raised text-ink",
  apagado: "border border-line text-muted",
  pausa: "border border-dashed border-line text-ink",
  aviso: "border border-warn text-warn",
};
export function Estado({
  tono,
  icono,
  children,
}: {
  tono: keyof typeof TONOS;
  icono?: NombreIcono;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-3 py-1 t-label ${TONOS[tono]}`}
    >
      {icono && <Icono nombre={icono} t={16} />}
      {children}
    </span>
  );
}

const MAPA = [
  ".XX..XX.",
  "XooXXXXX",
  "XXXXXXXX",
  ".XXXXXX.",
  "..XXXX..",
  "...XX...",
];
const PIXELES = (() => {
  let n = 0;
  return MAPA.flatMap((fila, y) =>
    [...fila].map((c, x) => ({ x, y, c, n: c === "X" ? n++ : n })),
  ).filter((p) => p.c !== ".");
})();

/** 30 píxeles azules: uno por minuto (en un bloque de 30). Con más de un bloque muestra el que corre. */
export function Corazon({
  minutos = 30,
  bloque = 30,
  className = "",
  encender = false,
  decorativo = false,
}: {
  minutos?: number;
  bloque?: number;
  className?: string;
  encender?: boolean;
  decorativo?: boolean;
}) {
  const enBloque = minutos <= 0 ? 0 : ((minutos - 1) % bloque) + 1;
  const vivos = Math.round((enBloque / bloque) * 30);
  const a11y = decorativo
    ? { "aria-hidden": true }
    : { role: "img", "aria-label": T.comun.corazon(minutos) };
  return (
    <svg
      viewBox="0 0 8 6"
      className={`${encender ? "encender" : ""} ${className}`}
      {...a11y}
    >
      {PIXELES.map(({ x, y, c, n }, i) => (
        <rect
          key={i}
          x={x + 0.06}
          y={y + 0.06}
          width={0.88}
          height={0.88}
          rx={0.12}
          style={{ "--i": i } as CSSProperties}
          className={
            n < 30 - vivos
              ? "fill-raised"
              : c === "o"
                ? "fill-ink"
                : "fill-accent"
          }
        />
      ))}
    </svg>
  );
}

export function Modal({
  abierto,
  alCerrar,
  titulo,
  children,
}: {
  abierto: boolean;
  alCerrar: () => void;
  titulo: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (abierto && !d?.open) d?.showModal();
    if (!abierto && d?.open) d.close();
  }, [abierto]);
  return (
    <dialog
      ref={ref}
      onClose={alCerrar}
      onClick={(e) => e.target === e.currentTarget && alCerrar()}
      aria-label={titulo}
      className="modal w-[calc(100%-32px)] max-w-md rounded-md bg-surface p-0 text-ink"
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="t-title pt-2">{titulo}</h2>
          <button
            type="button"
            onClick={alCerrar}
            aria-label={T.comun.cerrar}
            className="pulsable -mr-2 grid size-11 shrink-0 place-items-center rounded-md hover:bg-raised"
          >
            <Icono nombre="x" />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

export function Aviso({
  titulo,
  children,
  tono = "aviso",
}: {
  titulo?: string;
  children: ReactNode;
  tono?: "aviso" | "neutro";
}) {
  return (
    <div
      role="status"
      className={`flex gap-3 rounded-md p-4 ${tono === "aviso" ? "border border-warn" : "bg-raised"}`}
    >
      <Icono
        nombre={tono === "aviso" ? "alerta" : "info"}
        className={`shrink-0 ${tono === "aviso" ? "text-warn" : ""}`}
      />
      <div className="flex min-w-0 flex-col gap-1">
        {titulo && <p className="t-label">{titulo}</p>}
        <div className="text-muted">{children}</div>
      </div>
    </div>
  );
}

export function Mensaje({
  titulo,
  texto,
  children,
}: {
  titulo: string;
  texto: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-20 text-center">
      <Corazon minutos={0} decorativo className="w-24" />
      <h1 className="t-heading">{titulo}</h1>
      <p className="text-muted">{texto}</p>
      {children}
    </div>
  );
}

const CAMPO =
  "min-h-12 w-full rounded-md border border-line bg-raised px-4 text-ink placeholder:text-muted aria-invalid:border-2 aria-invalid:border-warn";
export function Campo({
  etiqueta,
  id,
  ayuda,
  error,
  ...p
}: ComponentProps<"input"> & {
  etiqueta: string;
  id: string;
  ayuda?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="t-label">
        {etiqueta}
      </label>
      <input
        id={id}
        aria-invalid={!!error}
        aria-describedby={error || ayuda ? `${id}-a` : undefined}
        className={CAMPO}
        {...p}
      />
      {error ? (
        <p
          id={`${id}-a`}
          role="alert"
          className="flex items-center gap-2 t-label text-warn"
        >
          <Icono nombre="alerta" t={20} className="shrink-0" />
          {error}
        </p>
      ) : (
        ayuda && (
          <p id={`${id}-a`} className="t-label text-muted">
            {ayuda}
          </p>
        )
      )}
    </div>
  );
}

/** Tabla en escritorio; en móvil cada fila se apila con su etiqueta. */
export function Tabla({
  titulo,
  columnas,
  filas,
  vacio,
}: {
  titulo: string;
  columnas: string[];
  filas: { id: string; celdas: ReactNode[] }[];
  vacio: string;
}) {
  if (filas.length === 0)
    return <p className="rounded-md bg-surface p-4 text-muted">{vacio}</p>;
  return (
    <table className="block w-full text-left lg:table">
      <caption className="sr-only">{titulo}</caption>
      <thead className="hidden lg:table-header-group">
        <tr>
          {columnas.map((c) => (
            <th key={c} scope="col" className="py-3 pr-4 t-label text-muted">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="block lg:table-row-group">
        {filas.map((f) => (
          <tr
            key={f.id}
            className="block border-t border-raised py-4 lg:table-row lg:py-0"
          >
            {f.celdas.map((c, i) => (
              <td
                key={i}
                className="flex items-center justify-between gap-4 py-1 lg:table-cell lg:py-3 lg:pr-4 lg:align-middle"
              >
                <span className="shrink-0 t-label text-muted lg:hidden">
                  {columnas[i]}
                </span>
                <div className="min-w-0 text-right break-words lg:text-left">
                  {c}
                </div>
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Fila({
  etiqueta,
  children,
}: {
  etiqueta: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted">{etiqueta}</dt>
      <dd className="text-right font-semibold">{children}</dd>
    </div>
  );
}
