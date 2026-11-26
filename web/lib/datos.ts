"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, request } from "./api";
import { useSistema } from "./sistema";

export const mensaje = (e: unknown) => (e instanceof ApiError ? e.message : "No se pudo completar. Intenta otra vez.");

/** Pide datos al montar, al cambiar la ruta y cuando cambia la sesión (saldo o avisos). Con ruta null no pide nada. */
export function useDatos<T>(ruta: string | null) {
  const [estado, setEstado] = useState<{ ruta: string | null; datos: T | null; error: string | null }>({ ruta, datos: null, error: null });
  const [vez, setVez] = useState(0);
  const sesion = useSistema().sesion.datos;
  useEffect(() => {
    if (!ruta) return;
    let vivo = true;
    request<T>(ruta).then(
      (datos) => vivo && setEstado({ ruta, datos, error: null }),
      (e) => vivo && setEstado((s) => ({ ruta, datos: s.ruta === ruta ? s.datos : null, error: mensaje(e) })),
    );
    return () => {
      vivo = false;
    };
  }, [ruta, vez, sesion]);
  const recargar = useCallback(() => setVez((n) => n + 1), []);
  return { datos: estado.ruta === ruta ? estado.datos : null, error: estado.ruta === ruta ? estado.error : null, recargar };
}

/** Ejecuta una acción a la vez (un doble clic no la repite) y guarda su error para mostrarlo. */
export function useAccion() {
  const enCurso = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ejecutar = async (accion: () => Promise<unknown>): Promise<boolean> => {
    if (enCurso.current) return false;
    enCurso.current = true;
    setOcupado(true);
    setError(null);
    try {
      await accion();
      return true;
    } catch (e) {
      setError(mensaje(e));
      return false;
    } finally {
      enCurso.current = false;
      setOcupado(false);
    }
  };
  return { ocupado, error, ejecutar, limpiar: () => setError(null) };
}
