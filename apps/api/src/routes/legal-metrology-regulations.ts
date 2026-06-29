import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import { legalMetrologyRegulation } from "@calibra-facil/db/schema";
import { withPermission, type AuthVariables } from "../middleware/permission";

/**
 * GET /api/legal-metrology-regulations — the GLOBAL legal-metrology regulation catalog
 * (deferred #3 of #423). Read-only, auth-required reference data the lab regime form
 * auto-fills from. NOT tenant-scoped (the same Portarias apply to every lab), so there is
 * no org/unit WHERE clause — only authentication is enforced (reuse the existing
 * `withPermission({ equipment: ["read"] })` guard; unauth → 401). Spec: REQ-CATALOG-003.
 */
export const legalMetrologyRegulationsRouter = new Hono<{
  Variables: AuthVariables;
}>().get("/", ...withPermission({ equipment: ["read"] }), async (c) => {
  try {
    const rows = await db
      .select({
        id: legalMetrologyRegulation.id,
        category: legalMetrologyRegulation.category,
        kind: legalMetrologyRegulation.kind,
        valueMonths: legalMetrologyRegulation.valueMonths,
        byTechnology: legalMetrologyRegulation.byTechnology,
        anchor: legalMetrologyRegulation.anchor,
        operationalizedByDelegate:
          legalMetrologyRegulation.operationalizedByDelegate,
        regulationReference: legalMetrologyRegulation.regulationReference,
        provenance: legalMetrologyRegulation.provenance,
        note: legalMetrologyRegulation.note,
      })
      .from(legalMetrologyRegulation)
      .orderBy(legalMetrologyRegulation.category);

    return c.json({ data: rows });
  } catch (error) {
    console.error("Error listing legal-metrology regulations:", error);
    return c.json({ error: "Erro ao listar regulamentos de metrologia legal" }, 500);
  }
});
