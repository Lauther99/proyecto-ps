import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-usuarios";

export const metadata: Metadata = { title: "Usuarios (admin)" };

export default function Page() {
  return <Pantalla />;
}
