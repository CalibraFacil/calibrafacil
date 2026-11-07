import type { OrgDb } from "@calibra-facil/db/for-org";
import {
  asset,
  customer,
  customerGroup,
  organization,
} from "@calibra-facil/db/schema";
import type {
  CreateCustomerInput,
  UpdateCustomerSchema,
} from "@calibra-facil/schemas";
import { toRecord } from "@calibra-facil/shared/record";
import { and, eq } from "drizzle-orm";
import type { z } from "zod";
import { invalid } from "../../lib/domain-errors";
import type { OrgContext } from "../../lib/org-context";
import { createClientOrganizationAsServiceOwner } from "../portal";
import { uniqueSlug } from "../../lib/unique-slug";

/**
 * The customer writes of a laboratory, shared by the lab routes
 * (`domains/customers/routes/customers.ts`) and the public API v2 (`domains/public-api/routes/public-api-v2/customers.ts`):
 * one place for the CLIENT organization, the insert and its audit row, the
 * field-level update audit and the delete that keeps the ISO/IEC 17025 trail.
 */

type CustomerRow = typeof customer.$inferSelect;
type UpdateCustomerInput = z.infer<typeof UpdateCustomerSchema>;

/**
 * The CLIENT organization a new customer lives in (3B model: the customer's
 * portal tenant). It is an identity-table write on the system path (its own
 * connection), so it runs before the transaction the customer is written in.
 */
export function provisionCustomerOrganization(name: string) {
  return createClientOrganizationAsServiceOwner({
    name,
    slug: uniqueSlug(name),
  });
}

/** A branch may only join a group owned by the same lab (cross-tenant guard). */
export async function groupBelongsToLab(
  groupId: number,
  labOrganizationId: string,
  o: Pick<OrgDb, "select">,
): Promise<boolean> {
  const [group] = await o
    .select({ id: customerGroup.id })
    .from(customerGroup)
    .where(
      and(
        eq(customerGroup.id, groupId),
        eq(customerGroup.labOrganizationId, labOrganizationId),
      ),
    )
    .limit(1);
  return Boolean(group);
}

/**
 * Inserts the laboratory's customer (`authOrganizationId` is the CLIENT
 * organization, for portal access) and its `create` audit row.
 */
export async function createLabCustomer(
  ctx: OrgContext,
  input: CreateCustomerInput,
  authOrganizationId: string,
) {
  const [created] = await ctx.o
    .insert(customer)
    .values({
      name: input.name,
      tradeName: input.tradeName || null,
      taxId: input.taxId || null,
      email: input.email || null,
      phone: input.phone || null,
      address: input.address || null,
      authOrganizationId,
      labOrganizationId: ctx.org,
      groupId: input.groupId ?? null,
    })
    .returning();
  if (!created) throw new Error("Erro ao criar cliente");

  await ctx.audit("customer", created.id, {
    action: "create",
    changes: { customer: { old: null, new: created } },
  });
  return created;
}

/**
 * Applies the fields of `input` that were sent (an `undefined` is "not sent")
 * and records the ones that changed. A group reassignment must target a group
 * owned by the same lab (400 `invalid_request`).
 */
export async function updateLabCustomer(
  ctx: OrgContext,
  existing: CustomerRow,
  input: UpdateCustomerInput,
) {
  if (
    input.groupId != null &&
    !(await groupBelongsToLab(input.groupId, ctx.org, ctx.o))
  ) {
    throw invalid("invalid_request", "Grupo invalido");
  }

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const existingRecord = toRecord(existing);
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const oldValue = existingRecord[key];
    if (JSON.stringify(oldValue) !== JSON.stringify(value)) {
      changes[key] = { old: oldValue, new: value };
    }
  }

  const [updated] = await ctx.o
    .update(customer)
    .set({ ...input, updatedAt: new Date() })
    .where(
      and(
        eq(customer.id, existing.id),
        eq(customer.labOrganizationId, ctx.org),
      ),
    )
    .returning();

  if (Object.keys(changes).length > 0) {
    await ctx.audit("customer", existing.id, { action: "update", changes });
  }
  return updated;
}

/**
 * Deletes the customer and its CLIENT organization after the audit rows that
 * must outlive it. Retention (decision Q16): Postgres refuses the delete while
 * regulated records still reference the customer (a foreign-key violation,
 * `isReferencedRowViolation`); the audit rows share the transaction, so a refused
 * delete rolls them back and leaves no "delete" entry behind.
 */
export async function deleteLabCustomer(
  ctx: OrgContext,
  existing: CustomerRow,
) {
  // CMP-06 (#649): the customer_id FK no longer cascades (soft reference), so
  // this row survives the delete below.
  await ctx.audit("customer", existing.id, {
    action: "delete",
    changes: { customer: { old: existing, new: null } },
  });

  // CMP-07 (#692): deleting the customer cascades its assets
  // (asset.customer_id -> customer, intentional). Record a 'delete' audit row
  // for EACH asset first: the asset_audit_log.asset_id FK no longer cascades,
  // so these rows survive the delete and the ISO/IEC 17025 trail is preserved.
  const customerAssets = await ctx.o
    .select()
    .from(asset)
    .where(eq(asset.customerId, existing.id));
  for (const assetRow of customerAssets) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one audit row after the other on the same transaction.
    await ctx.audit("asset", assetRow.id, {
      action: "delete",
      changes: { asset: { old: assetRow, new: null } },
      reason: "Cliente excluído",
    });
  }

  await ctx.o
    .delete(customer)
    .where(
      and(
        eq(customer.id, existing.id),
        eq(customer.labOrganizationId, ctx.org),
      ),
    );
  // Also delete the associated (CLIENT) organization.
  await ctx.o
    .delete(organization)
    .where(eq(organization.id, existing.authOrganizationId));
}
