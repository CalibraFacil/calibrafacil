import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { billingDocument, customer } from "@calibra-facil/db/schema";
import { getOrganizationPlanAccess } from "../../lib/organization-plan";
import {
  exportBillingDocumentToPrimaryIntegration,
  loadBillingDocumentExportPayload,
} from "../../lib/finance";
import type { IntegrationsEnv } from "../../lib/integrations";
import { withInvalidation } from "../../middleware/cache";
import {
  withLabPermission,
  type AuthVariables,
} from "../../middleware/permission";
import { requireFeature } from "../../middleware/tier-guard";
import { buildUnitScopeCondition } from "../../lib/units";

export const financeErpRouter = new Hono<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>()
  .get(
    "/exports",
    ...withLabPermission({ financial: ["read"] }),
    requireFeature("financial"),
    async (c) => {
      const member = c.get("member");
      const access = await getOrganizationPlanAccess(member.organizationId);
      const documents = await db
        .select({
          id: billingDocument.id,
          documentNumber: billingDocument.documentNumber,
          customerName: customer.name,
          status: billingDocument.status,
          exportStatus: billingDocument.exportStatus,
          exportedAt: billingDocument.exportedAt,
          totalCents: billingDocument.totalCents,
          currency: billingDocument.currency,
          dueDate: billingDocument.dueDate,
          issueDate: billingDocument.issueDate,
        })
        .from(billingDocument)
        .innerJoin(customer, eq(billingDocument.customerId, customer.id))
        .where(
          and(
            eq(billingDocument.organizationId, member.organizationId),
            buildUnitScopeCondition(billingDocument.unitId, member),
            inArray(billingDocument.status, ["ISSUED", "PAID", "OVERDUE"]),
          ),
        )
        .orderBy(desc(billingDocument.updatedAt))
        .limit(50);

      return c.json({
        billing: {
          planId: access.planId,
          planName: access.planName,
          hasFinancialIntegrations: access.entitlements.includes(
            "financial_integrations",
          ),
        },
        data: documents,
      });
    },
  )
  .post(
    "/documents/:id/export",
    ...withLabPermission({ financial: ["export"] }),
    requireFeature("financial"),
    requireFeature("financial_integrations"),
    withInvalidation("finance"),
    async (c) => {
      const member = c.get("member");
      const documentId = Number.parseInt(c.req.param("id"), 10);

      if (!Number.isInteger(documentId)) {
        return c.json({ error: "ID invalido" }, 400);
      }

      const payload = await loadBillingDocumentExportPayload(
        member.organizationId,
        documentId,
      );
      if (!payload) {
        return c.json({ error: "Documento nao encontrado" }, 404);
      }

      if (
        member.selectedUnitScope !== "all" &&
        payload.unitId !== member.activeUnitId
      ) {
        return c.json(
          { error: "Documento fora do escopo da unidade ativa" },
          403,
        );
      }

      try {
        const exported = await exportBillingDocumentToPrimaryIntegration({
          organizationId: member.organizationId,
          documentId,
          env: c.env,
        });

        return c.json({ data: exported });
      } catch (error) {
        return c.json(
          {
            error:
              error instanceof Error
                ? error.message
                : "Falha ao exportar documento",
          },
          502,
        );
      }
    },
  );
