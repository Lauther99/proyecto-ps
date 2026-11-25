"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import { T } from "@/data/textos";
import { DEMO, acceptTurn, devLogin, loginUrl, request } from "@/lib/api";
import { SITIO, espera, reloj } from "@/lib/config";
import { useAccion } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";
import { useVista } from "@/lib/vista";
import { Icono } from "./icono";
import { Boton, Campo, Enlace, Mensaje, Modal } from "./ui";

const CONTENEDOR = "mx-auto w-full max-w-[1216px] px-4 md:px-8";

/** Error de una acción, junto al botón que la lanzó. */
export function ErrorAccion({ children }: { children: string | null }) {
  return (
    children && (
      <p role="alert" className="flex items-center gap-2 t-label text-warn">
        <Icono nombre="alerta" t={20} className="shrink-0" />
        {children}
      </p>
    )
  );
}

/** Login de desarrollo: el backend solo lo activa en localhost. */
function AccesoPrueba({ alEntrar }: { alEntrar: () => void }) {
  const [correo, setCorreo] = useState("");
  const [nombre, setNombre] = useState("");
  const { ocupado, error, ejecutar } = useAccion();
  const { refrescar } = useSistema();
  return (
    <form
      className="flex flex-col gap-3 border-t border-raised pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (
          await ejecutar(async () => {
            await devLogin(correo, nombre);
            await refrescar();
          })
        )
          alEntrar();
      }}
    >
      <p className="t-label">{T.acceso.prueba}</p>
      <Campo
        id="dev-correo"
        type="email"
        required
        etiqueta={T.acceso.correo}
        value={correo}
        onChange={(e) => setCorreo(e.target.value)}
      />
      <Campo
        id="dev-nombre"
        required
        etiqueta={T.acceso.nombre}
        value={nombre}
        onChange={(e) => setNombre(e.target.value)}
      />
      <Boton type="submit" variante="secundario" disabled={ocupado}>
        {T.acceso.entrarPrueba}
      </Boton>
      <ErrorAccion>{error}</ErrorAccion>
    </form>
  );
}

function Acceso({
  abierto,
  alCerrar,
}: {
  abierto: boolean;
  alCerrar: () => void;
}) {
  const { sesion, refrescar } = useSistema();
  const entrar = async () => {
    if (DEMO) {
      await request("/api/auth/demo", "POST");
      await refrescar();
      alCerrar();
    } else
      window.location.assign(
        loginUrl(window.location.pathname + window.location.search),
      );
  };
  return (
    <Modal abierto={abierto} alCerrar={alCerrar} titulo={T.acceso.titulo}>
      <p className="text-muted">{T.acceso.texto}</p>
      <Boton onClick={() => void entrar()}>{T.acceso.boton}</Boton>
      <p className="text-muted">{T.acceso.nota}</p>
      <p className="t-label text-muted">
        {T.acceso.terminos}{" "}
        <Link prefetch={false} href="/terminos" className="text-ink underline">
          {T.acceso.enlace}
        </Link>
        .
      </p>
      {sesion.datos?.devLogin && abierto && (
        <AccesoPrueba alEntrar={alCerrar} />
      )}
    </Modal>
  );
}

export function BotonAcceso({
  children = T.comun.entrar,
  variante = "principal",
  className,
}: {
  children?: ReactNode;
  variante?: "principal" | "secundario";
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Boton
        variante={variante}
        className={className}
        onClick={() => setAbierto(true)}
      >
        {children}
      </Boton>
      <Acceso abierto={abierto} alCerrar={() => setAbierto(false)} />
    </>
  );
}

