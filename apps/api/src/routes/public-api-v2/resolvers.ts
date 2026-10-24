import { publicApiResourceRef } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { resolvePublicApiUnitScope } from "../../lib/public-api";
import { orgDb } from "../../lib/org-db";

export async function resolveUnitIdForWrite(params: {
  organizationId: string;
  requestedUnitId?: number;
}) {
  const scope = await resolvePublicApiUnitScope({
    organizationId: params.organizationId,
    requestedUnitId: params.requestedUnitId ?? null,
  });

  if (params.requestedUnitId) {
    return params.requestedUnitId;
  }

  if (scope.selectedUnits.length === 1) {
    return scope.selectedUnits[0]!.id;
  }

  throw new Error("Informe unitId para operações de escrita multiunidade");
}

export async function resolveExternalResourceId(params: {
  organizationId: string;
  resourceType: "customer" | "asset" | "request" | "job";
  value: string;
}) {
  const numericId = Number.parseInt(params.value, 10);
  if (!Number.isNaN(numericId) && String(numericId) === params.value) {
    return numericId;
  }

  const [ref] = await orgDb(params.organizationId).transaction((o) =>
    o
      .select()
      .from(publicApiResourceRef)
      .where(
        and(
          eq(publicApiResourceRef.organizationId, params.organizationId),
          eq(publicApiResourceRef.resourceType, params.resourceType),
          eq(publicApiResourceRef.externalId, params.value),
        ),
      )
      .limit(1),
  );

  if (!ref?.resourceId) {
    return null;
  }

  return Number.parseInt(ref.resourceId, 10);
}

export async function resolveCustomerId(params: {
  organizationId: string;
  customerId?: number;
  customerExternalId?: string;
}) {
  if (params.customerId) {
    return params.customerId;
  }

  if (!params.customerExternalId) {
    return null;
  }

  return resolveExternalResourceId({
    organizationId: params.organizationId,
    resourceType: "customer",
    value: params.customerExternalId,
  });
}

export async function resolveAssetId(params: {
  organizationId: string;
  assetId?: number;
  assetExternalId?: string;
}) {
  if (params.assetId) {
    return params.assetId;
  }

  if (!params.assetExternalId) {
    return null;
  }

  return resolveExternalResourceId({
    organizationId: params.organizationId,
    resourceType: "asset",
    value: params.assetExternalId,
  });
}
