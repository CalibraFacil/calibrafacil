/**
 * The command line of `reencrypt-signing-credentials`, apart from the process
 * (`src/cli/reencrypt-signing-credentials.ts` wires `process.argv`, the real
 * configuration and the database sweep in), so the exit codes and what it
 * prints are testable.
 *
 * Nothing read from the environment is ever printed: the key ring settings go
 * through the same no-echo rules the API applies at start (`signingIssues`), and
 * a failure of the sweep prints the kind of error, not its message (a database
 * error message carries the statement and its parameters, ciphertext included).
 */
import { parseArgs } from "node:util";
import { signingIssues } from "@calibra-facil/config";
import { signingKeyringFromEnv } from "@calibra-facil/signing";

import type { reencryptSigningCredentials } from "./reencrypt-signing-credentials";

const USAGE = `Usage: reencrypt-signing-credentials [--dry-run]`;

export type ReencryptCliDeps = {
  /** The signing settings of the environment (`readSigningConfig`). */
  readSigning: () => {
    readonly masterKey: string | undefined;
    readonly masterKeyId: string | undefined;
    readonly masterKeyPrevious: string | undefined;
  };
  reencrypt: typeof reencryptSigningCredentials;
  log: (line: string) => void;
  error: (line: string) => void;
};

/** @returns the process exit code: 0 ok, 1 on a usage error, a bad key ring or any credential that failed. */
export async function runReencryptCli(
  argv: readonly string[],
  deps: ReencryptCliDeps,
): Promise<number> {
  const fail = (message: string): number => {
    deps.error(`${message}\n\n${USAGE}`);
    return 1;
  };

  let values;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        "dry-run": { type: "boolean", default: false },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch {
    return fail("Unknown or malformed arguments.");
  }
  if (values.help) {
    deps.log(USAGE);
    return 0;
  }

  let signing;
  try {
    signing = deps.readSigning();
  } catch {
    return fail("The signing configuration could not be read.");
  }
  const issues = signingIssues(signing);
  if (issues.length > 0) {
    return fail(
      `The signing key ring is misconfigured:\n${issues
        .map((issue) => `  ${issue.variable}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  let keyring;
  try {
    keyring = signingKeyringFromEnv({
      SIGNING_MASTER_KEY: signing.masterKey,
      SIGNING_MASTER_KEY_ID: signing.masterKeyId,
      SIGNING_MASTER_KEY_PREVIOUS: signing.masterKeyPrevious,
    });
  } catch (error) {
    // The key ring errors never echo a value (see envelope.ts).
    return fail(
      `The signing key ring is misconfigured: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  if (!keyring) return fail("SIGNING_MASTER_KEY is not set.");

  const dryRun = values["dry-run"] === true;
  let summary;
  try {
    summary = await deps.reencrypt({ keyring, dryRun });
  } catch (error) {
    deps.error(
      `reencrypt-signing-credentials failed (${error instanceof Error ? error.name : "error"}); see the server and database logs.`,
    );
    return 1;
  }

  for (const row of summary.rows) {
    deps.log(
      `credential ${row.id} (org ${row.organizationId}, unit ${row.unitId}, serial ${row.serialNumber}): ${row.outcome} ${row.from} -> ${row.to}${row.error ? ` (${row.error})` : ""}`,
    );
  }
  deps.log(
    `${dryRun ? "[dry run] " : ""}current KEK ${summary.currentKekId}: ${summary.total} credential(s), ${dryRun ? "would re-encrypt" : "re-encrypted"} ${summary.rewrapped}, unchanged ${summary.unchanged}, skipped ${summary.skipped}, failed ${summary.failed}`,
  );
  return summary.failed > 0 ? 1 : 0;
}
