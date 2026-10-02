import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const withMDX = createMDX();

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains; preload",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  {
    key: "Permissions-Policy",
    value:
      "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  },
];

const legacyRedirects = [
  // ─── Legacy top-level slugs (Astro/Starlight era) ──────────────────────────
  { source: "/definicoes", destination: "/conceitos/glossario" },
  { source: "/portal", destination: "/plataforma/portal-do-cliente" },
  { source: "/motor-matematico", destination: "/incerteza/motor-matematico" },
  { source: "/rastreabilidade-iso17025", destination: "/conceitos/iso-17025" },
  {
    source: "/validacao-motor-matematico",
    destination: "/incerteza/validacao",
  },
  {
    source: "/referencias-normativas",
    destination: "/incerteza/referencias-normativas",
  },
  // removed pages — send to root rather than 404 to preserve link equity
  { source: "/historico-alteracoes", destination: "/" },
  { source: "/guia/customer-success", destination: "/" },

  // ─── Legacy /guia/* → current IA (single hop, no chained redirects) ────────
  { source: "/guia/painel", destination: "/primeiros-passos/painel" },
  {
    source: "/guia/autenticacao-sso-api",
    destination: "/primeiros-passos/acesso-e-sso",
  },
  { source: "/guia/clientes", destination: "/operacao-comercial/clientes" },
  { source: "/guia/ativos", destination: "/calibracao/ativos" },
  { source: "/guia/padroes", destination: "/calibracao/padroes" },
  { source: "/guia/servicos", destination: "/operacao-comercial/servicos" },
  {
    source: "/guia/governanca-multiunidade",
    destination: "/plataforma/multiunidade",
  },
  {
    source: "/guia/relatorios-consolidados",
    destination: "/plataforma/multiunidade#relatorios-consolidados",
  },
  {
    source: "/guia/integracoes-api-publica",
    destination: "/integracoes/visao-geral",
  },
  {
    source: "/guia/competencias-pessoal",
    destination: "/qualidade/competencias",
  },
  {
    source: "/guia/ordens",
    destination: "/calibracao/ordens-de-calibracao/visao-geral",
  },
  {
    source: "/guia/ordens/execucao",
    destination: "/calibracao/ordens-de-calibracao/execucao",
  },
  {
    source: "/guia/ordens/aprovacao",
    destination: "/calibracao/ordens-de-calibracao/aprovacao-e-certificado",
  },
  { source: "/guia/qualidade/nc", destination: "/qualidade/nao-conformidades" },
  { source: "/guia/qualidade/capa", destination: "/qualidade/capa" },
  {
    source: "/guia/monitoramento-ambiental",
    destination: "/calibracao/monitoramento-ambiental",
  },
  { source: "/guia/configuracoes", destination: "/plataforma/permissoes" },
  { source: "/metodos", destination: "/metodos/visao-geral" },

  // ─── First-IA renames (commercial/technical order split) ──────────────────
  {
    source: "/calibracao/clientes",
    destination: "/operacao-comercial/clientes",
  },
  {
    source: "/calibracao/servicos",
    destination: "/operacao-comercial/servicos",
  },
  {
    source: "/calibracao/ordens/visao-geral",
    destination: "/calibracao/ordens-de-calibracao/visao-geral",
  },
  {
    source: "/calibracao/ordens/execucao",
    destination: "/calibracao/ordens-de-calibracao/execucao",
  },
  {
    source: "/calibracao/ordens/aprovacao",
    destination: "/calibracao/ordens-de-calibracao/aprovacao-e-certificado",
  },
  {
    source: "/plataforma/certificados-assinatura",
    destination: "/certificados/assinatura-digital",
  },
];

const config: NextConfig = {
  reactStrictMode: true,
  // Docs live under /docs so they can share a host with the project site.
  // basePath prefixes every route, asset and Next <Link> (Fumadocs uses Next
  // Link, so source.baseUrl stays "/").
  basePath: "/docs",
  // Extra origins (a tunnel, another device) allowed to talk to `next dev`,
  // comma-separated in NEXT_DEV_ALLOWED_ORIGINS. Without them Next blocks
  // /_next/webpack-hmr and /_next/static requests from non-localhost origins.
  allowedDevOrigins: (process.env.NEXT_DEV_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [...legacyRedirects.map((rule) => ({ ...rule, permanent: true }))];
  },
};

export default withMDX(config);
