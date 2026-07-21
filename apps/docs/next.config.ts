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
  // Docs are served at calibrafacil.com/docs (proxied from apps/web via a Vercel
  // rewrite), consolidating SEO authority onto one host. basePath prefixes every
  // route, asset and Next <Link> (Fumadocs uses Next Link, so source.baseUrl
  // stays "/").
  //
  // docs.calibrafacil.com must stay a plain alias of this project: it is the
  // public origin that the apps/web rewrite proxies (this project's *.vercel.app
  // URL is behind deployment protection, so it cannot be the origin). Do NOT
  // redirect that domain at the Vercel domain level — it would break
  // calibrafacil.com/docs. Its bare root is handled in redirects() below.
  basePath: "/docs",
  // Allow the dev tunnel hostname to talk to `next dev` cross-origin.
  // Without this, Next blocks /_next/webpack-hmr (WS) and /_next/static
  // requests from non-localhost origins, which breaks hydration when
  // the dev server is reached via a Cloudflare/ngrok-style tunnel.
  allowedDevOrigins: ["dev-docs.calibrafacil.com"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async redirects() {
    return [
      // Nothing is served at the bare origin (every route lives under basePath),
      // so anyone landing on the legacy docs host gets a 404. Send them to the
      // canonical URL. Scoped to "/" and to that host on purpose: proxied
      // traffic always arrives as /docs/*, so it never matches this rule.
      {
        source: "/",
        has: [{ type: "host", value: "docs.calibrafacil.com" }],
        destination: "https://calibrafacil.com/docs",
        permanent: true,
        basePath: false,
      },
      ...legacyRedirects.map((rule) => ({ ...rule, permanent: true })),
    ];
  },
};

export default withMDX(config);
