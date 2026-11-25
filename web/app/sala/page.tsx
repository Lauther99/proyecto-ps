import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/sala";

export const metadata: Metadata = { title: "Sala" };

export default function Page() {
  return <Pantalla />;
}
