// Catalog of marketing feature pages, rendered programmatically at
// /recursos/[slug]. Each entry is one indexable page targeting a distinct
// search intent. Track D expands this list (per grandeza, per segment, etc.).
export interface Feature {
  slug: string;
  /** <title> — keyword-first. */
  metaTitle: string;
  /** meta description. */
  description: string;
  /** H1. */
  heading: string;
  /** Lead paragraph. */
  intro: string;
  highlights: { title: string; body: string }[];
}

export const FEATURES: Feature[] = [
  {
    slug: "calculo-de-incerteza-gum",
    metaTitle: "Cálculo de incerteza de medição conforme o GUM",
    description:
      "Motor de incerteza conforme o JCGM 100:2008 (GUM): contribuições Tipo A e Tipo B, composição quadrática e fator de abrangência, com orçamento de incerteza rastreável em cada certificado.",
    heading: "Cálculo de incerteza de medição conforme o GUM",
    intro:
      "Cada calibração sai com um orçamento de incerteza completo e auditável, calculado segundo o JCGM 100:2008 (GUM) — sem planilhas paralelas e sem recomeçar do zero a cada revisão.",
    highlights: [
      {
        title: "Tipo A e Tipo B",
        body: "Repetibilidade medida, certificado do padrão, resolução e demais componentes entram no orçamento com sua distribuição e divisor corretos.",
      },
      {
        title: "Composição e abrangência",
        body: "Composição quadrática das contribuições e fator de abrangência k para a incerteza expandida, com o nível de confiança declarado.",
      },
      {
        title: "Rastreável ao item",
        body: "Cada componente fica ligado ao que o originou, de modo que o avaliador reconstrói o cálculo a partir da evidência registrada.",
      },
    ],
  },
  {
    slug: "certificados-iso-17025",
    metaTitle: "Emissão de certificados de calibração ISO/IEC 17025",
    description:
      "Gere certificados de calibração alinhados à ISO/IEC 17025 a partir de um modelo Excel que o próprio laboratório edita, com preenchimento automático e versão congelada na aprovação.",
    heading: "Certificados de calibração ISO/IEC 17025",
    intro:
      "O layout do certificado é uma planilha Excel que o seu laboratório controla; o sistema preenche os dados dinâmicos e congela a versão aprovada.",
    highlights: [
      {
        title: "Modelo que você edita",
        body: "Logo, cabeçalho, tabelas e variáveis nomeadas na própria planilha — múltiplos modelos por escopo (massa, temperatura, dimensional).",
      },
      {
        title: "Versão congelada",
        body: "Na aprovação, o certificado e as evidências referenciadas travam numa versão que não muda mais; correções geram uma nova revisão.",
      },
      {
        title: "Conformidade declarada",
        body: "Margem de conformidade e regra de decisão registradas conforme a ISO/IEC 17025:2017.",
      },
    ],
  },
  {
    slug: "assinatura-digital-icp-brasil",
    metaTitle: "Assinatura digital ICP-Brasil (PAdES) em certificados",
    description:
      "Assine certificados de calibração com certificado digital ICP-Brasil A1 no padrão PAdES, com carimbo de tempo e validação da cadeia até a AC-Raiz da ICP-Brasil.",
    heading: "Assinatura digital ICP-Brasil nos certificados",
    intro:
      "Na aprovação, o PDF é assinado nativamente com o certificado ICP-Brasil A1 do responsável técnico, no padrão PAdES.",
    highlights: [
      {
        title: "PAdES com carimbo de tempo",
        body: "Assinatura embutida no arquivo, com carimbo de tempo (RFC-3161) e validação da cadeia até a AC-Raiz.",
      },
      {
        title: "Integridade verificável",
        body: "A assinatura cobre a versão congelada; qualquer alteração posterior quebra a validação.",
      },
      {
        title: "Carteira por unidade",
        body: "Cada unidade gerencia seus certificados de assinatura e define a política de signatários.",
      },
    ],
  },
  {
    slug: "portal-do-cliente",
    metaTitle: "Portal do cliente para laboratórios de calibração",
    description:
      "Ofereça um portal onde o cliente acompanha certificados, prazos de recalibração e a frota de instrumentos — com identidade visual do seu laboratório.",
    heading: "Portal do cliente",
    intro:
      "Seus clientes acessam certificados, vencimentos e o histórico da frota num portal próprio, reduzindo e-mails e ligações de acompanhamento.",
    highlights: [
      {
        title: "Cockpit da frota",
        body: "Instrumentos, próximas calibrações e alertas de vencimento numa visão consolidada, inclusive multiunidade.",
      },
      {
        title: "Certificados na hora",
        body: "Download dos certificados assinados e verificação de autenticidade sem depender do laboratório.",
      },
      {
        title: "Marca do laboratório",
        body: "Domínio e identidade visual próprios nos planos que incluem domínio personalizado.",
      },
    ],
  },
  {
    slug: "gestao-de-vencimentos-e-recall",
    metaTitle: "Gestão de vencimentos e recall de calibração",
    description:
      "Controle os prazos de recalibração da frota e avise o cliente antes do vencimento: alertas automáticos, recall e intervalos por instrumento.",
    heading: "Gestão de vencimentos e recall",
    intro:
      "O sistema acompanha o intervalo de cada instrumento e dispara o aviso de recalibração antes do vencimento — para o laboratório e para o cliente.",
    highlights: [
      {
        title: "Intervalo por instrumento",
        body: "Intervalos definidos pelo cliente ou pela regra do laboratório, com base no histórico de calibração e no regime aplicável.",
      },
      {
        title: "Alertas antes do vencimento",
        body: "Lembretes automáticos por e-mail e no portal, para que nenhuma calibração vença sem aviso.",
      },
      {
        title: "Recall organizado",
        body: "Campanhas de recall por cliente ou por frota, com a evidência de comunicação registrada.",
      },
    ],
  },
  {
    slug: "multiunidade-e-grupos",
    metaTitle: "Gestão multiunidade e grupos de clientes",
    description:
      "Opere várias unidades ou filiais isoladas e ofereça a grupos de clientes uma visão consolidada da frota — com relatórios por unidade.",
    heading: "Multiunidade e grupos de clientes",
    intro:
      "Laboratórios com mais de uma unidade e clientes com várias plantas ganham visão consolidada sem perder o isolamento entre organizações.",
    highlights: [
      {
        title: "Unidades isoladas",
        body: "Cada unidade opera com seus próprios usuários, escopo e numeração; o isolamento entre organizações é o padrão.",
      },
      {
        title: "Cockpit consolidado",
        body: "Grupos de clientes enxergam a frota inteira, por unidade, com filtros e um painel único.",
      },
      {
        title: "Relatórios por unidade",
        body: "Indicadores consolidados e por unidade para acompanhar volume, prazos e conformidade.",
      },
    ],
  },
];

export function getFeature(slug: string): Feature | undefined {
  return FEATURES.find((feature) => feature.slug === slug);
}
