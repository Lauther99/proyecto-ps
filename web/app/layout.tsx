import type { Metadata, Viewport } from "next";
import { Figtree, JetBrains_Mono, Unbounded } from "next/font/google";
import { Demo } from "@/components/demo";
import { T } from "@/data/textos";
import { SITIO } from "@/lib/config";
import { ProveedorSistema } from "@/lib/sistema";
import "./globals.css";

const unbounded = Unbounded({ variable: "--font-unbounded", subsets: ["latin"], weight: "800" });
const figtree = Figtree({ variable: "--font-figtree", subsets: ["latin"], weight: ["400", "600"] });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], weight: ["400", "700"] });

export const metadata: Metadata = {
  metadataBase: new URL(`https://${SITIO.dominio}`),
  title: { default: SITIO.nombre, template: `%s · ${SITIO.nombre}` },
  description: T.comun.descripcion,
};
export const viewport: Viewport = { themeColor: "#0a0b0a", viewportFit: "cover" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es-PE" className={`${unbounded.variable} ${figtree.variable} ${jetbrains.variable} antialiased`}>
      <body>
        <Demo>
          <ProveedorSistema>{children}</ProveedorSistema>
        </Demo>
      </body>
    </html>
  );
}
