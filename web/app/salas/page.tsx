import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/salas";

export const metadata: Metadata = { title: "Salas" };

export default function Page() {
  return <Pantalla />;
}
