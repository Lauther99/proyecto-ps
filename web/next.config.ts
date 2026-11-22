import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const nextConfig: NextConfig = {
  // Producción: Next solo "fabrica" archivos estáticos (carpeta out/) y el Worker de Cloudflare
  // (worker/) los sirve junto con /api. Así se despliega un solo proyecto y no hace falta servidor
  // de Next. La interfaz corre entera en el navegador, por eso no perdemos nada.
  ...(isDev ? {} : { output: "export" as const }),

  // Páginas solo de desarrollo: se llaman page.dev.tsx y Next solo las reconoce en "next dev".
  // Así /local-player (prueba con el agente en la misma laptop) no se publica.
  pageExtensions: isDev ? ["dev.tsx", "tsx", "ts", "jsx", "js"] : ["tsx", "ts", "jsx", "js"],

  // Desarrollo: /api/* va al backend local (wrangler dev en :8787), así las cookies de sesión
  // quedan en localhost:3000. (Los rewrites no existen en la exportación estática.)
  ...(isDev
    ? {
        async rewrites() {
          const api = process.env.API_ORIGIN ?? "http://localhost:8787";
          return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
        },
      }
    : {}),

  experimental: {
    agentFeedback: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
