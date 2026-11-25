import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/juegos";

export const metadata: Metadata = { title: "Juegos" };

export default function Page() {
  return <Pantalla />;
}
