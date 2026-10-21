/**
 * Soft-delete a laboratory (records retention, decision Q16):
 *
 *   pnpm --dir apps/api soft-delete-lab --slug lab-exemplo \
 *     --reason "Encerramento das atividades"
 *
 * The laboratory is suspended (nobody can sign in) and marked deleted; every
 * record it holds stays. Postgres refuses a real DELETE of a laboratory, and
 * the records purge job (RECORDS_PURGE_ENABLED, see DEPLOYMENT.md) only removes
 * it once its newest record is older than its retention period and no legal
 * hold applies. Reads the same environment as the API (DATABASE_URL).
 */
import { parseArgs } from "node:util";
import { db } from "@calibra-facil/db";
import { organization } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

import { softDeleteLabOrganization } from "../lib/records-retention";

const USAGE = `Usage: soft-delete-lab --slug <laboratory slug> --reason <why>`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      slug: { type: "string" },
      reason: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }
  const slug = values.slug?.trim();
  if (!slug) fail("--slug is required.");
  const reason = values.reason?.trim();
  if (!reason) fail("--reason is required.");

  const [lab] = await db
    .select({ id: organization.id, name: organization.name })
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1);
  if (!lab) fail(`No organization has the slug "${slug}".`);

  const outcome = await softDeleteLabOrganization({
    organizationId: lab.id,
    deletedBy: null,
    reason,
  });

  switch (outcome.status) {
    case "soft_deleted":
      console.log(
        `Laboratory "${lab.name}" (${slug}) soft-deleted at ${outcome.deletedAt.toISOString()}; its records are retained.`,
      );
      return;
    case "already_deleted":
      console.log(`Laboratory "${lab.name}" (${slug}) was already deleted.`);
      return;
    case "not_lab":
      fail(`"${slug}" is not a laboratory organization.`);
    case "not_found":
      fail(`No organization has the slug "${slug}".`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("soft-delete-lab failed:", error);
    process.exit(1);
  });
