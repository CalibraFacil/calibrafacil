import type { PlanSupportPolicy } from "./customer-success";

// =============================================================================
// PLAN CONFIGURATION - SaaS Tiering System
// =============================================================================

/**
 * Plan identifiers - matches database values
 */
export type PlanId =
  | "FREE"
  | "STANDARD"
  | "PROFESSIONAL"
  | "ADVANCED"
  | "ENTERPRISE";

/**
 * Subscription status - matches database enum
 */
export type SubscriptionStatus = "ACTIVE" | "PAST_DUE" | "CANCELED" | "TRIAL";

/**
 * Billing cycle for subscriptions
 */
export type BillingCycle = "MONTHLY" | "YEARLY";

/**
 * Entitlement groups used to organize plan capabilities.
 */
export type EntitlementCategory = "capabilities" | "scale";

/**
 * Feature flags available for gating
 */
/**
 * Every flag here gates something the API really refuses. That is the whole
 * membership rule, and it is enforced by deletion rather than by discipline:
 * a flag that gates nothing is an invitation for someone to wire it into a
 * route later "to match the type", which is exactly how method publication
 * ended up behind a paywall and made the entry tier unusable.
 *
 * What must never appear here: uncertainty calculation, method review and
 * approval, the audit trail, the signed certificate. ISO/IEC 17025 requires
 * them, so selling them back to an accredited laboratory is not a tier, it is
 * a defect. They are unconditional in every plan, including FREE.
 */
export type FeatureFlag =
  | "portal" // Professional+: onboarding your customers into the portal
  | "financial" // Professional+: Financial module (invoicing, payments)
  | "financial_integrations" // Professional+: Native financial ERP integration (Conta Azul + connectors)
  | "api" // Professional+: API access for integrations
  | "custom_domain" // Professional+: Custom domain support
  | "email_sender_domain" // Standard+: Send customer email from the lab's own domain (BYOK Resend)
  | "sso" // Enterprise: SSO for lab dashboard access
  | "multi_unit" // Escala+: Multi-unit / multi-branch operations
  | "customer_group"; // Professional+: Multi-unit client groups (consolidated portal cockpit)

/**
 * Entitlements split by commercial concern.
 * The groups are descriptive; gating still happens through FeatureFlag helpers.
 */
export interface PlanEntitlements {
  capabilities: Record<
    | "portal"
    | "financial"
    | "financial_integrations"
    | "api"
    | "custom_domain"
    | "email_sender_domain"
    | "sso",
    boolean
  >;
  scale: Record<"multi_unit" | "customer_group", boolean>;
}

export interface EntitlementMetadata {
  category: EntitlementCategory;
  name: string;
  description: string;
}

/**
 * Plan limits structure
 */
export interface PlanLimits {
  certificates: number; // Jobs per month
  users: number; // Team members
  storage: number; // Storage in bytes
}

/**
 * Full plan configuration
 */
export interface PlanConfig {
  id: PlanId;
  name: string;
  description: string;
  recommendedFor?: string;
  isPopular?: boolean;
  limits: PlanLimits;
  entitlements: PlanEntitlements;
  support: PlanSupportPolicy;
}

// Storage constants for readability
const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;
const UNLIMITED_CERTIFICATES = 999999;
const UNLIMITED_USERS = 999;
export const STANDARD_CERTIFICATE_LIMIT_CHANGE_AT = new Date(
  "2026-04-04T00:00:00.000Z",
);

/**
 * When Profissional's monthly ceiling moved from 800 to 300.
 *
 * The old number was sold; an organization that contracted against it keeps it.
 * Retuning a published ladder is a decision about what we offer next, never a
 * reason to start refusing work an existing customer already paid for, and the
 * refusal would arrive as a 402 mid-month with nothing on their side changed.
 */
export const PROFESSIONAL_CERTIFICATE_LIMIT_CHANGE_AT = new Date(
  "2026-09-09T00:00:00.000Z",
);
const PROFESSIONAL_LEGACY_CERTIFICATE_LIMIT = 800;

