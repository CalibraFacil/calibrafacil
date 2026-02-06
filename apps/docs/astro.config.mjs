// @ts-check
import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

export default defineConfig({
  // Static output (default) — no SSR adapter needed for Cloudflare Pages.
  // All pages are pre-rendered at build time.
  site: "https://docs.calibrafacil.com",

  integrations: [
    starlight({
      title: "CalibraFácil Docs",

      // Single-language site in pt-BR.
      // Root locale means content lives directly in src/content/docs/ (no subdirectory).
      // Starlight ships built-in Portuguese UI translations.
      locales: {
        root: {
          label: "Português (Brasil)",
          lang: "pt-BR",
        },
      },

      sidebar: [
        {
          label: "Documentação Técnica",
          items: [
            { label: "Introdução e Escopo", slug: "index" },
            {
              label: "Referências Normativas",
              slug: "referencias-normativas",
            },
            { label: "Definições e Terminologia", slug: "definicoes" },
            { label: "Visão Geral do Sistema", slug: "visao-geral" },
          ],
        },
        {
          label: "Guia do Usuário",
          badge: { text: "Novo", variant: "success" },
          items: [
            { label: "Painel e Dashboard", slug: "guia/painel" },
            { label: "Clientes", slug: "guia/clientes" },
            { label: "Ativos e Instrumentos", slug: "guia/ativos" },
            { label: "Padrões de Referência", slug: "guia/padroes" },
            { label: "Catálogo de Serviços", slug: "guia/servicos" },
            {
              label: "Ordens de Serviço",
              items: [
                { label: "Visão Geral", slug: "guia/ordens" },
                {
                  label: "Execução e Medição",
                  slug: "guia/ordens/execucao",
                },
                {
                  label: "Aprovação e Certificados",
                  slug: "guia/ordens/aprovacao",
                },
              ],
            },
            {
              label: "Qualidade",
              items: [
                {
                  label: "Não Conformidades",
                  slug: "guia/qualidade/nc",
                },
                {
                  label: "Ações Corretivas (CAPA)",
                  slug: "guia/qualidade/capa",
                },
              ],
            },
            {
              label: "Configurações e Permissões",
              slug: "guia/configuracoes",
            },
          ],
        },
        {
          label: "Portal do Cliente",
          badge: { text: "Portal", variant: "caution" },
          items: [
            { label: "Guia do Portal", slug: "portal" },
          ],
        },
        {
          label: "Métodos de Calibração",
          badge: { text: "Guia", variant: "note" },
          items: [
            { label: "Visão Geral dos Métodos", slug: "metodos" },
            {
              label: "Campos de Entrada",
              slug: "metodos/campos-de-entrada",
            },
            { label: "Fórmulas", slug: "metodos/formulas" },
            {
              label: "Critérios e Incerteza",
              slug: "metodos/criterios-de-aceitacao",
            },
            { label: "Ciclo de Vida", slug: "metodos/ciclo-de-vida" },
          ],
        },
        {
          label: "Referência Técnica",
          items: [
            {
              label: "Motor Matemático",
              slug: "motor-matematico",
              badge: { text: "GUM", variant: "tip" },
            },
            {
              label: "Rastreabilidade ISO/IEC 17025",
              slug: "rastreabilidade-iso17025",
            },
            {
              label: "Histórico de Alterações",
              slug: "historico-alteracoes",
            },
          ],
        },
      ],

      // KaTeX CSS loaded from npm package (no CDN dependency).
      // Custom CSS fixes Starlight SVG height bug with KaTeX square roots.
      customCss: [
        "katex/dist/katex.min.css",
        "./src/styles/custom.css",
      ],
    }),
  ],

  // Markdown plugins for LaTeX math rendering at build time.
  // remark-math: parses $...$ (inline) and $$...$$ (display) syntax.
  // rehype-katex: renders parsed math nodes to HTML using KaTeX.
  // Result: zero client-side JavaScript for math rendering.
  markdown: {
    remarkPlugins: [remarkMath],
    rehypePlugins: [rehypeKatex],
  },
});
