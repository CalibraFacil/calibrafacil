/**
 * Public calculators. Each one is a real, ungated tool: the audience is the
 * metrologist doing the work, not the buyer, and gating the result behind a
 * form would cost the links and the trust that make the page worth publishing.
 */
export interface Tool {
  slug: string;
  name: string;
  heading: string;
  description: string;
}

export const TOOLS: readonly Tool[] = [
  {
    slug: "calculadora-de-incerteza",
    name: "Incerteza de medição (GUM)",
    heading: "Calculadora de incerteza de medição",
    description:
      "Orçamento de incerteza conforme o GUM: contribuições Tipo A e Tipo B, composição quadrática, graus de liberdade efetivos e incerteza expandida U = k · uc.",
  },
];