const SUPPORT_POLICIES: Record<PlanId, PlanSupportPolicy> = {
  FREE: {
    supportMode: "standard",
    hasPrioritySupport: false,
    targetFirstResponseBusinessHours: 48,
    targetResolutionLabel: "Melhor esforço",
    includesAssistedOnboarding: false,
    includesAssistedMigration: false,
  },
  STANDARD: {
    supportMode: "standard",
    hasPrioritySupport: false,
    targetFirstResponseBusinessHours: 24,
    targetResolutionLabel: "Até 3 dias úteis",
    includesAssistedOnboarding: false,
    includesAssistedMigration: false,
  },
  PROFESSIONAL: {
    supportMode: "priority",
    hasPrioritySupport: true,
    targetFirstResponseBusinessHours: 8,
    targetResolutionLabel: "Prioridade operacional",
    includesAssistedOnboarding: false,
    includesAssistedMigration: false,
  },
  // The Avançado tier is fenced by service, not by withheld software: the
  // capabilities are the same as Profissional, what changes is volume plus
  // assisted onboarding/migration and a 4-hour first response.
  ADVANCED: {
    supportMode: "priority",
    hasPrioritySupport: true,
    targetFirstResponseBusinessHours: 4,
    targetResolutionLabel: "Prioridade operacional",
    includesAssistedOnboarding: true,
    includesAssistedMigration: true,
  },
  ENTERPRISE: {
    supportMode: "dedicated",
    hasPrioritySupport: true,
    targetFirstResponseBusinessHours: 4,
    targetResolutionLabel: "SLA dedicado",
    includesAssistedOnboarding: true,
    includesAssistedMigration: true,
  },
};

/**
 * Catalog of entitlement labels for UI and error messages.
 */
export const ENTITLEMENT_METADATA: Record<FeatureFlag, EntitlementMetadata> = {
  portal: {
    category: "capabilities",
    name: "Portal do Cliente",
    description: "Acesso externo para clientes e certificados",
  },
  financial: {
    category: "capabilities",
    name: "Módulo Financeiro",
    description: "Faturamento e gestão de pagamentos",
  },
  financial_integrations: {
    category: "capabilities",
    name: "Integrações Financeiras (ERP)",
    description: "Continuidade financeira com ERPs como a Conta Azul",
  },
  api: {
    category: "capabilities",
    name: "Acesso à API",
    description: "Integração com sistemas externos",
  },
  custom_domain: {
    category: "capabilities",
    name: "Domínio Personalizado",
    description: "Portal com domínio da sua empresa",
  },
  email_sender_domain: {
    category: "capabilities",
    name: "Domínio de E-mail Próprio",
    description: "E-mails transacionais enviados do domínio do seu laboratório",
  },
  sso: {
    category: "capabilities",
    name: "SSO Corporativo",
    description: "Login corporativo via OIDC para o dashboard",
  },
  multi_unit: {
    category: "scale",
    name: "Multiunidade",
    description: "Operação de múltiplas unidades ou filiais",
  },
  customer_group: {
    category: "scale",
    name: "Grupos de clientes",
    description:
      "Redes/grupos de clientes com visão consolidada no portal do cliente",
  },
} as const;

export const FEATURE_FLAGS = [
  "portal",
  "financial",
  "financial_integrations",
  "api",
  "custom_domain",
  "email_sender_domain",
  "sso",
  "multi_unit",
  "customer_group",
] as const satisfies readonly FeatureFlag[];

/** Runtime guard for an arbitrary string being a known feature flag. */
export function isFeatureFlag(value: string): value is FeatureFlag {
  return FEATURE_FLAGS.some((flag) => flag === value);
}

const legacyFeatureMap: Record<FeatureFlag, FeatureFlag[]> = {
  portal: ["portal"],
  financial: ["financial"],
  financial_integrations: ["financial_integrations"],
  api: ["api"],
  custom_domain: ["custom_domain"],
  email_sender_domain: ["email_sender_domain"],
  sso: ["sso"],
  multi_unit: ["multi_unit"],
  customer_group: ["customer_group"],
};

function createEntitlements(enabled: FeatureFlag[]): PlanEntitlements {
  const has = (feature: FeatureFlag) => enabled.includes(feature);

  return {
    capabilities: {
      portal: has("portal"),
      financial: has("financial"),
      financial_integrations: has("financial_integrations"),
      api: has("api"),
      custom_domain: has("custom_domain"),
      email_sender_domain: has("email_sender_domain"),
      sso: has("sso"),
    },
    scale: {
      multi_unit: has("multi_unit"),
      customer_group: has("customer_group"),
    },
  };
}

/**
 * Plan definitions
 */
