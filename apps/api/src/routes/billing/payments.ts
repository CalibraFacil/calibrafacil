import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { paymentHistory } from "@calibra-facil/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";

// =============================================================================
// PAYMENTS ROUTES - Payment history for organization
// =============================================================================

export const paymentsRouter = new Hono<{ Variables: AuthVariables }>()
  // =========================================================================
  // GET / - List payment history
  // =========================================================================
  .get("/", ...withLabPermission({ billing: ["read"] }), async (c) => {
    const memberData = c.get("member");
    const limit = parseInt(c.req.query("limit") || "20");
    const offset = parseInt(c.req.query("offset") || "0");

    const payments = await db
      .select()
      .from(paymentHistory)
      .where(eq(paymentHistory.organizationId, memberData.organizationId))
      .orderBy(desc(paymentHistory.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({ data: payments });
  })

  // =========================================================================
  // GET /:paymentId - Get single payment details
  // =========================================================================
  .get("/:paymentId", ...withLabPermission({ billing: ["read"] }), async (c) => {
    const paymentId = parseInt(c.req.param("paymentId"));
    const memberData = c.get("member");

    const payment = await db.query.paymentHistory.findFirst({
      where: eq(paymentHistory.id, paymentId),
    });

    if (!payment || payment.organizationId !== memberData.organizationId) {
      return c.json({ error: "Pagamento nao encontrado" }, 404);
    }

    return c.json({ data: payment });
  });
