import { db } from "@calibra-facil/db";
import { customer, serviceOrder } from "@calibra-facil/db/schema";
import {
  formatIntegrationCustomerAddress,
  type IntegrationCustomerPayload,
  type IntegrationSupplierPayload,
  type IntegrationTransporterPayload,
} from "@calibra-facil/shared";
import { and, desc, eq, isNotNull } from "drizzle-orm";

export async function loadCustomerPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationCustomerPayload[]> {
  const rows = await db
    .select({
      id: customer.id,
      name: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    })
    .from(customer)
    .where(eq(customer.labOrganizationId, organizationId))
    .limit(limit)
    .orderBy(desc(customer.updatedAt));

  return rows.map((row) => mapCustomerRowToPayload(row, organizationId));
}

function mapCustomerRowToPayload(
  row: {
    id: number;
    name: string;
    taxId: string | null;
    email: string | null;
    phone: string | null;
    address: (typeof customer.$inferSelect)["address"];
    createdAt: Date | null;
    updatedAt: Date | null;
  },
  organizationId: string,
): IntegrationCustomerPayload {
  return {
    externalId: `customer:${row.id}`,
    organizationId,
    name: row.name,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    address: formatIntegrationCustomerAddress(row.address),
    addressParts: row.address,
    createdAt: row.createdAt?.toISOString?.() ?? null,
    updatedAt: row.updatedAt?.toISOString?.() ?? null,
  };
}

export async function loadCustomerPayloadByExternalId(
  organizationId: string,
  externalId: string,
): Promise<IntegrationCustomerPayload | null> {
  const match = externalId.match(/^customer:(\d+)$/);
  if (!match?.[1]) return null;

  const customerId = Number(match[1]);
  if (!Number.isInteger(customerId) || customerId <= 0) return null;

  const [row] = await db
    .select({
      id: customer.id,
      name: customer.name,
      taxId: customer.taxId,
      email: customer.email,
      phone: customer.phone,
      address: customer.address,
      createdAt: customer.createdAt,
      updatedAt: customer.updatedAt,
    })
    .from(customer)
    .where(
      and(
        eq(customer.id, customerId),
        eq(customer.labOrganizationId, organizationId),
      ),
    )
    .limit(1);

  return row ? mapCustomerRowToPayload(row, organizationId) : null;
}

function normalizeDocumentDigits(value: string | null | undefined) {
  return value?.replace(/\D+/g, "") ?? "";
}

export function buildPessoaExternalId(params: {
  role: "supplier" | "transporter";
  sourceId: number;
  document: string | null;
}) {
  const documentDigits = normalizeDocumentDigits(params.document);
  return documentDigits.length > 0
    ? `${params.role}:document:${documentDigits}`
    : `${params.role}:service_order:${params.sourceId}`;
}

function dedupePessoaPayloads<
  TPayload extends IntegrationSupplierPayload | IntegrationTransporterPayload,
>(payloads: TPayload[], limit: number) {
  const deduped = new Map<string, TPayload>();

  for (const payload of payloads) {
    if (!deduped.has(payload.externalId)) {
      deduped.set(payload.externalId, payload);
    }
    if (deduped.size >= limit) {
      break;
    }
  }

  return [...deduped.values()];
}

export async function loadSupplierPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationSupplierPayload[]> {
  const rows = await db
    .select({
      id: serviceOrder.id,
      name: serviceOrder.thirdPartyName,
      taxId: serviceOrder.thirdPartyDocument,
      phone: serviceOrder.thirdPartyPhone,
      createdAt: serviceOrder.createdAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.organizationId, organizationId),
        isNotNull(serviceOrder.thirdPartyName),
      ),
    )
    .orderBy(desc(serviceOrder.updatedAt));

  return dedupePessoaPayloads(
    rows
      .filter((row) => row.name?.trim())
      .map((row) => ({
        externalId: buildPessoaExternalId({
          role: "supplier",
          sourceId: row.id,
          document: row.taxId,
        }),
        organizationId,
        pessoaRole: "supplier",
        name: row.name?.trim() ?? "",
        taxId: row.taxId,
        email: null,
        phone: row.phone,
        address: null,
        createdAt: row.createdAt?.toISOString?.() ?? null,
        updatedAt: row.updatedAt?.toISOString?.() ?? null,
      })),
    limit,
  );
}

export async function loadTransporterPayloads(
  organizationId: string,
  limit: number,
): Promise<IntegrationTransporterPayload[]> {
  const rows = await db
    .select({
      id: serviceOrder.id,
      name: serviceOrder.carrierName,
      taxId: serviceOrder.carrierDocument,
      createdAt: serviceOrder.createdAt,
      updatedAt: serviceOrder.updatedAt,
    })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.organizationId, organizationId),
        isNotNull(serviceOrder.carrierName),
      ),
    )
    .orderBy(desc(serviceOrder.updatedAt));

  return dedupePessoaPayloads(
    rows
      .filter((row) => row.name?.trim())
      .map((row) => ({
        externalId: buildPessoaExternalId({
          role: "transporter",
          sourceId: row.id,
          document: row.taxId,
        }),
        organizationId,
        pessoaRole: "transporter",
        name: row.name?.trim() ?? "",
        taxId: row.taxId,
        email: null,
        phone: null,
        address: null,
        createdAt: row.createdAt?.toISOString?.() ?? null,
        updatedAt: row.updatedAt?.toISOString?.() ?? null,
      })),
    limit,
  );
}
