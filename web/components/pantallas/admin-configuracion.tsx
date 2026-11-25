"use client";
import { useState, type ReactNode } from "react";
import { ErrorAccion } from "@/components/marco";
import { PaginaAdmin } from "@/components/pagina-admin";
import { Boton, Campo } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { updateConfig } from "@/lib/api";
import { useAccion } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";

const t = A.config;

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <fieldset className="grid gap-4 border-t border-raised pt-6 md:grid-cols-[240px_1fr]">
      <legend className="float-left t-title">{titulo}</legend>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Contenido() {
  const { sitio, reintentar } = useSistema();
  const c = sitio.datos?.config;
  const [guardado, setGuardado] = useState(false);
  const [invalido, setInvalido] = useState(false);
  const { ocupado, error, ejecutar } = useAccion();
  if (!c) return null;
  const guardar = async (f: FormData) => {
    const texto = (k: string) => String(f.get(k) ?? "").trim();
    const [blockMinutes, blockCredits, maxMinutes, acceptSeconds] = ["min", "cre", "max", "ace"].map((k) => Number(texto(k)));
    const ok = [blockMinutes, blockCredits, maxMinutes, acceptSeconds].every((n) => Number.isInteger(n) && n > 0) && maxMinutes % blockMinutes === 0;
    setInvalido(!ok);
    if (!ok) return;
    if (await ejecutar(() => updateConfig({ blockMinutes, blockCredits, maxMinutes, acceptSeconds, yapeHolder: texto("tit"), yapeNumber: texto("num"), youtubeChannelId: texto("can") || null }))) {
      setGuardado(true);
      reintentar(); // vuelve a pedir la configuración
    }
  };
  return (
    <form noValidate className="flex flex-col gap-8" onChange={() => { setGuardado(false); setInvalido(false); }} onSubmit={(e) => { e.preventDefault(); void guardar(new FormData(e.currentTarget)); }}>
      <Grupo titulo={t.precio}>
        <Campo id="c-min" name="min" inputMode="numeric" etiqueta={t.minutos} defaultValue={c.blockMinutes} />
        <Campo id="c-cre" name="cre" inputMode="numeric" etiqueta={t.creditos} defaultValue={c.blockCredits} />
        <Campo id="c-max" name="max" inputMode="numeric" etiqueta={t.maximo} defaultValue={c.maxMinutes} />
        <Campo id="c-ace" name="ace" inputMode="numeric" etiqueta={t.aceptar} defaultValue={c.acceptSeconds} />
      </Grupo>
      <Grupo titulo={t.yape}>
        <Campo id="c-tit" name="tit" etiqueta={t.titular} defaultValue={c.yapeHolder} />
        <Campo id="c-num" name="num" inputMode="tel" etiqueta={t.numero} defaultValue={c.yapeNumber} />
        <div className="sm:col-span-2"><p className="t-label">{t.qr}</p><p className="text-muted">{t.qrTexto}</p></div>
      </Grupo>
      <Grupo titulo={t.directo}><div className="sm:col-span-2"><Campo id="c-can" name="can" etiqueta={t.canal} defaultValue={c.youtubeChannelId ?? ""} /></div></Grupo>
      <div className="flex flex-col items-start gap-3 border-t border-raised pt-6">
        <p className="text-muted">{t.nota}</p>
        <Boton type="submit" className="max-sm:w-full" disabled={ocupado}>{t.guardar}</Boton>
        <ErrorAccion>{invalido ? t.error : error}</ErrorAccion>
        <p role="status" className="min-h-6 t-label">{guardado && t.guardado}</p>
      </div>
    </form>
  );
}

export default function Configuracion() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
