/**
 * Verify the audit-trail hash chain on demand (roadmap 2 B1):
 *
 *   pnpm --dir apps/api verify-audit-chain                 every laboratory
 *   pnpm --dir apps/api verify-audit-chain --slug lab-x    one laboratory, by slug
 *   pnpm --dir apps/api verify-audit-chain --org <id>      one laboratory, by organization id
 *   pnpm --dir apps/api verify-audit-chain --record        also write the checkpoint / the
 *                                                          break events and notify the admins
 *
 * It recomputes each laboratory's chain of `job_audit_log` (migration 0131) and prints the first
 * break of each broken one: the kind, the position in the chain and the row to look at. Read-only
 * unless `--record` (what the daily `audit-chain-verify` cron does). Exit code 0 when every chain is
 * intact, 1 when any is broken, 2 on a usage error. Nothing is repaired.
 *
 * An operator tool: it runs as the table owner (`systemDb`) like the cron, and reads the same
 * environment as the API (DATABASE_URL, DATABASE_OWNER_URL).
 */
import { parseArgs } from "node:util";
import { systemDb as ownerDb } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

import { verifyAuditChains } from "../lib/audit-chain";

const USAGE = `Usage: verify-audit-chain [--org <organization id> | --slug <laboratory slug>] [--record]`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(2);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      org: { type: "string" },
      slug: { type: "string" },
      record: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return 0;
  }
  if (values.org !== undefined && values.slug !== undefined) {
    fail("Use --org or --slug, not both.");
  }

  let organizationId = values.org?.trim() || undefined;
  if (values.slug !== undefined) {
    const slug = values.slug.trim();
    const [lab] = await ownerDb
      .select({ id: organization.id })
      .from(organization)
      .where(eq(organization.slug, slug))
      .limit(1);
    if (!lab) fail(`No organization has the slug "${slug}".`);
    organizationId = lab.id;
  }

  const report = await verifyAuditChains({
    record: values.record,
    ...(organizationId === undefined ? {} : { organizationId }),
  });

  console.log(
    `${report.chains} chain(s), ${report.links} link(s): ${report.intact} intact, ${report.broken.length} broken.`,
  );
  for (const found of report.broken) {
    console.log(
      `BROKEN ${found.table} organization=${found.organizationId} kind=${found.kind}` +
        (found.chainSeq === null ? "" : ` chain_seq=${found.chainSeq}`) +
        (found.rowId === null ? "" : ` row_id=${found.rowId}`) +
        (found.expectedHash === null ? "" : ` expected=${found.expectedHash}`) +
        (found.actualHash === null ? "" : ` actual=${found.actualHash}`),
    );
  }
  if (values.record) {
    console.log(
      `Recorded: ${report.checkpoints} checkpoint(s), ${report.announced.length} new break(s) announced.`,
    );
  }
  return report.broken.length > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(2);
  });
