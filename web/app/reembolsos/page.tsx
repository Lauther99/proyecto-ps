import type { Metadata } from "next";
import { Documento } from "@/components/documento";

export const metadata: Metadata = { title: "Reembolsos" };

export default function Page() {
  return <Documento cual="reembolsos" />;
}
