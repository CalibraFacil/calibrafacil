/**
 * Re-encrypt the signing credentials under the current key encryption key:
 *
 *   docker compose exec api bun src/cli/reencrypt-signing-credentials.ts --dry-run
 *   docker compose exec api bun src/cli/reencrypt-signing-credentials.ts
 *   pnpm --dir apps/api reencrypt-signing-credentials [--dry-run]
 *
 * Moves every laboratory's signing credential (P12 + password) to the envelope
 * format under the CURRENT key (`SIGNING_MASTER_KEY` / `SIGNING_MASTER_KEY_ID`),
 * migrating the legacy rows and re-sealing the ones still under a previous key
 * (`SIGNING_MASTER_KEY_PREVIOUS`). Idempotent: a row already under the current
 * key is left alone. `--dry-run` opens every credential, prints what it would
 * change and writes nothing. Exits non-zero when any credential cannot be opened
 * (it is left untouched). See DEPLOYMENT.md, "Signing certificate custody".
 *
 * An operator tool: it sweeps every laboratory, so it runs on the owner
 * connection (`systemDb`, DATABASE_OWNER_URL). It reads the same environment as
 * the API. Nothing it prints is secret: ids, serials and outcomes only.
 */
import { parseArgs } from "node:util";
import { readSigningConfig } from "@calibra-facil/config";
import { signingKeyringFromEnv } from "@calibra-facil/signing";

import { reencryptSigningCredentials } from "../lib/reencrypt-signing-credentials";

const USAGE = `Usage: reencrypt-signing-credentials [--dry-run]`;

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`);
  process.exit(1);
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(USAGE);
    return 0;
  }

  let keyring;
  try {
    const signing = readSigningConfig();
    keyring = signingKeyringFromEnv({
      SIGNING_MASTER_KEY: signing.masterKey,
      SIGNING_MASTER_KEY_ID: signing.masterKeyId,
      SIGNING_MASTER_KEY_PREVIOUS: signing.masterKeyPrevious,
    });
  } catch (error) {
    return fail(
      `The signing key ring is misconfigured: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!keyring) fail("SIGNING_MASTER_KEY is not set.");

  const dryRun = values["dry-run"] === true;
  const summary = await reencryptSigningCredentials({ keyring, dryRun });

  for (const row of summary.rows) {
    console.log(
      `credential ${row.id} (org ${row.organizationId}, unit ${row.unitId}, serial ${row.serialNumber}): ${row.outcome} ${row.from} -> ${row.to}${row.error ? ` (${row.error})` : ""}`,
    );
  }
  console.log(
    `${dryRun ? "[dry run] " : ""}current KEK ${summary.currentKekId}: ${summary.total} credential(s), ${dryRun ? "would re-encrypt" : "re-encrypted"} ${summary.rewrapped}, unchanged ${summary.unchanged}, skipped ${summary.skipped}, failed ${summary.failed}`,
  );
  return summary.failed > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error("reencrypt-signing-credentials failed:", error);
    process.exit(1);
  });
