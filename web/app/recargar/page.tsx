import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/recargar";

export const metadata: Metadata = { title: "Recargar" };

export default function Page() {
  return <Pantalla />;
}
