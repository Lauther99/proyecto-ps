import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-juegos";

export const metadata: Metadata = { title: "Juegos (admin)" };

export default function Page() {
  return <Pantalla />;
}
