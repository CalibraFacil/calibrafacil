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
 * Feature flags available for gating
 */
export type FeatureFlag =
  | "math_engine" // Standard+: Advanced uncertainty calculations
  | "portal" // Professional+: Client portal access
  | "financial" // Professional+: Financial module (invoicing, payments)
  | "api" // Enterprise: API access for integrations
  | "custom_domain"; // Enterprise: Custom domain support

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
  limits: PlanLimits;
  features: FeatureFlag[];
}

// Storage constants for readability
const MB = 1024 * 1024;
const GB = 1024 * MB;
const TB = 1024 * GB;

/**
 * Plan definitions
 */
export const PLANS: Record<PlanId, PlanConfig> = {
  FREE: {
    id: "FREE",
    name: "Gratuito",
    limits: {
      certificates: 10,
      users: 1,
      storage: 100 * MB,
    },
    features: [],
  },
  STANDARD: {
    id: "STANDARD",
    name: "Standard",
    limits: {
      certificates: 200,
      users: 5,
      storage: 5 * GB,
    },
    features: ["math_engine"],
  },
  PROFESSIONAL: {
    id: "PROFESSIONAL",
    name: "Professional",
    limits: {
      certificates: 1000,
      users: 999,
      storage: 50 * GB,
    },
    features: ["math_engine", "portal", "financial"],
  },
  ENTERPRISE: {
    id: "ENTERPRISE",
    name: "Enterprise",
    limits: {
      certificates: 999999,
      users: 999,
      storage: 1 * TB,
    },
    features: ["math_engine", "portal", "financial", "api", "custom_domain"],
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
 * Check if a plan has a specific feature
 */
export function hasFeature(planId: PlanId, feature: FeatureFlag): boolean {
  return PLANS[planId].features.includes(feature);
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
  cycle: BillingCycle
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
