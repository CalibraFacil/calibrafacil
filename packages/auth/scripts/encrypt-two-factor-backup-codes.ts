/**
 * One-off migration: encrypt pre-existing plaintext two-factor backup codes.
 *
 * Better Auth's twoFactor plugin stored backup codes as plain JSON until we
 * enabled `backupCodeOptions.storeBackupCodes: "encrypted"` (the TOTP secret
 * was always encrypted). Rows enrolled before that change still hold a
 * plaintext JSON array and would fail to decrypt once the option is active.
 *
 * This script re-encrypts those rows with the exact primitive the plugin
 * uses (`symmetricEncrypt` from better-auth/crypto, keyed by
 * BETTER_AUTH_SECRET), verifying each ciphertext round-trips before writing.
 * Already-encrypted rows (non-JSON values) are skipped, so the script is
 * idempotent.
 *
 * Run from packages/auth with the production env available:
 *
 *   DATABASE_URL=... BETTER_AUTH_SECRET=... bun scripts/encrypt-two-factor-backup-codes.ts
 *
 * Pass --dry-run to report what would change without writing.
 */
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { getDb } from "@calibra-facil/db";
import { twoFactor } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";

const dryRun = process.argv.includes("--dry-run");

const secret = process.env.BETTER_AUTH_SECRET?.trim();
if (!secret || secret.length < 32) {
  throw new Error(
    "BETTER_AUTH_SECRET (>= 32 chars) is required and must match the API's secret",
  );
}

function isPlaintextBackupCodes(value: string): boolean {
  if (!value.trim().startsWith("[")) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    return (
      Array.isArray(parsed) && parsed.every((code) => typeof code === "string")
    );
  } catch {
    return false;
  }
}

const db = getDb();
const rows = await db
  .select({ id: twoFactor.id, backupCodes: twoFactor.backupCodes })
  .from(twoFactor);

let encrypted = 0;
let skipped = 0;

for (const row of rows) {
  if (!isPlaintextBackupCodes(row.backupCodes)) {
    skipped += 1;
    continue;
  }

  const ciphertext = await symmetricEncrypt({
    key: secret,
    data: row.backupCodes,
  });

  const roundTrip = await symmetricDecrypt({ key: secret, data: ciphertext });
  if (roundTrip !== row.backupCodes) {
    throw new Error(
      `Round-trip verification failed for twoFactor row ${row.id}; aborting without writing`,
    );
  }

  if (!dryRun) {
    await db
      .update(twoFactor)
      .set({ backupCodes: ciphertext })
      .where(eq(twoFactor.id, row.id));
  }

  encrypted += 1;
}

console.log(
  `${dryRun ? "[dry-run] would encrypt" : "Encrypted"} ${encrypted} row(s); ${skipped} already encrypted/skipped (of ${rows.length} total).`,
);
process.exit(0);