function Cabecera() {
  const { sesion } = useSistema();
  const [menu, setMenu] = useState(false);
  const ruta = usePathname();
  const yo = sesion.datos?.user;
  return (
    <header
      className={`${CONTENEDOR} flex min-h-[72px] items-center justify-between gap-3 md:min-h-[88px]`}
    >
      <Link
        href="/"
        className="font-display text-[15px] leading-6 min-[360px]:text-[17px] font-extrabold whitespace-nowrap sm:text-[22px] lg:text-[28px]"
      >
        {SITIO.nombre}
      </Link>
      <div className="flex items-center gap-1 min-[360px]:gap-2 lg:gap-8">
        <nav aria-label={T.comun.principal} className="hidden gap-8 lg:flex">
          {T.comun.nav.map(([n, h]) => (
            <Link
              prefetch={false}
              key={h}
              href={h}
              aria-current={ruta === h ? "page" : undefined}
              className="t-label inline-flex min-h-11 items-center hover:text-accent aria-[current=page]:text-accent"
            >
              {n}
            </Link>
          ))}
        </nav>
        {yo ? (
          <Link
            prefetch={false}
            href="/cuenta"
            aria-label={T.comun.saldoAria(yo.balance.available)}
            className="pulsable inline-flex min-h-11 items-center gap-2 rounded-md bg-surface px-3 t-label whitespace-nowrap hover:bg-raised sm:px-4"
          >
            <span className="font-mono font-bold">{yo.balance.available}</span>
            <span className="hidden sm:inline">
              {T.comun.saldo(yo.balance.available).replace(/^\d+ /, "")}
            </span>
            <span className="max-[359px]:hidden sm:hidden">
              {T.comun.saldoCorto}
            </span>
          </Link>
        ) : (
          sesion.datos && (
            <BotonAcceso
              variante="secundario"
              className="!min-h-11 !px-4 whitespace-nowrap"
            >
              <span className="sm:hidden">{T.comun.entrarCorto}</span>
              <span className="hidden sm:inline">{T.comun.entrar}</span>
            </BotonAcceso>
          )
        )}
        <button
          type="button"
          aria-label={T.comun.menu}
          aria-expanded={menu}
          onClick={() => setMenu(true)}
          className="pulsable grid size-11 place-items-center rounded-md hover:bg-raised lg:hidden"
        >
          <Icono nombre="menu" />
        </button>
      </div>
      <Modal
        abierto={menu}
        alCerrar={() => setMenu(false)}
        titulo={SITIO.nombre}
      >
        <nav aria-label={T.comun.principal} className="flex flex-col">
          {[...T.comun.nav, ...T.comun.legales].map(([n, h], i) => (
            <Link
              prefetch={false}
              key={h}
              href={h}
              onClick={() => setMenu(false)}
              className={`flex min-h-12 items-center hover:text-accent ${i < T.comun.nav.length ? "t-title" : "text-muted"}`}
            >
              {n}
            </Link>
          ))}
        </nav>
      </Modal>
    </header>
  );
}

/** Acepta el turno y lleva a la partida. */
export function useAceptar() {
  const router = useRouter();
  const { refrescar } = useSistema();
  const { ocupado, error, ejecutar } = useAccion();
  const aceptar = async () => {
    if (await ejecutar(acceptTurn)) {
      void refrescar();
      router.push("/jugar");
    }
  };
  return { ocupado, error, aceptar };
}

/** Barra fija que acompaña a quien está en la cola o tiene que aceptar, fuera de la sala. */
function BarraTurno() {
  const { usuario, cola, miPuesto, ofertaMs, sinEstimar, salaUrl } = useVista();
  const { ocupado, error, aceptar } = useAceptar();
  if (usuario === "turnoOfrecido")
    return (
      <div className="sobre-acento sticky bottom-0 z-20 bg-accent text-ground">
        <div
          className={`${CONTENEDOR} flex items-center justify-between gap-4 py-3`}
        >
          <p className="t-title">
            <span role="alert">{error ?? T.accion.turnoOfrecido(0)[0]}</span>{" "}
            <span role="timer" className="ml-2 font-mono">
              {reloj(ofertaMs)}
            </span>
          </p>
          <Boton
            variante="inverso"
            disabled={ocupado}
            onClick={() => void aceptar()}
          >
            {T.accion.aceptar}
          </Boton>
        </div>
      </div>
    );
  if (usuario === "enCola")
    return (
      <div className="sticky bottom-0 z-20 border-t border-raised bg-surface">
        <div
          className={`${CONTENEDOR} flex items-center justify-between gap-4 py-3`}
        >
          <p className="t-label">
            {T.accion.posicion(miPuesto + 1)}
            <span className="ml-3 font-mono font-normal text-muted">
              {sinEstimar ? T.sala.pausa : espera(cola[miPuesto].en)}
            </span>
          </p>
          <Enlace
            href={salaUrl}
            variante="secundario"
            className="!min-h-11 !px-4"
          >
            {T.accion.irSala}
          </Enlace>
        </div>
      </div>
    );
  return null;
}

