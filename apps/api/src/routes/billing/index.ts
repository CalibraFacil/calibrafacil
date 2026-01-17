import { Hono } from "hono";
import type { AuthVariables } from "../../middleware/permission";
import { plansRouter } from "./plans";
import { subscriptionRouter } from "./subscription";
import { checkoutRouter } from "./checkout";
import { paymentsRouter } from "./payments";

// =============================================================================
// BILLING ROUTER - Aggregates all billing-related routes
// =============================================================================

export const billingRouter = new Hono<{ Variables: AuthVariables }>()
  .route("/plans", plansRouter)
  .route("/subscription", subscriptionRouter)
  .route("/checkout", checkoutRouter)
  .route("/payments", paymentsRouter);

// Re-export helpers
export { getOrganizationUsage } from "./subscription";
