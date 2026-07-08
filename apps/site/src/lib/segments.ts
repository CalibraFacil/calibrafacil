import type { DocContent } from "@/components/doc-page";

// Audience/segment landing pages at /solucoes/[slug]. Distinct high-intent
// searches: an accredited lab and an Inmetro-authorized workshop look for
// different things. Same rendered shape as feature pages (DocContent).
export const SEGMENTS: DocContent[] = [
  {
    slug: "laboratorios-acreditados-cgcre",
    metaTitle:
      "Software para laboratórios de calibração acreditados (Cgcre / ISO 17025)",
    description:
      "Sistema de gestão para laboratórios acreditados pela Cgcre: cálculo de incerteza GUM, controle de padrões e rastreabilidade, certificados ISO/IEC 17025 assinados e trilha de auditoria pronta para o avaliador.",
    heading: "Para laboratórios de calibração acreditados",
    intro:
      "Do orçamento de incerteza à evidência que o avaliador do Cgcre pede: a documentação já está pronta quando a auditoria chega, porque foi registrada ao longo da operação.",
    highlights: [
      {
        title: "Incerteza e rastreabilidade",
        body: "Cálculo conforme o GUM, padrões com certificado e validade controlados, e cada calibração ligada aos padrões usados.",
      },
      {
        title: "Fluxo de aprovação e signatários",
        body: "Revisão e aprovação com papéis definidos; na aprovação o certificado congela numa versão assinada com ICP-Brasil.",
      },
      {
        title: "Auditoria sem correria",
        body: "Trilha de auditoria nativa e acesso somente-leitura com escopo e prazo para o avaliador — sem montar pastas na véspera.",
      },
    ],
  },
  {
    slug: "oficinas-permissionarias-inmetro",
    metaTitle:
      "Software para oficinas permissionárias do Inmetro (metrologia legal)",
    description:
      "Gestão para oficinas autorizadas pelo Inmetro: fluxo de metrologia legal, marca de reparo e selagem, número e UF de autorização, e comprovantes de serviço prontos para fiscalização.",
    heading: "Para oficinas permissionárias do Inmetro",
    intro:
      "O fluxo de metrologia legal que a oficina precisa: reparo, selagem e a documentação exigida pela portaria, com a identificação da permissão sempre à mão.",
    highlights: [
      {
        title: "Metrologia legal",
        body: "Instrumentos sujeitos à metrologia legal tratados com o fluxo correto — distinto da calibração acreditada.",
      },
      {
        title: "Marca de reparo e selagem",
        body: "Registro da marca de reparo, retirada e aposição de marca de selagem, com a evidência associada ao serviço.",
      },
      {
        title: "Comprovantes prontos",
        body: "Documentos de entrega com número e UF da autorização, prontos para apresentar em uma fiscalização.",
      },
    ],
  },
];

export function getSegment(slug: string): DocContent | undefined {
  return SEGMENTS.find((segment) => segment.slug === slug);
}
