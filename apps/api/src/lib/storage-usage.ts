// =============================================================================
// STORAGE USAGE METERING (plan limit: `storage`) — pure aggregator
// =============================================================================
//
// Measures the R2 bytes an organization is responsible for. Only the source
// tables that RECORD an object's byte size on its row can be summed accurately
// without a full (slow/expensive) R2 listing. The DB-querying wrapper lives in
// `storage-usage-db.ts`; the arithmetic + tenant-scoping contract lives here so
// it is unit-testable without a database connection.

/**
 * A single stored object contributing to an organization's storage footprint.
 */
export interface StoredObjectSize {
  organizationId: string;
  bytes: number;
}

/**
 * Sum the on-disk bytes an organization is responsible for.
 *
 * Rows may span multiple organizations (e.g. an unscoped fixture); only rows
 * whose `organizationId` matches are counted, so tenant scoping is preserved
 * even if a caller forgets a WHERE clause. Non-finite / negative sizes are
 * treated as 0 so a bad row can never corrupt the total.
 */
export function sumStorageUsageForOrganization(
  organizationId: string,
  rows: Iterable<StoredObjectSize>,
): number {
  let total = 0;
  for (const row of rows) {
    if (row.organizationId !== organizationId) continue;
    if (Number.isFinite(row.bytes) && row.bytes > 0) {
      total += row.bytes;
    }
  }
  return total;
}