export const PLANS: Record<PlanId, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Gratuito",
    description: "Para avaliação inicial do sistema.",
    limits: {
      certificates: 10,
      users: 1,
      storage: 100 * MB,
    },
    entitlements: createEntitlements([]),
    support: SUPPORT_POLICIES.FREE,
  },
  STANDARD: {
    id: "STANDARD",
    name: "Essencial",
    description: "Para laboratórios pequenos saindo da planilha.",
    limits: {
      certificates: 100,
      // Priced per laboratory, never per seat: every competitor in this market
      // (Fragasoft, Metroex, Axiospec, GageList) includes the whole team, and
      // the public page says so. Volume is the meter, seats are not.
      users: UNLIMITED_USERS,
      storage: 5 * GB,
    },
    // No `portal`: Essencial delivers certificates by e-mail from the lab's own
    // domain, and giving the lab's *customers* a login of their own is what
    // Profissional adds. Nothing the norm requires is withheld here — the
    // portal is operational reach, not compliance.
    entitlements: createEntitlements(["email_sender_domain"]),
    support: SUPPORT_POLICIES.STANDARD,
  },
  PROFESSIONAL: {
    id: "PROFESSIONAL",
    name: "Profissional",
    description: "Para laboratórios com volume, financeiro e portal.",
    recommendedFor: "Plano mais escolhido por laboratórios sob a ISO 17025",
    isPopular: true,
    limits: {
      // 800/month was ~40 per working day, beyond nearly every independent
      // Brazilian laboratory, so the whole Profissional-to-Escala volume band
      // was decorative: nobody grew into it. 300 sits at a volume a real lab
      // reaches, which is what makes the ladder mean anything.
      certificates: 300,
      users: UNLIMITED_USERS,
      storage: 50 * GB,
    },
    entitlements: createEntitlements([
      "portal",
      "financial",
      "financial_integrations",
      "api",
      "custom_domain",
      "email_sender_domain",
      "customer_group",
    ]),
    support: SUPPORT_POLICIES.PROFESSIONAL,
  },
  // Named "Escala", not "Avançado": the old name promised more capability, which
  // is the one thing the tier did not add, and a buyer skimming tier names then
  // assumes a compliance hierarchy the product does not enforce. That is the
  // same trap as naming a tier "RBC". Volume and branches are the real axis.
  ADVANCED: {
    id: "ADVANCED",
    name: "Escala",
    description: "Para operação de alto volume, em mais de uma unidade.",
    limits: {
      certificates: 900,
      users: UNLIMITED_USERS,
      storage: 200 * GB,
    },
    // `multi_unit` is what makes this a tier rather than a surcharge: branches
    // of the laboratory itself, with members scoped per branch. It used to sit
    // in Enterprise beside SSO and bespoke integrations, which is a different
    // scale of buyer entirely — a two-site lab is not a procurement process.
    entitlements: createEntitlements([
      "portal",
      "financial",
      "financial_integrations",
      "api",
      "custom_domain",
      "email_sender_domain",
      "customer_group",
      "multi_unit",
    ]),
    support: SUPPORT_POLICIES.ADVANCED,
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    description: "Para grandes operações e redes.",
    limits: {
      certificates: UNLIMITED_CERTIFICATES,
      users: UNLIMITED_USERS,
      storage: 1 * TB,
    },
    entitlements: createEntitlements([
      "portal",
      "financial",
      "financial_integrations",
      "api",
      "custom_domain",
      "email_sender_domain",
      "sso",
      "customer_group",
      "multi_unit",
    ]),
    support: SUPPORT_POLICIES.ENTERPRISE,
  },
} as const;

/**
 * Plan pricing in centavos (BRL)
 */
/**
 * Plan pricing in centavos (BRL) — repriced 2026-09-08.
 *
 * `yearly` is the total charged once for twelve months and equals ten
 * monthly payments of the annual-equivalent price ("pague o ano, ganhe dois
 * meses"); `monthly` is that equivalent plus 20% for month-to-month billing.
 * Published on the landing as R$ 349 / 599 / 999 per month on the annual plan.
 *
 * ENTERPRISE is quoted, never published: the number below is the internal
 * floor (~R$ 18 mil/ano) that a quote must clear, not a shelf price.
 *
 * Changing these values does NOT re-bill anyone: an existing subscription is
 * charged from the amount frozen on its `commercial_offer` row, and the ASAAS
 * reconciliation job never reads this table.
 */
export const PLAN_PRICES: Record<
  Exclude<PlanId, "FREE">,
  { monthly: number; yearly: number }
