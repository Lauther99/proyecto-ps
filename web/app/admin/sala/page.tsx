import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-sala";

export const metadata: Metadata = { title: "Sala (admin)" };

export default function Page() {
  return <Pantalla />;
}
