import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/ayuda";

export const metadata: Metadata = { title: "Ayuda" };

export default function Page() {
  return <Pantalla />;
}
