import { db } from "@calibra-facil/db";
import { supplier } from "@calibra-facil/db/schema";
import { and, eq, isNull, sql } from "drizzle-orm";

export interface SupplierRow {
  id: number;
  organizationId: string;
  name: string;
  taxId: string | null;
  email: string | null;
  phone: string | null;
  kind: "outsourced_lab" | "transporter" | "both" | "other";
  notes: string | null;
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Case-insensitive lookup with auto-create. Used by the outsourced-cost
 * normalization in slice 6 → slice 7 transition: when an operator
 * writes a free-text supplierName the engine looks it up here and
 * creates a supplier record on first sight.
 */
export async function findOrCreateSupplierByName(params: {
  organizationId: string;
  name: string;
  defaultKind?: SupplierRow["kind"];
}): Promise<SupplierRow | null> {
  const trimmed = params.name.trim();
  if (!trimmed) return null;

  const [existing] = await db
    .select()
    .from(supplier)
    .where(
      and(
        eq(supplier.organizationId, params.organizationId),
        isNull(supplier.archivedAt),
        sql`lower(trim(${supplier.name})) = ${normalize(trimmed)}`,
      ),
    )
    .limit(1);

  if (existing) {
    return existing;
  }

  const inserted = await db
    .insert(supplier)
    .values({
      organizationId: params.organizationId,
      name: trimmed,
      kind: params.defaultKind ?? "other",
    })
    .returning();

  const created = inserted[0];
  return created ?? null;
}

/**
 * Reconcile a supplier with an incoming Conta Azul person link via
 * tax-id equality (preferred) or normalized-name equality (fallback).
 * Returns the matched supplier row when found; the caller decides
 * whether to write the `integrationObjectLink` for the supplier.
 */
export async function reconcileSupplierWithPersonLink(params: {
  organizationId: string;
  remoteName: string;
  remoteTaxId: string | null;
}): Promise<SupplierRow | null> {
  if (params.remoteTaxId) {
    const trimmedTaxId = params.remoteTaxId.trim();
    if (trimmedTaxId) {
      const [byTaxId] = await db
        .select()
        .from(supplier)
        .where(
          and(
            eq(supplier.organizationId, params.organizationId),
            eq(supplier.taxId, trimmedTaxId),
            isNull(supplier.archivedAt),
          ),
        )
        .limit(1);
      if (byTaxId) return byTaxId;
    }
  }

  const trimmedName = params.remoteName.trim();
  if (!trimmedName) return null;
  const [byName] = await db
    .select()
    .from(supplier)
    .where(
      and(
        eq(supplier.organizationId, params.organizationId),
        isNull(supplier.archivedAt),
        sql`lower(trim(${supplier.name})) = ${normalize(trimmedName)}`,
      ),
    )
    .limit(1);
  return byName ?? null;
}

export async function listSuppliers(params: {
  organizationId: string;
  includeArchived?: boolean;
}): Promise<SupplierRow[]> {
  const conditions = [eq(supplier.organizationId, params.organizationId)];
  if (!params.includeArchived) {
    conditions.push(isNull(supplier.archivedAt));
  }
  const rows = await db
    .select()
    .from(supplier)
    .where(and(...conditions))
    .orderBy(supplier.name);
  return rows;
}
