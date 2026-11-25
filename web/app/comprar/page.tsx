import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/comprar";

export const metadata: Metadata = { title: "Hacer cola" };

export default function Page() {
  return <Pantalla />;
}
