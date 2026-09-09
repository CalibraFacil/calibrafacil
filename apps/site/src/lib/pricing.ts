/**
 * Public pricing for the landing.
 *
 * Three rules shape the table, and the page states all three:
 *
 * 1. The price is per laboratory, never per seat. Every product this market
 *    compares us to — Fragasoft, Metroex, Axiospec, GageList, SIMME — prices
 *    per company, so seats are not a lever worth defending.
 * 2. The annual plan costs ten monthly payments: pay the year, get two months.
 *    No invented percentage, no seasonal discount.
 * 3. **A tier never withholds the norm.** Uncertainty (GUM), the signed
 *    certificate, review/approval with separate roles and the audit trail open
 *    the base tier's own list, and every tier above it reads "Tudo do
 *    Essencial". What separates the tiers is operational scale (volume),
 *    genuinely separate modules (financeiro/ERP, API, multiunidade) and the
 *    level of service.
 *
 * Every bullet below maps to something the API actually enforces per plan
 * (`requireFeature`/`requirePlanLimit`) or to a service commitment recorded in
 * `SUPPORT_POLICIES` — deliberately, because an unenforced fence is a promise
 * the product breaks the moment a customer looks. Prices mirror `PLAN_PRICES`
 * in `packages/shared/src/plans.ts` (there in centavos).
 */

/** Fixed-price tiers carry both cycles; the top tier is quoted. */
export type TierPrice =
  | {
      kind: "fixed";
      /** Monthly equivalent when the year is paid upfront (BRL). */
      yearlyMonthly: number;
      /** Charged once for twelve months (BRL). */
      yearlyTotal: number;
      /** Month-to-month price (BRL). */
      monthly: number;
    }
  | { kind: "quote" };

export type PricingTier = {
  id: string;
  /** Plan id the app knows this tier by; absent when the tier is quoted. */
  planId?: "STANDARD" | "PROFESSIONAL" | "ADVANCED";
  name: string;
  /** Who the tier is for, one line. */
  audience: string;
  price: TierPrice;
  /**
   * Reads above the feature list: what the tier builds on. Absent on the base
   * tier, which builds on nothing — its list is the product.
   */
  featuresIntro?: string;
  features: string[];
  /**
   * Volume, shown apart from the feature list. Seats are deliberately absent:
   * they are identical on every tier, so repeating them here would say the
   * headline's point a fourth time instead of what actually differs.
   */
  scale: string;
  /** The tier we expect most labs to land on. */
  highlighted?: boolean;
};

export const PRICING_TIERS: PricingTier[] = [
  {
    id: "essencial",
    planId: "STANDARD",
    name: "Essencial",
    audience: "Laboratório pequeno saindo da planilha.",
    price: {
      kind: "fixed",
      yearlyMonthly: 349,
      yearlyTotal: 4188,
      monthly: 419,
    },
    // The metrology core opens the base tier's list, and every other tier
    // inherits it by reading "Tudo do Essencial". That inheritance is what
    // states the 17025 capabilities are ungated, so nothing has to say it
    // again in a card of its own above the table.
    features: [
      "Cálculo de incerteza conforme o GUM",
      "Certificado assinado em ICP-Brasil A1, com verificação pública",
      "Revisão e aprovação com papéis distintos, sobre trilha de auditoria",
      "Modo desconectado no desktop",
      "Clientes, equipamentos, padrões de referência e histórico",
      "Vencimentos, recall de padrão e agenda de recalibração",
      "Ordens de serviço, etiquetas e comprovantes de entrega",
      "E-mails enviados do domínio do seu laboratório",
    ],
    scale: "100 calibrações/mês",
  },
  {
    id: "profissional",
    planId: "PROFESSIONAL",
    name: "Profissional",
    audience: "Laboratório com volume, financeiro e carteira de clientes.",
    price: {
      kind: "fixed",
      yearlyMonthly: 599,
      yearlyTotal: 7188,
      monthly: 719,
    },
    featuresIntro: "Tudo do Essencial, mais:",
    features: [
      "Módulo financeiro: contratos, faturamento, recebíveis e margem",
      "Integração com o ERP (Conta Azul e conectores)",
      "API de integração com os seus sistemas",
      "Portal do cliente, no domínio do seu laboratório",
      "Grupos de clientes: redes com visão consolidada",
      "Suporte prioritário, primeira resposta em 8 horas úteis",
    ],
    scale: "300 calibrações/mês",
    highlighted: true,
  },
  {
    id: "escala",
    planId: "ADVANCED",
    // Named for the axis it actually sells. "Avançado" promised capability the
    // tier does not add, which is the same trap as naming a tier "RBC": a buyer
    // skimming names infers a compliance hierarchy the product does not have.
    name: "Escala",
    audience: "Operação de alto volume, em mais de uma unidade.",
    price: {
      kind: "fixed",
      yearlyMonthly: 999,
      yearlyTotal: 11988,
      monthly: 1199,
    },
    featuresIntro: "Tudo do Profissional, mais:",
    features: [
      "Multiunidade: filiais com dados e equipes separados",
      "Implantação assistida e migração dos seus dados incluídas",
      "Primeira resposta em 4 horas úteis",
    ],
    scale: "900 calibrações/mês",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    audience: "Rede de laboratórios, login corporativo ou migração grande.",
    price: { kind: "quote" },
    featuresIntro: "Tudo do Escala, mais:",
    features: [
      "SSO corporativo para o acesso da equipe",
      "Integrações e fluxos sob medida",
      "SLA dedicado e implantação acompanhada",
    ],
    scale: "Volume e unidades dimensionados no contrato",
  },
];

