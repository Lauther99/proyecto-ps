import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/precios";

export const metadata: Metadata = { title: "Precios" };

export default function Page() {
  return <Pantalla />;
}
