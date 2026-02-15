#!/usr/bin/env node

import { createCipheriv, randomBytes } from "node:crypto";
import postgres from "postgres";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const ENCRYPTED_BLOB_PREFIX = "enc:v1:";

function getValidatedKey(masterKey) {
  const key = Buffer.from(masterKey, "base64");
  if (key.length !== 32) {
    throw new Error("SIGNING_MASTER_KEY must be 32 bytes (base64)");
  }
  return key;
}

function encryptBinary(data, masterKey) {
  const key = getValidatedKey(masterKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${ENCRYPTED_BLOB_PREFIX}${Buffer.concat([iv, encrypted, authTag]).toString("base64")}`;
}

function decodeLegacyP12(base64Value) {
  const trimmed = base64Value.trim();
  if (!trimmed) {
    throw new Error("empty encrypted_p12 value");
  }

  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length === 0) {
    throw new Error("invalid base64 encrypted_p12 value");
  }

  return decoded;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  const masterKey = process.env.SIGNING_MASTER_KEY;
  const dryRun = process.argv.includes("--dry-run");

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (!masterKey) {
    throw new Error("SIGNING_MASTER_KEY is required");
  }

  const sql = postgres(databaseUrl, { max: 1 });

  try {
    const rows = await sql`
      SELECT id, encrypted_p12
      FROM organization_signing_certificate
      ORDER BY id ASC
    `;

    let alreadyEncrypted = 0;
    let migrated = 0;
    let failed = 0;

    for (const row of rows) {
      const id = row.id;
      const encryptedP12 = String(row.encrypted_p12 ?? "");

      if (encryptedP12.startsWith(ENCRYPTED_BLOB_PREFIX)) {
        alreadyEncrypted += 1;
        continue;
      }

      try {
        const legacyBytes = decodeLegacyP12(encryptedP12);
        const reEncrypted = encryptBinary(legacyBytes, masterKey);

        if (!dryRun) {
          await sql`
            UPDATE organization_signing_certificate
            SET encrypted_p12 = ${reEncrypted}
            WHERE id = ${id}
          `;
        }

        migrated += 1;
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[p12-migration] Failed row id=${id}: ${message}`);
      }
    }

    console.log("[p12-migration] Completed");
    console.log(`[p12-migration] Already encrypted: ${alreadyEncrypted}`);
    console.log(`[p12-migration] Migrated: ${migrated}`);
    console.log(`[p12-migration] Failed: ${failed}`);
    console.log(`[p12-migration] Mode: ${dryRun ? "dry-run" : "write"}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(
    `[p12-migration] Fatal: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
