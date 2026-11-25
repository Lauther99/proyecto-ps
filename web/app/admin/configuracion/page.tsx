import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-configuracion";

export const metadata: Metadata = { title: "Configuración (admin)" };

export default function Page() {
  return <Pantalla />;
}
