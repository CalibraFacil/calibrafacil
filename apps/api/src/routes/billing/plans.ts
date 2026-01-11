import { Hono } from "hono";
import {
  PLANS,
  PLAN_PRICES,
  getAllPlans,
  getPaidPlans,
  type PlanId,
} from "@calibra-facil/shared";

// =============================================================================
// PLANS ROUTES - Public endpoints for plan information
// =============================================================================

export const plansRouter = new Hono()
  // =========================================================================
  // GET / - List all active plans with pricing
  // =========================================================================
  .get("/", async (c) => {
    const plans = getAllPlans().map((plan) => ({
      ...plan,
      pricing:
        plan.id === "FREE"
          ? { monthly: 0, yearly: 0 }
          : PLAN_PRICES[plan.id as Exclude<PlanId, "FREE">],
    }));

    return c.json({ data: plans });
  })

  // =========================================================================
  // GET /paid - List only paid plans (for checkout display)
  // =========================================================================
  .get("/paid", async (c) => {
    const plans = getPaidPlans().map((plan) => ({
      ...plan,
      pricing: PLAN_PRICES[plan.id as Exclude<PlanId, "FREE">],
    }));

    return c.json({ data: plans });
  })

  // =========================================================================
  // GET /:planId - Get a specific plan
  // =========================================================================
  .get("/:planId", async (c) => {
    const planId = c.req.param("planId") as PlanId;

    if (!PLANS[planId]) {
      return c.json({ error: "Plano nao encontrado" }, 404);
    }

    const plan = PLANS[planId];
    const pricing =
      planId === "FREE"
        ? { monthly: 0, yearly: 0 }
        : PLAN_PRICES[planId as Exclude<PlanId, "FREE">];

    return c.json({
      data: {
        ...plan,
        pricing,
      },
    });
  });
