import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/permission";
import { plansRouter } from "./plans";
import { billingAccessRouter } from "./access";
import { subscriptionRouter } from "./subscription";
import { paymentsRouter } from "./payments";

// =============================================================================
// BILLING ROUTER - Aggregates all billing-related routes
// =============================================================================

export const billingRouter = new Hono<{ Variables: AuthVariables }>()
  .route("/plans", plansRouter)
  .route("/access", billingAccessRouter)
  .route("/subscription", subscriptionRouter)
  .route("/payments", paymentsRouter);

// Re-export helpers
export { getOrganizationUsage } from "./subscription";
