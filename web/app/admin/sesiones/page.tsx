import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-sesiones";

export const metadata: Metadata = { title: "Sesiones (admin)" };

export default function Page() {
  return <Pantalla />;
}
