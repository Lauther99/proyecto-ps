// Nombre y dominio del sitio, y valores de respaldo de precio (los reales llegan de GET /api/site).
export const SITIO = { nombre: "We Love Gaming", dominio: "juegagtavi.online", moneda: "S/" };

export type Precio = { blockMinutes: number; blockCredits: number; maxMinutes: number; acceptSeconds: number };
export const PRECIO_BASE: Precio = { blockMinutes: 30, blockCredits: 15, maxMinutes: 120, acceptSeconds: 60 };

export const bloquesDe = (p: Precio) => Array.from({ length: Math.max(1, Math.floor(p.maxMinutes / p.blockMinutes)) }, (_, i) => (i + 1) * p.blockMinutes);
export const creditosDe = (p: Precio, minutos: number) => Math.round((minutos / p.blockMinutes) * p.blockCredits);
// 1 crédito = 1 sol.
export const soles = (creditos: number) => `${SITIO.moneda} ${creditos}`;
export const espera = (min: number) => {
  if (min <= 0) return "Sin espera";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
};
export const reloj = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const FECHA = new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "America/Lima" });
export const fecha = (ms: number) => FECHA.format(ms);
const HORA = new Intl.DateTimeFormat("es-PE", { hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZone: "America/Lima" });
export const hora = (ms: number) => HORA.format(ms);
export const minutos = (ms: number) => `${Math.round(ms / 60_000)} min`;
