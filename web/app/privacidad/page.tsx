import type { Metadata } from "next";
import { Documento } from "@/components/documento";

export const metadata: Metadata = { title: "Privacidad" };

export default function Page() {
  return <Documento cual="privacidad" />;
}
