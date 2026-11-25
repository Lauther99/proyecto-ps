"use client";
import { useState } from "react";
import { ErrorAccion } from "@/components/marco";
import { Carga, PaginaAdmin } from "@/components/pagina-admin";
import { Boton, Campo, Estado, Fila, Modal, Tabla } from "@/components/ui";
import { A } from "@/data/textos-admin";
import { adjustBalance, updateUser, type AdminUser } from "@/lib/api";
import { useAccion, useDatos } from "@/lib/datos";
import { useSistema } from "@/lib/sistema";

const t = A.usuarios;

function Contenido() {
  const yo = useSistema().sesion.datos?.user;
  const { datos, error: errorCarga, recargar } = useDatos<{ users: AdminUser[] }>("/api/admin/users");
  const { ocupado, error, ejecutar, limpiar } = useAccion();
  const lista = datos?.users ?? [];
  const [q, setQ] = useState("");
  const [accion, setAccion] = useState<{ tipo: "bloqueo" | "saldo" | "rol"; id: string } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [intento, setIntento] = useState(false);
  const abrir = (tipo: "bloqueo" | "saldo" | "rol", id: string) => { setMotivo(""); setCantidad(""); setIntento(false); limpiar(); setAccion({ tipo, id }); };
  const cerrar = () => setAccion(null);
  const u = lista.find((x) => x.id === accion?.id);
  const bloqueado = u?.status === "blocked";
  const n = Number(cantidad);
  const cantOk = /^[+-]?\d+$/.test(cantidad) && n !== 0 && !!u && u.available + n >= 0;
  const aplicar = async (cambio: () => Promise<unknown>) => {
    if (await ejecutar(cambio)) {
      cerrar();
      recargar();
    }
  };
  const errorMotivo = intento && !motivo.trim() ? A.motivoError : undefined;
  const visibles = lista.filter((x) => `${x.nickname} ${x.email}`.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <>
      <div className="max-w-md"><Campo id="buscar" type="search" etiqueta={t.buscar} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <Carga datos={datos} error={errorCarga} recargar={recargar}>{() => <Tabla titulo={t.titulo} columnas={t.columnas} vacio={t.vacio} filas={visibles.map((x) => ({
        id: x.id,
        celdas: [
          <strong key="a" className="font-semibold">{x.nickname}{x.role === "admin" && <span className="ml-2 t-label text-muted">{t.admin}</span>}</strong>, <span key="c" className="text-muted">{x.email}</span>, <span key="s" className="font-mono font-bold">{x.available}</span>,
          <Estado key="e" tono={x.status === "blocked" ? "aviso" : "bien"} icono={x.status === "blocked" ? "x" : "check"}>{x.status === "blocked" ? t.bloqueado : t.activo}</Estado>,
          <span key="b" className="flex flex-wrap justify-end gap-2 lg:justify-start"><Boton variante="secundario" className="!min-h-11 !px-4" onClick={() => abrir("saldo", x.id)}>{t.ajustar}</Boton>{x.id === yo?.id ? <span className="self-center t-label text-muted">{t.tu}</span> : <><Boton variante="secundario" className="!min-h-11 !px-4" onClick={() => abrir("rol", x.id)}>{x.role === "admin" ? t.quitarAdmin : t.hacerAdmin}</Boton><Boton variante={x.status === "blocked" ? "secundario" : "peligro"} className="!min-h-11 !px-4" onClick={() => abrir("bloqueo", x.id)}>{x.status === "blocked" ? t.desbloquear : t.bloquear}</Boton></>}</span>,
        ],
      }))} />}</Carga>

      <Modal abierto={accion?.tipo === "bloqueo"} alCerrar={cerrar} titulo={u ? (bloqueado ? t.desbloquearTitulo : t.bloquearTitulo)(u.nickname) : ""}>
        {u && (
          <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setIntento(true); if (motivo.trim()) void aplicar(() => updateUser(u.id, { status: bloqueado ? "approved" : "blocked", reason: motivo.trim() })); }}>
            <p className="text-muted">{bloqueado ? t.desbloquearTexto : t.bloquearTexto}</p>
            <Campo id="motivo-b" etiqueta={A.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={errorMotivo} />
            <ErrorAccion>{error}</ErrorAccion>
            <Boton type="submit" disabled={ocupado} variante={bloqueado ? "principal" : "peligro"}>{bloqueado ? t.desbloquear : t.bloquear}</Boton>
            <Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
          </form>
        )}
      </Modal>
      <Modal abierto={accion?.tipo === "saldo"} alCerrar={cerrar} titulo={u ? t.ajustarTitulo(u.nickname) : ""}>
        {u && (
          <form noValidate className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); setIntento(true); if (cantOk && motivo.trim()) void aplicar(() => adjustBalance(u.id, n, motivo.trim())); }}>
            <Campo id="cant" etiqueta={t.cantidad} value={cantidad} onChange={(e) => setCantidad(e.target.value)} ayuda={t.cantidadAyuda} error={intento && !cantOk ? t.cantidadError : undefined} />
            <dl className="flex flex-col gap-2 font-mono [&_dt]:font-sans"><Fila etiqueta={t.antes}>{u.available}</Fila><Fila etiqueta={t.despues}>{cantOk ? u.available + n : u.available}</Fila></dl>
            <Campo id="motivo-s" etiqueta={A.motivo} value={motivo} onChange={(e) => setMotivo(e.target.value)} error={errorMotivo} />
            <ErrorAccion>{error}</ErrorAccion>
            <Boton type="submit" disabled={ocupado}>{t.guardar}</Boton>
            <Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
          </form>
        )}
      </Modal>
      <Modal abierto={accion?.tipo === "rol"} alCerrar={cerrar} titulo={u ? t.rolTitulo(u.nickname, u.role === "admin") : ""}>
        {u && (
          <>
            <p className="text-muted">{t.rolTexto}</p>
            <ErrorAccion>{error}</ErrorAccion>
            <Boton disabled={ocupado} onClick={() => void aplicar(() => updateUser(u.id, { role: u.role === "admin" ? "player" : "admin" }))}>{u.role === "admin" ? t.quitarAdmin : t.hacerAdmin}</Boton>
            <Boton variante="secundario" onClick={cerrar}>{A.cancelar}</Boton>
          </>
        )}
      </Modal>
    </>
  );
}

export default function Usuarios() {
  return <PaginaAdmin titulo={t.titulo}><Contenido /></PaginaAdmin>;
}
