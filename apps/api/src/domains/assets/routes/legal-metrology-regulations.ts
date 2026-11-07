import { createRouter } from "../../../server/router";
import { listLegalMetrologyRegulations } from "../legal-metrology-regulations";
import {
  withPermission,
  type AuthVariables,
} from "../../../middleware/permission";

/**
 * GET /api/legal-metrology-regulations — the GLOBAL legal-metrology regulation catalog
 * (deferred #3 of #423). Read-only, auth-required reference data the lab regime form
 * auto-fills from. NOT tenant-scoped (the same Portarias apply to every lab), so there is
 * no org/unit WHERE clause — only authentication is enforced (reuse the existing
 * `withPermission({ equipment: ["read"] })` guard; unauth → 401). Spec: REQ-CATALOG-003.
 */
export const legalMetrologyRegulationsRouter = createRouter<{
  Variables: AuthVariables;
}>().get("/", ...withPermission({ equipment: ["read"] }), async (c) => {
  const rows = await listLegalMetrologyRegulations();

  return c.json({ data: rows });
});
