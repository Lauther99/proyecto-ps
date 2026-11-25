import type { Metadata } from "next";
import { Documento } from "@/components/documento";

export const metadata: Metadata = { title: "Términos" };

export default function Page() {
  return <Documento cual="terminos" />;
}
