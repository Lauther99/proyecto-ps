import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/prueba";

export const metadata: Metadata = { title: "Prueba tu conexión" };

export default function Page() {
  return <Pantalla />;
}
