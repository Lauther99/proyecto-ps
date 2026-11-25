import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/jugar";

export const metadata: Metadata = { title: "Tu partida" };

export default function Page() {
  return <Pantalla />;
}
