import { Hono } from "hono";
import {
  PLANS,
  PLAN_PRICES,
  getAllPlans,
  getPaidPlans,
  isValidPlanId,
  type PlanId,
} from "@calibra-facil/shared";

// =============================================================================
// PLANS ROUTES - Public endpoints for plan information
// =============================================================================

type PaidPlanId = Exclude<PlanId, "FREE">;

function isPaidPlanId(planId: PlanId): planId is PaidPlanId {
  return planId !== "FREE";
}

function getPlanPricing(planId: PlanId) {
  return isPaidPlanId(planId)
    ? PLAN_PRICES[planId]
    : { monthly: 0, yearly: 0 };
}

export const plansRouter = new Hono()
  // =========================================================================
  // GET / - List all active plans with pricing
  // =========================================================================
  .get("/", async (c) => {
    const plans = getAllPlans().map((plan) => ({
      ...plan,
      pricing: getPlanPricing(plan.id),
    }));

    return c.json({ data: plans });
  })

  // =========================================================================
  // GET /paid - List only paid plans (for checkout display)
  // =========================================================================
  .get("/paid", async (c) => {
    const plans = getPaidPlans().map((plan) => ({
      ...plan,
      pricing: getPlanPricing(plan.id),
    }));

    return c.json({ data: plans });
  })

  // =========================================================================
  // GET /:planId - Get a specific plan
  // =========================================================================
  .get("/:planId", async (c) => {
    const rawPlanId = c.req.param("planId");

    if (!isValidPlanId(rawPlanId)) {
      return c.json({ error: "Plano nao encontrado" }, 404);
    }

    const planId = rawPlanId;
    const plan = PLANS[planId];
    const pricing = getPlanPricing(planId);

    return c.json({
      data: {
        ...plan,
        pricing,
      },
    });
  });