> = {
  STANDARD: { monthly: 41900, yearly: 418800 },
  PROFESSIONAL: { monthly: 71900, yearly: 718800 },
  ADVANCED: { monthly: 119900, yearly: 1198800 },
  ENTERPRISE: { monthly: 179900, yearly: 1798800 },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get plan configuration by ID
 */
export function getPlan(planId: PlanId): PlanConfig {
  return PLANS[planId];
}

/**
 * Check if a plan has a specific entitlement.
 */
export function hasEntitlement(
  planId: PlanId | string,
  feature: FeatureFlag,
): boolean {
  if (!isValidPlanId(planId)) {
    return false;
  }

  const plan = PLANS[planId];
  if (!plan?.entitlements) {
    return false;
  }
  const entitlementGroups: Array<Partial<Record<FeatureFlag, boolean>>> = [
    plan.entitlements.capabilities,
    plan.entitlements.scale,
  ];

  return legacyFeatureMap[feature].some((mappedFeature) =>
    entitlementGroups.some((group) => group[mappedFeature] === true),
  );
}

/**
 * Check if a plan has a specific feature
 */
export function hasFeature(
  planId: PlanId | string,
  feature: FeatureFlag,
): boolean {
  return hasEntitlement(planId, feature);
}

/**
 * Get a specific limit for a plan
 */
export function getLimit(planId: PlanId, resource: keyof PlanLimits): number {
  return PLANS[planId].limits[resource];
}

/**
 * Resolve effective plan limits for a specific organization.
 *
 * Standard plan organizations created before the certificate cap change keep
 * the original 200-certificates quota.
 */
export function getEffectivePlanLimits(
  planId: PlanId,
  organizationCreatedAt?: Date | string | null,
): PlanLimits {
  const limits = { ...PLANS[planId].limits };

  if (
    planId === "STANDARD" &&
    organizationCreatedAt &&
    new Date(organizationCreatedAt).getTime() <
      STANDARD_CERTIFICATE_LIMIT_CHANGE_AT.getTime()
  ) {
    limits.certificates = 200;
  }

  if (
    planId === "PROFESSIONAL" &&
    organizationCreatedAt &&
    new Date(organizationCreatedAt).getTime() <
      PROFESSIONAL_CERTIFICATE_LIMIT_CHANGE_AT.getTime()
  ) {
    limits.certificates = PROFESSIONAL_LEGACY_CERTIFICATE_LIMIT;
  }

  return limits;
}

/**
 * Type guard for valid plan IDs
 */
export function isValidPlanId(value: string): value is PlanId {
  return value in PLANS;
}

/**
 * Get all plans for UI display
 */
export function getAllPlans(): PlanConfig[] {
  return Object.values(PLANS);
}

/**
 * Get paid plans only (excludes FREE)
 */
export function getPaidPlans(): PlanConfig[] {
  return Object.values(PLANS).filter((plan) => plan.id !== "FREE");
}

/**
 * List enabled feature flags for a plan.
 */
export function getEnabledEntitlements(planId: PlanId): FeatureFlag[] {
  return FEATURE_FLAGS.filter((feature) => hasEntitlement(planId, feature));
}

/**
 * Check if subscription status allows access.
 *
 * Status alone cannot answer this for a cancelled subscription — see
 * `subscriptionGrantsAccess`, which is what call sites holding the row should
 * use. Kept for the few places that only have a status to go on.
 */
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === "ACTIVE" || status === "TRIAL";
}

/**
 * Whether a subscription still entitles the laboratory to the product.
 *
 * Cancelling used to revoke access the instant the status flipped, even with
 * a period the customer had already paid for. For an annual plan that is up to
 * twelve months of purchased service taken away on the day someone clicks
 * cancel — and for a calibration laboratory it can also mean losing access to
 * records mid-job. A cancelled subscription therefore keeps its entitlements
 * until the period it paid for actually ends.
 *
 * No `currentPeriodEnd` means there is no paid period to honour, so access
 * ends with the status, as before.
 */
export function subscriptionGrantsAccess(
  input: {
    status: SubscriptionStatus;
    currentPeriodEnd?: Date | string | null;
  },
  now: Date = new Date(),
): boolean {
  if (isSubscriptionActive(input.status)) return true;
  if (input.status !== "CANCELED") return false;

  if (!input.currentPeriodEnd) return false;
  const periodEnd =
    input.currentPeriodEnd instanceof Date
      ? input.currentPeriodEnd
      : new Date(input.currentPeriodEnd);
  if (Number.isNaN(periodEnd.getTime())) return false;

  return periodEnd.getTime() > now.getTime();
}

/**
 * Get plan price for a given cycle
 */
export function getPlanPrice(
  planId: PlanId,
  cycle: BillingCycle,
): number | null {
  if (planId === "FREE") return 0;
  const prices = PLAN_PRICES[planId];
  return cycle === "MONTHLY" ? prices.monthly : prices.yearly;
}

export function getPlanSupportPolicy(planId: PlanId): PlanSupportPolicy {
  return PLANS[planId].support;
}

/**
 * Format price in BRL (e.g., 149900 -> "R$ 1.499,00")
 */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}
