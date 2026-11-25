import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-recargas";

export const metadata: Metadata = { title: "Recargas (admin)" };

export default function Page() {
  return <Pantalla />;
}
