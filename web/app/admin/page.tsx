import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/admin-resumen";

export const metadata: Metadata = { title: "Admin" };

export default function Page() {
  return <Pantalla />;
}
