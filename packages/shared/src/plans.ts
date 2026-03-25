// =============================================================================
// PLAN CONFIGURATION - SaaS Tiering System
// =============================================================================

/**
 * Plan identifiers - matches database values
 */
export type PlanId = "FREE" | "STANDARD" | "PROFESSIONAL" | "ENTERPRISE";

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
export type EntitlementCategory = "capabilities" | "operations" | "scale";

/**
 * Feature flags available for gating
 */
export type FeatureFlag =
  | "math_engine" // Standard+: Advanced uncertainty calculations
  | "portal" // Standard+: Client portal access
  | "financial" // Professional+: Financial module (invoicing, payments)
  | "api" // Professional+: API access for integrations
  | "custom_domain" // Professional+: Custom domain support
  | "sso" // Enterprise: SSO for lab dashboard access
  | "approval_workflow" // Professional+: Review and approval flows
  | "advanced_audit_trail" // Professional+: Detailed audit history
  | "custom_templates" // Professional+: Custom certificate templates
  | "priority_support" // Professional+: Priority support SLAs
  | "multi_unit" // Enterprise: Multi-unit / multi-branch operations
  | "custom_integrations"; // Enterprise: Custom integrations and workflows

/**
 * Entitlements split by commercial concern.
 * The groups are descriptive; gating still happens through FeatureFlag helpers.
 */
export interface PlanEntitlements {
  capabilities: Record<
    | "math_engine"
    | "portal"
    | "financial"
    | "api"
    | "custom_domain"
    | "sso"
    | "approval_workflow"
    | "advanced_audit_trail"
    | "custom_templates",
    boolean
  >;
  operations: Record<"priority_support", boolean>;
  scale: Record<"multi_unit" | "custom_integrations", boolean>;
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
}

// Storage constants for readability
const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;
const UNLIMITED_CERTIFICATES = 999999;
const UNLIMITED_USERS = 999;

/**
 * Catalog of entitlement labels for UI and error messages.
 */
export const ENTITLEMENT_METADATA: Record<FeatureFlag, EntitlementMetadata> = {
  math_engine: {
    category: "capabilities",
    name: "Motor Matemático",
    description: "Cálculos de incerteza de medição",
  },
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
  sso: {
    category: "capabilities",
    name: "SSO Corporativo",
    description: "Login corporativo via OIDC para o dashboard",
  },
  approval_workflow: {
    category: "capabilities",
    name: "Fluxo de Aprovação",
    description: "Submissão, revisão técnica e aprovação",
  },
  advanced_audit_trail: {
    category: "capabilities",
    name: "Trilha de Auditoria Avançada",
    description: "Histórico detalhado para compliance",
  },
  custom_templates: {
    category: "capabilities",
    name: "Templates Personalizados",
    description: "Modelos de certificado personalizados",
  },
  priority_support: {
    category: "operations",
    name: "Suporte Prioritário",
    description: "Atendimento com prioridade operacional",
  },
  multi_unit: {
    category: "scale",
    name: "Multiunidade",
    description: "Operação de múltiplas unidades ou filiais",
  },
  custom_integrations: {
    category: "scale",
    name: "Integrações Personalizadas",
    description: "Fluxos e integrações sob medida",
  },
} as const;

const legacyFeatureMap: Record<FeatureFlag, FeatureFlag[]> = {
  math_engine: ["math_engine"],
  portal: ["portal"],
  financial: ["financial"],
  api: ["api"],
  custom_domain: ["custom_domain"],
  sso: ["sso"],
  approval_workflow: ["approval_workflow"],
  advanced_audit_trail: ["advanced_audit_trail"],
  custom_templates: ["custom_templates"],
  priority_support: ["priority_support"],
  multi_unit: ["multi_unit"],
  custom_integrations: ["custom_integrations"],
};

function createEntitlements(enabled: FeatureFlag[]): PlanEntitlements {
  const has = (feature: FeatureFlag) => enabled.includes(feature);

  return {
    capabilities: {
      math_engine: has("math_engine"),
      portal: has("portal"),
      financial: has("financial"),
      api: has("api"),
      custom_domain: has("custom_domain"),
      sso: has("sso"),
      approval_workflow: has("approval_workflow"),
      advanced_audit_trail: has("advanced_audit_trail"),
      custom_templates: has("custom_templates"),
    },
    operations: {
      priority_support: has("priority_support"),
    },
    scale: {
      multi_unit: has("multi_unit"),
      custom_integrations: has("custom_integrations"),
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
  },
  STANDARD: {
    id: "STANDARD",
    name: "Standard",
    description: "Para pequenos laboratórios.",
    limits: {
      certificates: 100,
      users: 5,
      storage: 5 * GB,
    },
    entitlements: createEntitlements(["math_engine", "portal"]),
  },
  PROFESSIONAL: {
    id: "PROFESSIONAL",
    name: "Professional",
    description: "Para laboratórios acreditados e em crescimento.",
    recommendedFor: "Plano recomendado para laboratórios acreditados ISO 17025",
    isPopular: true,
    limits: {
      certificates: 800,
      users: UNLIMITED_USERS,
      storage: 50 * GB,
    },
    entitlements: createEntitlements([
      "math_engine",
      "portal",
      "financial",
      "api",
      "custom_domain",
      "approval_workflow",
      "advanced_audit_trail",
      "custom_templates",
      "priority_support",
    ]),
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
      "math_engine",
      "portal",
      "financial",
      "api",
      "custom_domain",
      "sso",
      "approval_workflow",
      "advanced_audit_trail",
      "custom_templates",
      "priority_support",
      "multi_unit",
      "custom_integrations",
    ]),
  },
} as const;

/**
 * Plan pricing in centavos (BRL)
 */
export const PLAN_PRICES: Record<
  Exclude<PlanId, "FREE">,
  { monthly: number; yearly: number }
> = {
  STANDARD: { monthly: 149900, yearly: 1499000 },
  PROFESSIONAL: { monthly: 289900, yearly: 2899000 },
  ENTERPRISE: { monthly: 599900, yearly: 5999000 },
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
export function hasEntitlement(planId: PlanId, feature: FeatureFlag): boolean {
  const plan = PLANS[planId];

  return legacyFeatureMap[feature].some((mappedFeature) =>
    [
      plan.entitlements.capabilities,
      plan.entitlements.operations,
      plan.entitlements.scale,
    ].some((group) => group[mappedFeature as keyof typeof group] === true),
  );
}

/**
 * Check if a plan has a specific feature
 */
export function hasFeature(planId: PlanId, feature: FeatureFlag): boolean {
  return hasEntitlement(planId, feature);
}

/**
 * Get a specific limit for a plan
 */
export function getLimit(planId: PlanId, resource: keyof PlanLimits): number {
  return PLANS[planId].limits[resource];
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
  return (Object.keys(ENTITLEMENT_METADATA) as FeatureFlag[]).filter(
    (feature) => hasEntitlement(planId, feature),
  );
}

/**
 * Check if subscription status allows access
 */
export function isSubscriptionActive(status: SubscriptionStatus): boolean {
  return status === "ACTIVE" || status === "TRIAL";
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

/**
 * Format price in BRL (e.g., 149900 -> "R$ 1.499,00")
 */
export function formatPrice(cents: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(cents / 100);
}
