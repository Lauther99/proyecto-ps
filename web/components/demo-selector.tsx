"use client";
// Herramienta de revisión del modo demo: gris y con borde punteado, ajena al diseño.
import { Fragment, useState, useSyncExternalStore, type ReactNode } from "react";
import { DIMENSIONES, INICIAL, type Escenario } from "@/lib/demo/backend";

type ModuloDemo = typeof import("@/lib/demo/backend");
let modulo: ModuloDemo | null = null;
const suscribir = (f: () => void) => {
  void import("@/lib/demo/backend").then((m) => { modulo = m; m.demo.oyentes.add(f); f(); });
  return () => { modulo?.demo.oyentes.delete(f); };
};
const CLAVES = Object.keys(DIMENSIONES) as (keyof Escenario)[];

export default function DemoSelector({ children }: { children: ReactNode }) {
  const version = useSyncExternalStore(suscribir, () => modulo?.demo.version ?? -1, () => -1);
  const [abierto, setAbierto] = useState(false);
  return (
    <>
      <Fragment key={version}>{version >= 0 && children}</Fragment>
      <div className="fixed top-1/2 right-0 z-[60] -translate-y-1/2 font-mono text-xs text-black">
        {!abierto ? <button type="button" onClick={() => setAbierto(true)} className="min-h-11 w-7 rounded-l border border-dashed border-black bg-[#d4d4d4]/90 py-3 [writing-mode:vertical-rl]">Estados</button> : (
          <div className="flex max-h-[90dvh] w-56 flex-col gap-2 overflow-auto border border-dashed border-black bg-[#d4d4d4] p-3">
            <div className="flex items-center justify-between"><strong>Modo demo</strong><button type="button" aria-label="Cerrar estados" onClick={() => setAbierto(false)} className="size-8">x</button></div>
            {modulo && CLAVES.map((k) => (
              <label key={k} className="flex flex-col gap-0.5">{k}
                <select value={modulo!.demo.e[k]} onChange={(e) => modulo!.demo.poner({ [k]: e.target.value } as Partial<Escenario>)} className="min-h-8 border border-black bg-white px-1 text-black">
                  {Object.entries(DIMENSIONES[k]).map(([v, n]) => <option key={v} value={v}>{n}</option>)}
                </select>
              </label>
            ))}
            <button type="button" onClick={() => modulo?.demo.poner(INICIAL)} className="min-h-8 border border-black bg-white">Reiniciar</button>
          </div>
        )}
      </div>
    </>
  );
}
