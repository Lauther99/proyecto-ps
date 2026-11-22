import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // En desarrollo, /api/* va al backend local (wrangler dev en :8787). Así las cookies de sesión
  // quedan en localhost:3000. En producción el Worker atiende /api/* en el mismo dominio.
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const api = process.env.API_ORIGIN ?? "http://localhost:8787";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
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
