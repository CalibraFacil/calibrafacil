import { db } from "@calibra-facil/db";
import { integrationObjectLink } from "@calibra-facil/db/schema";
import {
  type ContaAzulReferenceItem,
  type IntegrationRemoteDocumentSummary,
  type IntegrationObjectLinkTarget,
  type ContaAzulReferenceDomain,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";
import { toRecord } from "./utils";
import { toIsoDate } from "./schedule-config";
import { upsertLink } from "./sync-state";

function getMetadataString(
  metadata: Record<string, unknown>,
  field: string,
): string | null {
  const value = metadata[field];
  return typeof value === "string" ? value : null;
}

export function buildEmptyRemoteDocumentSummary(): IntegrationRemoteDocumentSummary {
  return {
    totalCount: 0,
    availableCount: 0,
    unavailableCount: 0,
    salePdfCount: 0,
    fiscalXmlCount: 0,
    otherCount: 0,
    lastSyncedAt: null,
  };
}

export function summarizeRemoteDocumentLinks(
  links: {
    metadata: Record<string, unknown> | null;
    lastSyncedAt: Date | null;
  }[],
): IntegrationRemoteDocumentSummary {
  const summary = buildEmptyRemoteDocumentSummary();
  let lastSyncedAt: Date | null = null;

  for (const link of links) {
    const metadata = toRecord(link.metadata);
    const status = getMetadataString(metadata, "status");
    const documentKind = getMetadataString(metadata, "documentKind");

    summary.totalCount += 1;

    if (status === "available") {
      summary.availableCount += 1;
    } else if (status === "unavailable") {
      summary.unavailableCount += 1;
    }

    if (documentKind === "sale_pdf") {
      summary.salePdfCount += 1;
    } else if (documentKind === "fiscal_xml") {
      summary.fiscalXmlCount += 1;
    } else {
      summary.otherCount += 1;
    }

    if (
      link.lastSyncedAt &&
      (!lastSyncedAt || link.lastSyncedAt.getTime() > lastSyncedAt.getTime())
    ) {
      lastSyncedAt = link.lastSyncedAt;
    }
  }

  return {
    ...summary,
    lastSyncedAt: toIsoDate(lastSyncedAt),
  };
}

export function getContaAzulReferenceLinkTarget(
  domain: ContaAzulReferenceDomain,
): IntegrationObjectLinkTarget | null {
  switch (domain) {
    case "accounts":
    case "balances":
      return "financial_account";
    case "categories":
      return "category";
    case "costCenters":
      return "cost_center";
    case "dreCategories":
      return "dre_category";
    case "cest":
    case "ncm":
    case "productCategories":
    case "productEcommerceBrands":
    case "productEcommerceCategories":
    case "units":
      return "catalog_item";
    case "products":
      return "product";
    case "sellers":
      return "seller";
    case "serviceCategories":
      return "service";
    case "transfers":
      return "financial_transfer";
    default:
      return null;
  }
}

function getContaAzulReferenceRemoteEntityType(
  domain: ContaAzulReferenceDomain,
) {
  switch (domain) {
    case "accounts":
      return "conta_azul_financial_account";
    case "balances":
      return "conta_azul_financial_account_balance";
    case "categories":
      return "conta_azul_financial_category";
    case "costCenters":
      return "conta_azul_cost_center";
    case "dreCategories":
      return "conta_azul_dre_category";
    case "cest":
      return "conta_azul_product_cest";
    case "ncm":
      return "conta_azul_product_ncm";
    case "productCategories":
      return "conta_azul_product_category";
    case "productEcommerceBrands":
      return "conta_azul_product_ecommerce_brand";
    case "productEcommerceCategories":
      return "conta_azul_product_ecommerce_category";
    case "products":
      return "conta_azul_product";
    case "sellers":
      return "conta_azul_seller";
    case "serviceCategories":
      return "conta_azul_service";
    case "transfers":
      return "conta_azul_financial_transfer";
    case "units":
      return "conta_azul_product_unit";
    default:
      return "conta_azul_reference";
  }
}

export function buildContaAzulReferenceLink(params: {
  domain: ContaAzulReferenceDomain;
  item: ContaAzulReferenceItem;
  fetchedAt: string;
}): {
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string;
  remoteDisplayId: string;
  remoteEntityType: string;
  metadata: Record<string, unknown>;
} | null {
  const target = getContaAzulReferenceLinkTarget(params.domain);
  if (!target || !params.item.id.trim()) {
    return null;
  }

  return {
    target,
    localEntityId: `conta_azul:${params.domain}:${params.item.id}`,
    remoteEntityId: params.item.id,
    remoteDisplayId: params.item.name,
    remoteEntityType: getContaAzulReferenceRemoteEntityType(params.domain),
    metadata: {
      provider: "conta_azul",
      source: "reference_catalog",
      domain: params.domain,
      code: params.item.code,
      active: params.item.active,
      referenceMetadata: params.item.metadata,
      fetchedAt: params.fetchedAt,
    },
  };
}

function getLocalCatalogLinkFromContaAzulReference(params: {
  domain: ContaAzulReferenceDomain;
  item: ContaAzulReferenceItem;
}): {
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
} | null {
  const externalId = getMetadataString(
    toRecord(params.item.metadata),
    "externalId",
  );
  if (!externalId) {
    return null;
  }

  if (
    params.domain === "serviceCategories" &&
    externalId.startsWith("service:")
  ) {
    return {
      target: "catalog_item",
      localEntityId: externalId,
    };
  }

  if (
    params.domain === "products" &&
    (externalId.startsWith("product:") || externalId.startsWith("material:"))
  ) {
    return {
      target: "catalog_item",
      localEntityId: externalId,
    };
  }

  return null;
}

export function buildContaAzulReferenceLinks(params: {
  domain: ContaAzulReferenceDomain;
  item: ContaAzulReferenceItem;
  fetchedAt: string;
}): Array<{
  target: IntegrationObjectLinkTarget;
  localEntityId: string;
  remoteEntityId: string;
  remoteDisplayId: string;
  remoteEntityType: string;
  metadata: Record<string, unknown>;
}> {
  const referenceLink = buildContaAzulReferenceLink(params);
  if (!referenceLink) {
    return [];
  }

  const localCatalogLink = getLocalCatalogLinkFromContaAzulReference(params);
  if (!localCatalogLink) {
    return [referenceLink];
  }

  return [
    referenceLink,
    {
      ...referenceLink,
      target: localCatalogLink.target,
      localEntityId: localCatalogLink.localEntityId,
      metadata: {
        ...referenceLink.metadata,
        source: "reference_catalog_external_id",
        consultationOnly: params.domain === "serviceCategories",
        matchedBy: "id_externo",
      },
    },
  ];
}

export async function cacheContaAzulReferenceLinks(params: {
  integrationId: string;
  organizationId: string;
  domain: ContaAzulReferenceDomain;
  items: ContaAzulReferenceItem[];
}) {
  const fetchedAt = new Date().toISOString();
  const links = params.items.flatMap((item) =>
    buildContaAzulReferenceLinks({
      domain: params.domain,
      item,
      fetchedAt,
    }),
  );

  await Promise.all(
    links.map((link) =>
      upsertLink({
        integrationId: params.integrationId,
        organizationId: params.organizationId,
        target: link.target,
        localEntityId: link.localEntityId,
        remoteEntityId: link.remoteEntityId,
        remoteDisplayId: link.remoteDisplayId,
        remoteEntityType: link.remoteEntityType,
        metadata: link.metadata,
      }),
    ),
  );
}

export async function buildRemoteDocumentSummary(
  integrationId: string,
): Promise<IntegrationRemoteDocumentSummary> {
  const links = await db
    .select({
      metadata: integrationObjectLink.metadata,
      lastSyncedAt: integrationObjectLink.lastSyncedAt,
    })
    .from(integrationObjectLink)
    .where(
      and(
        eq(integrationObjectLink.integrationId, integrationId),
        eq(integrationObjectLink.target, "remote_document"),
      ),
    );

  return summarizeRemoteDocumentLinks(links);
}
