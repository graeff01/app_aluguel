import type { NextConfig } from "next";

/**
 * Política de conteúdo (CSP) em modo "só observar" (Report-Only): nada é bloqueado; o que seria bloqueado é
 * registrado no Diagnóstico via /api/csp-report. Depois de alguns dias sem registros, trocar para o modo de bloqueio.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://*.auxiliadorapredial.com.br https://*.tile.openstreetmap.org https://tile.openstreetmap.org https://*.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "base-uri 'self'",
  "object-src 'none'",
  "report-uri /api/csp-report",
].join("; ");

const securityHeaders = [
  // sempre HTTPS (o Railway já serve só HTTPS; isso impede o navegador de tentar HTTP)
  ...(process.env.NODE_ENV === "production" ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }] : []),
  { key: "Content-Security-Policy-Report-Only", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(self)" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // versão do build (aviso de "nova versão disponível" no app aberto)
  env: { NEXT_PUBLIC_BUILD_ID: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev" },
  // documentos da pré-análise vão no mesmo envio do formulário (fotos já reduzidas no celular)
  experimental: { serverActions: { bodySizeLimit: "25mb" } },
  serverExternalPackages: ["@node-rs/argon2", "pg", "@prisma/adapter-pg", "@react-pdf/renderer"],
  // arquivos lidos em tempo de execução pelo PDF (fontes e logotipo)
  outputFileTracingIncludes: { "/api/relatorios/mensal": ["./assets/**/*"], "/api/imoveis/[code]/relatorio": ["./assets/**/*"] },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // link público do cliente: token nunca vai no Referer; sem cache e sem indexação
        source: "/d/:path*",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