export type PricingFaq = { question: string; answer: string };

/**
 * Objection handling where the objection happens. Every answer is checked
 * against what the billing code actually does — the limit warning at 80%, the
 * 402 on the cap, PIX/boleto/cartão, and the absence of any fidelidade clause.
 * Nothing here promises a trial, a refund or self-serve plan changes, because
 * none of those exist yet.
 */
export const PRICING_FAQ: PricingFaq[] = [
  {
    question: "O preço é por usuário?",
    answer:
      "Não. É por laboratório, e a equipe inteira entra em qualquer plano — técnicos, responsável técnico, qualidade e administrativo. O que cresce entre os planos é o volume de calibrações, não o número de pessoas.",
  },
  {
    question: "O que acontece se eu passar do limite de calibrações?",
    answer:
      "O painel avisa a partir de 80% do limite do mês. Passar do teto não interrompe o seu trabalho: existe uma folga de 10% para você terminar o mês e trocar de plano com calma. Só depois dessa folga a criação de novas calibrações é bloqueada — e nada do que já existe é apagado, escondido ou deixa de ser emitido.",
  },
  {
    question: "Tem fidelidade?",
    answer:
      "Não. O plano mensal não tem prazo mínimo nem multa de cancelamento. O plano anual é um pagamento único de doze meses, e é por isso que ele sai por dez mensalidades.",
  },
  {
    question: "Como eu contrato?",
    answer:
      "Pela própria página: você cria a conta do laboratório com o e-mail do domínio da empresa, recebe o link de acesso e confirma o pagamento já dentro do sistema. Não precisa esperar proposta nem falar com vendas — o Enterprise, esse sim, é sob consulta.",
  },
  {
    question: "Como eu pago?",
    answer:
      "Pix, boleto ou cartão de crédito. No anual a cobrança é uma só, no início do período; no mensal, uma por mês.",
  },
  {
    question: "O cálculo de incerteza está em todos os planos?",
    answer:
      "Está. Incerteza conforme o GUM, certificado assinado em ICP-Brasil, verificação pública, revisão e aprovação por papéis distintos e trilha de auditoria são o produto, não um pacote caro. A ISO/IEC 17025 atravessa todos os planos.",
  },
  {
    question: "Já uso um sistema mais barato. O que muda?",
    answer:
      "Existe software de gestão de laboratório por bem menos. O que normalmente não existe por esse valor é o cálculo de incerteza com orçamento por contribuição, o certificado assinado com verificação pública e o congelamento da versão aprovada — que é justamente o que a auditoria pede para ver. Para um laboratório que cobra R$ 150 por calibração, o Profissional equivale a quatro calibrações por mês.",
  },
  {
    question: "Posso trocar de plano depois?",
    answer:
      "Pode, a qualquer momento, e a troca é feita com a nossa equipe — sem taxa e sem refazer nada: os dados, os certificados emitidos e os métodos continuam exatamente onde estão.",
  },
  {
    question: "Preciso instalar alguma coisa?",
    answer:
      "Não para o uso normal, que é no navegador. Para calibração em campo sem internet existe o aplicativo de desktop, que trabalha desconectado e sincroniza depois — incluído em todos os planos.",
  },
];

/** Whole-real amounts, the way the page shows them: "R$ 4.188". */
export function formatBRL(value: number): string {
  return `R$ ${value.toLocaleString("pt-BR")}`;
}
