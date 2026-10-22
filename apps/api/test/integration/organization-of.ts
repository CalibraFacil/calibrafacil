import { sql, type SQL } from "drizzle-orm";

/**
 * Organization column of the parents the tenant children of migration 0118 hang
 * from, for fixtures that insert a child row knowing only its parent's id.
 */
const PARENT_ORGANIZATION_COLUMN = {
  asset: "lab_organization_id",
  authorized_signatory: "organization_id",
  billing_document: "organization_id",
  calibration_job: "organization_id",
  calibration_request: "organization_id",
  customer: "lab_organization_id",
  personnel_competence: "organization_id",
  receivable_installment: "organization_id",
  service_order: "organization_id",
  service_order_execution: "organization_id",
  service_order_quote: "organization_id",
  training_record: "organization_id",
} as const;

/**
 * The organization of an existing parent row, as an SQL expression a fixture can
 * put in the `organizationId` of its child row: the child then belongs to the
 * same laboratory as the parent it names, which is what the composite
 * (organization_id, parent_id) keys require.
 */
export function organizationOf(
  parent: keyof typeof PARENT_ORGANIZATION_COLUMN,
  id: number,
): SQL<string> {
  return sql<string>`(select ${sql.identifier(PARENT_ORGANIZATION_COLUMN[parent])} from ${sql.identifier(parent)} where "id" = ${id})`;
}
