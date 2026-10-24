import type { OrgDb } from "@calibra-facil/db/for-org";
import { inOrgTransaction } from "../../lib/org-transaction";
import {
  calibrationJob,
  commercialAgreement,
  customer,
  integrationObjectLink,
  service,
  serviceOrder,
  serviceOrderExecution,
  serviceOrderExecutionItem,
} from "@calibra-facil/db/schema";
import {
  type ContaAzulConnectionConfig,
  type IntegrationSyncTarget,
} from "@calibra-facil/shared";
import { and, count, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { loadBillingDocumentPayloadsForIntegration } from "../../lib/finance";
import {
  loadBillingDocumentPayloads,
  loadCatalogItemPayloads,
  loadContractPayloads,
  loadPayablePayloads,
  loadServiceOrderPayloads,
} from "./payloads-commercial";
import {
  buildPessoaExternalId,
  loadCustomerPayloads,
  loadSupplierPayloads,
  loadTransporterPayloads,
} from "./payloads-parties";
import { type GenericConnectionRecord } from "./types";

export async function loadTargetPayloads(
  organizationId: string,
  target: IntegrationSyncTarget,
  limit: number,
  executor?: OrgDb,
) {
  switch (target) {
    case "catalog_item":
      return loadCatalogItemPayloads(organizationId, limit, executor);
    case "contract":
      return loadContractPayloads(organizationId, limit, executor);
    case "customer":
      return loadCustomerPayloads(organizationId, limit, executor);
    case "supplier":
      return loadSupplierPayloads(organizationId, limit, executor);
    case "transporter":
      return loadTransporterPayloads(organizationId, limit, executor);
    case "service_order":
      return loadServiceOrderPayloads(organizationId, limit, executor);
    case "billing_document":
      return loadBillingDocumentPayloads(organizationId, limit, executor);
    case "payable":
      return loadPayablePayloads(organizationId, limit, executor);
  }
}

export async function countLocalTargetRecords(
  organizationId: string,
  target: IntegrationSyncTarget,
  executor?: OrgDb,
) {
  return inOrgTransaction(organizationId, executor, async (o) => {
    switch (target) {
      case "catalog_item": {
        const [row] = await o
          .select({ total: count() })
          .from(service)
          .where(eq(service.organizationId, organizationId));
        return Number(row?.total ?? 0);
      }
      case "contract": {
        const [row] = await o
          .select({ total: count() })
          .from(commercialAgreement)
          .where(
            and(
              eq(commercialAgreement.organizationId, organizationId),
              eq(commercialAgreement.status, "ACTIVE"),
            ),
          );
        return Number(row?.total ?? 0);
      }
      case "customer": {
        const [row] = await o
          .select({ total: count() })
          .from(customer)
          .where(eq(customer.labOrganizationId, organizationId));
        return Number(row?.total ?? 0);
      }
      case "supplier": {
        const rows = await o
          .select({
            id: serviceOrder.id,
            name: serviceOrder.thirdPartyName,
            taxId: serviceOrder.thirdPartyDocument,
          })
          .from(serviceOrder)
          .where(
            and(
              eq(serviceOrder.organizationId, organizationId),
              isNotNull(serviceOrder.thirdPartyName),
            ),
          );
        return new Set(
          rows
            .filter((row) => row.name?.trim())
            .map((row) =>
              buildPessoaExternalId({
                role: "supplier",
                sourceId: row.id,
                document: row.taxId,
              }),
            ),
        ).size;
      }
      case "transporter": {
        const rows = await o
          .select({
            id: serviceOrder.id,
            name: serviceOrder.carrierName,
            taxId: serviceOrder.carrierDocument,
          })
          .from(serviceOrder)
          .where(
            and(
              eq(serviceOrder.organizationId, organizationId),
              isNotNull(serviceOrder.carrierName),
            ),
          );
        return new Set(
          rows
            .filter((row) => row.name?.trim())
            .map((row) =>
              buildPessoaExternalId({
                role: "transporter",
                sourceId: row.id,
                document: row.taxId,
              }),
            ),
        ).size;
      }
      case "service_order": {
        const [row] = await o
          .select({ total: count() })
          .from(calibrationJob)
          .where(
            and(
              eq(calibrationJob.organizationId, organizationId),
              inArray(calibrationJob.status, [
                "DRAFT",
                "IN_PROGRESS",
                "REVIEW",
                "APPROVED",
                "SUPERSEDED",
              ]),
            ),
          );
        return Number(row?.total ?? 0);
      }
      case "billing_document": {
        const payloads = await loadBillingDocumentPayloadsForIntegration(
          organizationId,
          500,
          o,
        );
        return payloads.length;
      }
      case "payable": {
        const [row] = await o
          .select({ total: count() })
          .from(serviceOrderExecutionItem)
          .innerJoin(
            serviceOrderExecution,
            eq(serviceOrderExecutionItem.executionId, serviceOrderExecution.id),
          )
          .innerJoin(
            serviceOrder,
            eq(serviceOrderExecution.serviceOrderId, serviceOrder.id),
          )
          .where(
            and(
              eq(serviceOrder.organizationId, organizationId),
              isNotNull(serviceOrder.thirdPartyName),
              isNotNull(serviceOrderExecution.finishedAt),
              gt(serviceOrderExecutionItem.unitCostCents, 0),
            ),
          );
        return Number(row?.total ?? 0);
      }
    }
  });
}

export async function countLinkedTargetRecords(
  organizationId: string,
  integrationId: string,
  target: IntegrationSyncTarget,
  executor?: OrgDb,
) {
  return inOrgTransaction(organizationId, executor, async (o) => {
    const [row] = await o
      .select({ total: count() })
      .from(integrationObjectLink)
      .where(
        and(
          eq(integrationObjectLink.integrationId, integrationId),
          eq(integrationObjectLink.target, target),
        ),
      );

    return Number(row?.total ?? 0);
  });
}

export function hasRemoteValidation(record: GenericConnectionRecord) {
  return Boolean(
    record.integration.lastValidatedAt &&
    !record.integration.lastValidationError,
  );
}

export function isContaAzulCommercialCatalogEnabled(
  config: ContaAzulConnectionConfig,
) {
  return config.enabledTargets.services || config.enabledTargets.products;
}

export function isContaAzulCommercialExportEnabled(
  config: ContaAzulConnectionConfig,
) {
  return (
    config.enabledTargets.sales ||
    (config.exportMode === "budget_to_sale" && config.enabledTargets.budgets)
  );
}
