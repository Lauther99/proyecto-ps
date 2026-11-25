import type { Metadata } from "next";
import Pantalla from "@/components/pantallas/cuenta";

export const metadata: Metadata = { title: "Tu cuenta" };

export default function Page() {
  return <Pantalla />;
}
