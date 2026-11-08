import { createRouter } from "../../../server/router";
import { financeEndpoints } from "@calibra-facil/contracts";
import { mount } from "../../../lib/endpoint-mount";
import { and, desc, eq, inArray } from "drizzle-orm";

import { billingDocument, customer } from "@calibra-facil/db/schema";
import {
  loadBillingDocumentExportPayload,
  exportBillingDocumentToPrimaryIntegration,
} from "../finance";
import type { IntegrationsEnv } from "../integrations";
import {
  withLabPermission,
  type AuthVariables,
} from "../../../middleware/permission";
import { forbidden, invalid, notFound } from "../../../lib/domain-errors";
import { orgDb } from "../../../lib/org-db";
import { buildUnitScopeCondition } from "../../../lib/units";

const PREFIX = "/api/finance/erp";

export const financeErpRouter = createRouter<{
  Variables: AuthVariables;
  Bindings: IntegrationsEnv;
}>();
mount(
  financeErpRouter,
  PREFIX,
  financeEndpoints.listErpExports,
  withLabPermission({ financial: ["read"] }),
  async (c) => {
    const member = c.get("member");
    const documents = await orgDb(member.organizationId).transaction((o) =>
      o
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
        .limit(50),
    );

    return { data: documents };
  },
);
mount(
  financeErpRouter,
  PREFIX,
  financeEndpoints.exportErpDocument,
  withLabPermission({ financial: ["export"] }),
  async (c, { params }) => {
    const member = c.get("member");
    const documentId = params.id;

    const payload = await orgDb(member.organizationId).transaction((o) =>
      loadBillingDocumentExportPayload(member.organizationId, documentId, o),
    );
    if (!payload) {
      throw notFound("billing_document_not_found", "Documento nao encontrado");
    }

    if (
      member.selectedUnitScope !== "all" &&
      payload.unitId !== member.activeUnitId
    ) {
      throw forbidden(
        "billing_document_outside_unit_scope",
        "Documento fora do escopo da unidade ativa",
      );
    }

    try {
      const exported = await exportBillingDocumentToPrimaryIntegration({
        organizationId: member.organizationId,
        documentId,
        env: c.env,
      });

      return { data: exported };
    } catch (error) {
      // A status the definition does not describe: answered as a ready Response.
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