function Esqueleto() {
  return (
    <div
      role="status"
      aria-label={T.comun.cargando}
      className="grid gap-8 py-8 md:grid-cols-[1fr_360px]"
    >
      <div className="pulso flex flex-col gap-4">
        <div className="h-12 w-2/3 rounded-md bg-surface" />
        <div className="aspect-video rounded-md bg-surface" />
      </div>
      <div className="pulso flex flex-col gap-4">
        <div className="h-40 rounded-md bg-surface" />
        <div className="h-64 rounded-md bg-surface" />
      </div>
    </div>
  );
}

export type Requisito = "sitio" | "sesion" | "sala";

/** Espera lo que la pantalla necesita; si falla, deja reintentar. */
export function EstadoGeneral({
  requiere,
  children,
}: {
  requiere: Requisito[];
  children: ReactNode;
}) {
  const { sitio, sesion, sala, salaError, reintentar } = useSistema();
  const error =
    (requiere.includes("sitio") && sitio.error) ||
    (requiere.includes("sesion") && sesion.error) ||
    (requiere.includes("sala") && !sala && (salaError || sesion.error));
  if (error)
    return (
      <Mensaje titulo={T.comun.errorTitulo} texto={T.comun.errorTexto}>
        <Boton onClick={reintentar}>{T.comun.reintentar}</Boton>
      </Mensaje>
    );
  if (
    (requiere.includes("sitio") && !sitio.datos) ||
    (requiere.includes("sesion") && !sesion.datos) ||
    (requiere.includes("sala") && !sala)
  )
    return <Esqueleto />;
  return children;
}

export function SinConexion() {
  const { enLinea, conectada, sala } = useSistema();
  // Sin internet, o se cortó la sala después de haberla tenido.
  if (enLinea && (conectada || !sala)) return null;
  return (
    <p
      role="alert"
      className="flex items-center justify-center gap-2 bg-warn px-4 py-2 t-label text-ground"
    >
      <Icono nombre="nube" t={20} className="shrink-0" />
      {T.comun.sinConexion}
    </p>
  );
}

const sinCambios = () => () => undefined;

/** El login con Google no terminó: el backend vuelve con ?login_error=... */
function ErrorLogin() {
  const error = useSyncExternalStore(sinCambios, () => new URLSearchParams(window.location.search).has("login_error"), () => false);
  return error && <p role="alert" className="flex items-center justify-center gap-2 bg-warn px-4 py-2 t-label text-ground"><Icono nombre="alerta" t={20} className="shrink-0" />{T.acceso.fallo}</p>;
}

/** Para pantallas con cuenta: si nadie entró, invita a hacerlo. */
export function PedirCuenta() {
  return (
    <div className="flex max-w-md flex-col gap-4 rounded-md bg-surface p-6">
      <p className="t-title">{T.acceso.titulo}</p>
      <p className="text-muted">{T.acceso.texto}</p>
      <BotonAcceso />
    </div>
  );
}

export function Pagina({
  children,
  barra = true,
  requiere = ["sitio", "sesion", "sala"],
}: {
  children: ReactNode;
  barra?: boolean;
  requiere?: Requisito[];
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-ink focus:p-3 focus:text-ground"
      >
        {T.comun.saltar}
      </a>
      <SinConexion />
      <ErrorLogin />
      <Cabecera />
      <main id="contenido" className={`${CONTENEDOR} flex-1 pb-16`}>
        <EstadoGeneral requiere={requiere}>{children}</EstadoGeneral>
      </main>
      <footer className="border-t border-raised">
        <div
          className={`${CONTENEDOR} flex flex-wrap items-center justify-between gap-x-8 gap-y-2 py-6`}
        >
          <p className="t-label text-muted">{SITIO.nombre}</p>
          <nav aria-label={T.comun.pie} className="flex flex-wrap gap-x-6">
            {T.comun.legales.map(([n, h]) => (
              <Link
                prefetch={false}
                key={h}
                href={h}
                className="t-label inline-flex min-h-11 items-center text-muted hover:text-ink"
              >
                {n}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
      {barra && <BarraTurno />}
    </div>
  );
}
