/**
 * REQ-B4A-2: `reencrypt-signing-credentials` rewraps every signing credential
 * under the current KEK and migrates the legacy rows; it is idempotent and has a
 * dry run. Real database; the sweep runs on the owner path (systemDb).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { asc, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  organizationComplianceAuditLog,
  organizationSigningCertificate,
} from "@calibra-facil/db/schema";
import {
  CREDENTIAL_FORMAT_ENVELOPE,
  CREDENTIAL_FORMAT_LEGACY,
  createSigningKeyring,
  encryptBinary,
  encryptPassword,
  generateMasterKey,
  openSigningCredential,
  sealSigningCredential,
  type SigningKeyring,
} from "@calibra-facil/signing";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, type SeededOrg } from "../../test/integration/seed";
import { reencryptSigningCredentials } from "./reencrypt-signing-credentials";

const OLD_KEY = generateMasterKey();
const NEW_KEY = generateMasterKey();
const P12 = Buffer.from("fixture-p12-bytes-\u0000\u0001\u0002ÿ", "binary");
const PASSWORD = "senha-do-certificado";

// Before the rotation: only the old key, id k1.
const oldRing = createSigningKeyring({ currentKey: OLD_KEY, currentId: "k1" });
// After: the new key is current (k2) and the old one is still configured.
const rotatedRing = createSigningKeyring({
  currentKey: NEW_KEY,
  currentId: "k2",
  previous: `k1:${OLD_KEY}`,
});

type Kind = "legacy" | "under-k1" | "under-k2";

async function seedCredential(
  org: SeededOrg,
  serialNumber: string,
  kind: Kind,
  bindTo: { organizationId: string; unitId: number } = {
    organizationId: org.orgId,
    unitId: org.unitId,
  },
) {
  const binding = { ...bindTo, serialNumber };
  let fields;
  if (kind === "legacy") {
    const { encryptedPassword, iv } = encryptPassword(PASSWORD, OLD_KEY);
    fields = {
      encryptedP12: encryptBinary(P12, OLD_KEY),
      encryptedPassword,
      passwordIv: iv,
      kekId: null,
      custodyFormatVersion: CREDENTIAL_FORMAT_LEGACY,
    };
  } else {
    const sealed = sealSigningCredential(
      { p12: P12, password: PASSWORD },
      binding,
      kind === "under-k1" ? oldRing : rotatedRing,
    );
    fields = {
      encryptedP12: sealed.encryptedP12,
      encryptedPassword: sealed.encryptedPassword,
      passwordIv: sealed.passwordIv,
      kekId: sealed.kekId,
      custodyFormatVersion: sealed.formatVersion,
    };
  }
  const [row] = await db
    .insert(organizationSigningCertificate)
    .values({
      organizationId: org.orgId,
      unitId: org.unitId,
      name: `Cert ${serialNumber}`,
      serialNumber,
      issuerCn: "AC Teste",
      subjectCn: "LAB TESTE",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2030-01-01T00:00:00.000Z"),
      isActive: true,
      isDefault: false,
      createdBy: org.userId,
      ...fields,
    })
    .returning();
  if (!row) throw new Error("seed failed");
  return row;
}

async function rows() {
  return db
    .select()
    .from(organizationSigningCertificate)
    .orderBy(asc(organizationSigningCertificate.id));
}

function opens(
  row: typeof organizationSigningCertificate.$inferSelect,
  ring: SigningKeyring,
) {
  return openSigningCredential(
    {
      encryptedP12: row.encryptedP12,
      encryptedPassword: row.encryptedPassword,
      passwordIv: row.passwordIv,
      kekId: row.kekId,
      formatVersion: row.custodyFormatVersion,
    },
    {
      organizationId: row.organizationId,
      unitId: row.unitId,
      serialNumber: row.serialNumber,
    },
    ring,
  );
}

describe("reencrypt-signing-credentials", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-B4A-2: --dry-run opens every credential, reports what it would change, and writes nothing", async () => {
    const org = await seedOrg({ orgId: "org-dry", role: "admin" });
    await seedCredential(org, "S-LEGACY", "legacy");
    await seedCredential(org, "S-K1", "under-k1");
    await seedCredential(org, "S-K2", "under-k2");
    const before = await rows();

    const summary = await reencryptSigningCredentials({
      keyring: rotatedRing,
      dryRun: true,
    });

    expect(summary).toMatchObject({
      dryRun: true,
      currentKekId: "k2",
      total: 3,
      rewrapped: 2,
      unchanged: 1,
      failed: 0,
    });
    expect(
      summary.rows.map((row) => [row.serialNumber, row.outcome, row.from]),
    ).toEqual([
      ["S-LEGACY", "rewrapped", "legacy"],
      ["S-K1", "rewrapped", "k1"],
      ["S-K2", "unchanged", "k2"],
    ]);
    // Nothing written: rows are byte-identical, no audit rows.
    expect(await rows()).toEqual(before);
    expect(await db.select().from(organizationComplianceAuditLog)).toHaveLength(
      0,
    );
  });

  it("REQ-B4A-2: moves legacy rows and previous-KEK rows under the current KEK; they open with the new key alone, and carry kek_id and the format version", async () => {
    const org = await seedOrg({ orgId: "org-run", role: "admin" });
    const legacy = await seedCredential(org, "S-LEGACY", "legacy");
    const underK1 = await seedCredential(org, "S-K1", "under-k1");
    const underK2 = await seedCredential(org, "S-K2", "under-k2");

    // Before the sweep every row still decrypts (legacy included) with the
    // rotated ring: no lockout while the previous key is configured.
    for (const row of [legacy, underK1, underK2]) {
      const opened = opens(row, rotatedRing);
      expect(opened.password).toBe(PASSWORD);
      expect(opened.p12.equals(P12)).toBe(true);
    }

    const summary = await reencryptSigningCredentials({ keyring: rotatedRing });
    expect(summary).toMatchObject({
      dryRun: false,
      total: 3,
      rewrapped: 2,
      unchanged: 1,
      failed: 0,
    });

    const after = await rows();
    const onlyNew = createSigningKeyring({
      currentKey: NEW_KEY,
      currentId: "k2",
    });
    for (const row of after) {
      expect(row.kekId, row.serialNumber).toBe("k2");
      expect(row.custodyFormatVersion).toBe(CREDENTIAL_FORMAT_ENVELOPE);
      expect(row.encryptedP12.startsWith("enc:v2:k2:")).toBe(true);
      // The previous key can be dropped: every row opens with the new one alone.
      const opened = opens(row, onlyNew);
      expect(opened.password).toBe(PASSWORD);
      expect(opened.p12.equals(P12)).toBe(true);
    }
    // The row that was already under k2 was not rewritten.
    expect(after.find((row) => row.serialNumber === "S-K2")).toEqual(underK2);
    // The others got fresh ciphertext (new data keys).
    expect(
      after.find((row) => row.serialNumber === "S-K1")?.encryptedP12,
    ).not.toBe(underK1.encryptedP12);

    // Audit: one platform-actor row per re-encrypted credential, no secrets.
    const audit = await db
      .select()
      .from(organizationComplianceAuditLog)
      .orderBy(asc(organizationComplianceAuditLog.id));
    expect(audit).toHaveLength(2);
    expect(audit.map((row) => row.action)).toEqual([
      "signing_credential.rewrapped",
      "signing_credential.rewrapped",
    ]);
    expect(audit.every((row) => row.performedBy === null)).toBe(true);
    expect(audit[0]?.changes).toMatchObject({
      before: { kekId: null, custodyFormatVersion: CREDENTIAL_FORMAT_LEGACY },
      after: { kekId: "k2", custodyFormatVersion: CREDENTIAL_FORMAT_ENVELOPE },
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(JSON.stringify(audit)).not.toMatch(/enc:v\d/);
  });

  it("REQ-B4A-2: is idempotent: a second run changes nothing and audits nothing", async () => {
    const org = await seedOrg({ orgId: "org-idem", role: "admin" });
    await seedCredential(org, "S-LEGACY", "legacy");
    await seedCredential(org, "S-K1", "under-k1");
    await reencryptSigningCredentials({ keyring: rotatedRing });
    const afterFirst = await rows();
    const auditAfterFirst = await db
      .select()
      .from(organizationComplianceAuditLog);

    const second = await reencryptSigningCredentials({ keyring: rotatedRing });

    expect(second).toMatchObject({ rewrapped: 0, unchanged: 2, failed: 0 });
    expect(await rows()).toEqual(afterFirst);
    expect(await db.select().from(organizationComplianceAuditLog)).toHaveLength(
      auditAfterFirst.length,
    );
  });

  it("REQ-B4A-2: a credential that cannot be opened is reported failed and left untouched; the rest are still migrated", async () => {
    const org = await seedOrg({ orgId: "org-fail", role: "admin" });
    const other = await seedOrg({ orgId: "org-fail-other", role: "admin" });
    await seedCredential(org, "S-GOOD", "legacy");
    // Sealed for ANOTHER organization's binding, stored under this one: the AAD
    // does not match, so it must never be "repaired" silently.
    const broken = await seedCredential(org, "S-BROKEN", "under-k1", {
      organizationId: other.orgId,
      unitId: other.unitId,
    });

    const summary = await reencryptSigningCredentials({ keyring: rotatedRing });

    expect(summary).toMatchObject({ total: 2, rewrapped: 1, failed: 1 });
    const failed = summary.rows.find((row) => row.outcome === "failed");
    expect(failed?.serialNumber).toBe("S-BROKEN");
    expect(failed?.error).toBeTruthy();
    expect(failed?.error).not.toContain(PASSWORD);

    const after = await rows();
    expect(after.find((row) => row.serialNumber === "S-BROKEN")).toEqual(
      broken,
    );
    expect(after.find((row) => row.serialNumber === "S-GOOD")?.kekId).toBe(
      "k2",
    );
  });

  it("REQ-B4A-2: a KEK missing from the ring makes the row fail, not silently skip", async () => {
    const org = await seedOrg({ orgId: "org-missing", role: "admin" });
    await seedCredential(org, "S-K1", "under-k1");
    const onlyNew = createSigningKeyring({
      currentKey: NEW_KEY,
      currentId: "k2",
    });

    const summary = await reencryptSigningCredentials({ keyring: onlyNew });

    expect(summary.failed).toBe(1);
    expect(summary.rows[0]?.error).toMatch(/k1/);
    expect(
      (
        await db
          .select()
          .from(organizationSigningCertificate)
          .where(eq(organizationSigningCertificate.serialNumber, "S-K1"))
      )[0]?.kekId,
    ).toBe("k1");
  });
});
