"use client";
// Envuelve la web. En producción no hace nada; en modo demo agrega el selector de estados.
import { lazy, Suspense, type ReactNode } from "react";

const Selector = process.env.NODE_ENV !== "production" && process.env.NEXT_PUBLIC_DEMO === "1" ? lazy(() => import("./demo-selector")) : null;

export function Demo({ children }: { children: ReactNode }) {
  return Selector ? <Suspense><Selector>{children}</Selector></Suspense> : children;
}
