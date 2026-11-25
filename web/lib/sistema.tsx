"use client";
// Estado compartido de toda la web: sesión, configuración y sala en vivo.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { fetchMe, fetchSite, type Site, type User } from "./api";
import { PRECIO_BASE, type Precio } from "./config";
import { RoomClient, type Room, type RoomState } from "./room-client";

type Carga<T> = { datos: T | null; error: boolean };
type Sistema = {
  sitio: Carga<Site>;
  sesion: Carga<{ user: User | null; devLogin: boolean }>;
  sala: RoomState | null;
  salaError: boolean; // nunca logramos conectar con la sala
  conectada: boolean;
  enLinea: boolean;
  desfase: number; // reloj del servidor menos el nuestro
  cliente: Room | null;
  precio: Precio;
  refrescar: () => Promise<void>; // sesión (saldo, avisos)
  reintentar: () => void; // todo lo que falló
};

const Contexto = createContext<Sistema | null>(null);
const ESPERA_SALA_MS = 8000;

const suscribirRed = (f: () => void) => {
  window.addEventListener("online", f);
  window.addEventListener("offline", f);
  return () => {
    window.removeEventListener("online", f);
    window.removeEventListener("offline", f);
  };
};

export function ProveedorSistema({ children }: { children: ReactNode }) {
  const [sitio, setSitio] = useState<Sistema["sitio"]>({ datos: null, error: false });
  const [sesion, setSesion] = useState<Sistema["sesion"]>({ datos: null, error: false });
  const [sala, setSala] = useState<RoomState | null>(null);
  const [desfase, setDesfase] = useState(0);
  const [conectada, setConectada] = useState(false);
  const [salaError, setSalaError] = useState(false);
  const [cliente, setCliente] = useState<Room | null>(null);
  const [intento, setIntento] = useState(0);
  const enLinea = useSyncExternalStore(suscribirRed, () => navigator.onLine, () => true);

  const refrescar = useCallback(async () => {
    try {
      setSesion({ datos: await fetchMe(), error: false });
    } catch {
      // Si ya teníamos sesión, la conservamos: un fallo suelto no debe sacar a nadie de su pantalla.
      setSesion((s) => ({ datos: s.datos, error: !s.datos }));
    }
  }, []);

  useEffect(() => {
    let vivo = true;
    fetchSite().then(
      (datos) => vivo && setSitio({ datos, error: false }),
      () => vivo && setSitio((s) => ({ datos: s.datos, error: !s.datos })),
    );
    fetchMe().then(
      (datos) => vivo && setSesion({ datos, error: false }),
      () => vivo && setSesion((s) => ({ datos: s.datos, error: !s.datos })),
    );
    return () => {
      vivo = false;
    };
  }, [intento]);

  useEffect(() => {
    const alVolver = () => {
      if (!document.hidden) void refrescar();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => document.removeEventListener("visibilitychange", alVolver);
  }, [refrescar]);

  // Una sola conexión a la sala. Se rehace si cambia quién entró.
  const listo = sesion.datos !== null;
  const usuario = sesion.datos?.user?.id ?? "";
  useEffect(() => {
    if (!listo) return;
    let c: Room | null = null;
    let vivo = true;
    let primera = true;
    const limite = setTimeout(() => setSalaError(true), ESPERA_SALA_MS);
    const iniciar = (room: Room) => {
      if (!vivo) return;
      c = room;
      room.onMessage((m) => {
        if (!vivo) return;
        if (m.type === "state") {
          clearTimeout(limite);
          setSalaError(false);
          setSala(m.state);
          setDesfase(m.state.now - Date.now());
        } else if (m.type === "me") void refrescar();
      });
      room.onStatus((ok) => {
        if (!vivo) return;
        setConectada(ok);
        // Al reconectar pudimos perder avisos de saldo.
        if (ok && !primera) void refrescar();
        if (ok) primera = false;
      });
      setCliente(room);
      room.connect();
    };
    if (process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO === "1") void import("./demo/backend").then((m) => iniciar(m.demo.room()));
    else iniciar(new RoomClient());
    return () => {
      vivo = false;
      clearTimeout(limite);
      c?.close();
    };
  }, [listo, usuario, refrescar, intento]);

  const reintentar = useCallback(() => {
    setSalaError(false);
    setSitio((s) => ({ ...s, error: false }));
    setSesion((s) => ({ ...s, error: false }));
    setIntento((n) => n + 1);
  }, []);
  const precio = sitio.datos?.config ?? PRECIO_BASE;
  const valor = useMemo(
    () => ({ sitio, sesion, sala, salaError, conectada, enLinea, desfase, cliente, precio, refrescar, reintentar }),
    [sitio, sesion, sala, salaError, conectada, enLinea, desfase, cliente, precio, refrescar, reintentar],
  );
  return <Contexto value={valor}>{children}</Contexto>;
}

export function useSistema(): Sistema {
  const s = useContext(Contexto);
  if (!s) throw new Error("Falta ProveedorSistema");
  return s;
}

// Reloj compartido: un solo temporizador para todas las cuentas regresivas.
let ahora = 0;
let temporizador: ReturnType<typeof setInterval> | null = null;
const oyentes = new Set<() => void>();
const suscribirReloj = (f: () => void) => {
  oyentes.add(f);
  temporizador ??= setInterval(() => {
    ahora = Date.now();
    oyentes.forEach((o) => o());
  }, 500);
  return () => {
    oyentes.delete(f);
    if (!oyentes.size && temporizador) {
      clearInterval(temporizador);
      temporizador = null;
      ahora = 0;
    }
  };
};
const leerReloj = () => (ahora ||= Date.now());

/** Hora del servidor, en ms. */
export function useAhora(): number {
  const { desfase } = useSistema();
  return useSyncExternalStore(suscribirReloj, leerReloj, () => 0) + desfase;
}
