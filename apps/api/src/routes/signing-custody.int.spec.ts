/**
 * signing-custody.int.spec.ts - roadmap 2 B4a (signing-credential custody and
 * audit). Real database, real middleware (RBAC included), real fixture PKCS#12
 * files issued by a fixture CA. Only the better-auth session is mocked.
 *
 *   REQ-B4A-3  upload validation: an expired, not-yet-valid, key-usage-less or
 *              untrusted-chain P12 is a 422 with a pt-BR reason and stores nothing;
 *              the default trust store is the bundled ICP-Brasil set.
 *   REQ-B4A-4  append-only audit: create / default replaced / delete, the unsigned
 *              issuance switch, the signing policy and the accreditation profile
 *              leave a row with the actor and before/after, no secrets, in the SAME
 *              transaction; calibra_app cannot UPDATE or DELETE it, a trigger stops
 *              the owner too, and RLS hides another laboratory's rows.
 *   REQ-B4A-5  deny tests through the real RBAC layer: a technician gets 403 on
 *              upload, set-default and delete; another laboratory can neither read
 *              nor alter the credential (route and database level).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { setTransactionOrganization } from "@calibra-facil/db/for-org";
import {
  organizationComplianceAuditLog,
  organizationSigningCertificate,
} from "@calibra-facil/db/schema";
import {
  openSigningCredential,
  sealSigningCredential,
  signingKeyringFromEnv,
} from "@calibra-facil/signing";
import {
  makeFixtureCa,
  makeFixtureSigner,
  type FixtureCa,
  type FixtureSignerOptions,
} from "@calibra-facil/signing/testing";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, type SeededOrg } from "../../test/integration/seed";
import { openAppRoleDb, sqlStateOf } from "../../test/integration/rls";
import { signingRouter } from "./signing";
import { organizationProfileRouter } from "./organization-profile";
import { accreditedScopeRouter } from "./accredited-scope";

const MASTER_KEY = Buffer.alloc(32, 7).toString("base64");
const PASSWORD = "s3nha-do-p12-B4A";
const DAY = 86_400_000;
const JSON_HEADERS = { "content-type": "application/json" } as const;

let trustedCa: FixtureCa;
let untrustedCa: FixtureCa;
let TRUSTED_ENV: Record<string, string>;

beforeAll(() => {
  trustedCa = makeFixtureCa("Fixture Trusted Root");
  untrustedCa = makeFixtureCa("Fixture Untrusted Root");
  const file = join(
    mkdtempSync(join(tmpdir(), "signing-custody-")),
    "roots.pem",
  );
  writeFileSync(file, trustedCa.pem);
  TRUSTED_ENV = {
    SIGNING_MASTER_KEY: MASTER_KEY,
    SIGNING_TRUST_STORE_FILE: file,
  };
}, 120_000);

beforeEach(async () => {
  await truncateAll();
});

function headers(org: SeededOrg) {
  return { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) };
}

function upload(
  org: SeededOrg,
  options: {
    ca?: FixtureCa;
    signer?: Omit<FixtureSignerOptions, "password">;
    setAsDefault?: boolean;
    env?: Record<string, string>;
    name?: string;
  } = {},
) {
  const signer = makeFixtureSigner(options.ca ?? trustedCa, {
    ...options.signer,
    password: PASSWORD,
  });
  return signingRouter.request(
    "/certificates",
    {
      method: "POST",
      headers: headers(org),
      body: JSON.stringify({
        name: options.name ?? "Certificado A1",
        p12Base64: signer.p12.toString("base64"),
        password: PASSWORD,
        setAsDefault: options.setAsDefault ?? false,
      }),
    },
    options.env ?? TRUSTED_ENV,
  );
}

async function certRows(orgId: string) {
  return db
    .select()
    .from(organizationSigningCertificate)
    .where(eq(organizationSigningCertificate.organizationId, orgId))
    .orderBy(asc(organizationSigningCertificate.id));
}

async function auditRows(orgId: string) {
  return db
    .select()
    .from(organizationComplianceAuditLog)
    .where(eq(organizationComplianceAuditLog.organizationId, orgId))
    .orderBy(asc(organizationComplianceAuditLog.id));
}

describe("REQ-B4A-3: the P12 is validated at upload", () => {
  it("accepts a current certificate that chains to the trust store and may sign", async () => {
    const org = await seedOrg({ orgId: "org-ok", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await upload(org);
    expect(res.status).toBe(200);
    expect(await certRows(org.orgId)).toHaveLength(1);
  });

  it.each([
    {
      label: "expired",
      signer: {
        notBefore: new Date(Date.now() - 400 * DAY),
        notAfter: new Date(Date.now() - 10 * DAY),
      },
      reason: "CERTIFICATE_EXPIRED",
      message: /^Certificado expirado em \d{2}\/\d{2}\/\d{4}$/,
    },
    {
      label: "not valid yet",
      signer: {
        notBefore: new Date(Date.now() + 30 * DAY),
        notAfter: new Date(Date.now() + 400 * DAY),
      },
      reason: "CERTIFICATE_NOT_YET_VALID",
      message: /ainda não é válido/,
    },
    {
      label: "without digitalSignature or nonRepudiation",
      signer: { keyUsage: { keyEncipherment: true } },
      reason: "INVALID_KEY_USAGE",
      message: /digitalSignature.*nonRepudiation/,
    },
  ])(
    "rejects a P12 that is $label: 422, a pt-BR reason, nothing stored, nothing audited",
    async ({ signer, reason, message }) => {
      const org = await seedOrg({ orgId: "org-bad", role: "admin" });
      loginAs({ userId: org.userId, organizationId: org.orgId });

      const res = await upload(org, { signer });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toMatch(message);
      expect(body.details).toMatchObject({ reason });
      expect(await certRows(org.orgId)).toHaveLength(0);
      expect(await auditRows(org.orgId)).toHaveLength(0);
    },
  );

  it("rejects a P12 whose chain does not build to the configured trust store (422)", async () => {
    const org = await seedOrg({ orgId: "org-chain", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await upload(org, { ca: untrustedCa });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toMatch(/cadeia de certificação/i);
    expect(body.details).toMatchObject({ reason: "INVALID_CHAIN" });
    expect(await certRows(org.orgId)).toHaveLength(0);
  });

  it("with no trust store configured the BUNDLED ICP-Brasil roots apply, and a fixture CA is not one of them (422)", async () => {
    const org = await seedOrg({ orgId: "org-default", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await upload(org, {
      env: { SIGNING_MASTER_KEY: MASTER_KEY },
    });

    expect(res.status).toBe(422);
    expect((await res.json()).details).toMatchObject({
      reason: "INVALID_CHAIN",
    });
    expect(await certRows(org.orgId)).toHaveLength(0);
  });
});

describe("REQ-B4A-4: the compliance audit log", () => {
  it("upload leaves a 'created' row with the actor and the after values, no secrets, in the same transaction as the certificate", async () => {
    const org = await seedOrg({ orgId: "org-audit", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const res = await upload(org, { setAsDefault: true });
    expect(res.status).toBe(200);

    const [cert] = await certRows(org.orgId);
    const audit = await auditRows(org.orgId);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      organizationId: org.orgId,
      unitId: org.unitId,
      action: "signing_credential.created",
      entityType: "organization_signing_certificate",
      entityId: String(cert?.id),
      performedBy: org.userId,
    });
    expect(audit[0]?.changes).toMatchObject({
      before: null,
      after: {
        serialNumber: cert?.serialNumber,
        isDefault: true,
        kekId: "k1",
        custodyFormatVersion: 2,
      },
    });

    // No secret reaches the log: neither the password, nor the ciphertext, nor
    // the P12 or the IV, as a value or as a key name.
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(PASSWORD);
    expect(serialized).not.toContain(cert?.encryptedP12 ?? "x");
    expect(serialized).not.toContain(cert?.encryptedPassword ?? "x");
    expect(serialized).not.toMatch(/enc:v\d|p12|passwordIv|encrypted/i);

    // Same transaction: both rows were written by one transaction id.
    const xids = await db.execute<{ cert: string; audit: string }>(sql`
      select (select xmin::text from organization_signing_certificate where id = ${cert?.id}) as cert,
             (select xmin::text from organization_compliance_audit_log where id = ${audit[0]?.id}) as audit`);
    const [pair] = Array.from(xids);
    expect(pair?.cert).toBeDefined();
    expect(pair?.audit).toBe(pair?.cert);
  });

  it("a new default replacing the old one is audited (upload with setAsDefault, and set-default)", async () => {
    const org = await seedOrg({ orgId: "org-replace", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    expect((await upload(org, { setAsDefault: true })).status).toBe(200);
    expect((await upload(org, { setAsDefault: true })).status).toBe(200);
    const [first, second] = await certRows(org.orgId);

    let audit = await auditRows(org.orgId);
    expect(audit.map((row) => row.action)).toEqual([
      "signing_credential.created",
      "signing_credential.created",
      "signing_credential.default_replaced",
    ]);
    expect(audit[2]?.changes).toMatchObject({
      before: { defaultCertificateId: first?.id },
      after: { defaultCertificateId: second?.id },
    });

    // Back to the first one through set-default.
    const res = await signingRouter.request(
      `/certificates/${first?.id}/set-default`,
      { method: "POST", headers: headers(org) },
    );
    expect(res.status).toBe(200);
    audit = await auditRows(org.orgId);
    expect(audit.at(-1)).toMatchObject({
      action: "signing_credential.default_replaced",
      entityId: String(first?.id),
      performedBy: org.userId,
    });
    expect(audit.at(-1)?.changes).toMatchObject({
      before: { defaultCertificateId: second?.id },
      after: { defaultCertificateId: first?.id },
    });
  });

  it("delete (revoke) leaves a 'deleted' row with the reason and the state before and after", async () => {
    const org = await seedOrg({ orgId: "org-delete", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    await upload(org, { setAsDefault: true });
    const [cert] = await certRows(org.orgId);

    const res = await signingRouter.request(`/certificates/${cert?.id}`, {
      method: "DELETE",
      headers: headers(org),
      body: JSON.stringify({ reason: "Certificado comprometido" }),
    });
    expect(res.status).toBe(200);

    const deleted = (await auditRows(org.orgId)).at(-1);
    expect(deleted).toMatchObject({
      action: "signing_credential.deleted",
      entityId: String(cert?.id),
      performedBy: org.userId,
    });
    expect(deleted?.changes).toMatchObject({
      before: {
        serialNumber: cert?.serialNumber,
        isActive: true,
        isDefault: true,
      },
      after: {
        isActive: false,
        isDefault: false,
        reason: "Certificado comprometido",
      },
    });
  });

  it("a refused or failed request audits nothing (duplicate serial, unknown certificate)", async () => {
    const org = await seedOrg({ orgId: "org-none", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const signer = makeFixtureSigner(trustedCa, { password: PASSWORD });
    const body = JSON.stringify({
      name: "Duplicado",
      p12Base64: signer.p12.toString("base64"),
      password: PASSWORD,
    });
    const first = await signingRouter.request(
      "/certificates",
      { method: "POST", headers: headers(org), body },
      TRUSTED_ENV,
    );
    expect(first.status).toBe(200);
    const again = await signingRouter.request(
      "/certificates",
      { method: "POST", headers: headers(org), body },
      TRUSTED_ENV,
    );
    expect(again.status).toBe(400);
    const missing = await signingRouter.request("/certificates/99999", {
      method: "DELETE",
      headers: headers(org),
      body: JSON.stringify({ reason: "x" }),
    });
    expect(missing.status).toBe(404);
    expect(await auditRows(org.orgId)).toHaveLength(1);
  });

  it("the unsigned-issuance switch and the signing policy are audited with before/after", async () => {
    const org = await seedOrg({ orgId: "org-policy", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const on = await signingRouter.request("/unsigned-issuance", {
      method: "PATCH",
      headers: headers(org),
      body: JSON.stringify({
        enabled: true,
        reason: "Sem certificado A1 enquanto o novo não chega",
      }),
    });
    expect(on.status).toBe(200);
    const off = await signingRouter.request("/unsigned-issuance", {
      method: "PATCH",
      headers: headers(org),
      body: JSON.stringify({ enabled: false }),
    });
    expect(off.status).toBe(200);
    const policy = await signingRouter.request("/policy", {
      method: "PATCH",
      headers: headers(org),
      body: JSON.stringify({ requireSignature: true }),
    });
    expect(policy.status).toBe(200);

    const audit = await auditRows(org.orgId);
    expect(audit.map((row) => row.action)).toEqual([
      "signing_policy.unsigned_issuance_changed",
      "signing_policy.unsigned_issuance_changed",
      "signing_policy.require_signature_changed",
    ]);
    expect(audit[0]).toMatchObject({
      performedBy: org.userId,
      unitId: org.unitId,
      entityType: "organization_unit",
    });
    expect(audit[0]?.changes).toMatchObject({
      before: { enabled: false, reason: null },
      after: {
        enabled: true,
        reason: "Sem certificado A1 enquanto o novo não chega",
      },
    });
    expect(audit[1]?.changes).toMatchObject({
      before: { enabled: true },
      after: { enabled: false, reason: null },
    });
    expect(audit[2]?.changes).toMatchObject({
      before: { requireSignature: false },
      after: { requireSignature: true },
    });
  });

  it("accreditation profile changes (number, active toggle, vigência = the seal settings) and the scope guard mode are audited with before/after", async () => {
    const org = await seedOrg({ orgId: "org-accred", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const first = await organizationProfileRouter.request("/profile", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        accreditationNumber: "0123",
        accreditationBody: "Cgcre",
        accreditationActive: true,
      }),
    });
    expect(first.status).toBe(200);
    const second = await organizationProfileRouter.request("/profile", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ accreditationActive: false, city: "Campinas" }),
    });
    expect(second.status).toBe(200);
    // A change with no accreditation field is not an accreditation change.
    const third = await organizationProfileRouter.request("/profile", {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ city: "Santos" }),
    });
    expect(third.status).toBe(200);
    const scope = await accreditedScopeRouter.request("/enforcement", {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mode: "warn" }),
    });
    expect(scope.status).toBe(200);

    const audit = await auditRows(org.orgId);
    expect(audit.map((row) => row.action)).toEqual([
      "accreditation.profile_changed",
      "accreditation.profile_changed",
      "accreditation.scope_enforcement_changed",
    ]);
    expect(audit[0]).toMatchObject({
      entityType: "organization",
      entityId: org.orgId,
      performedBy: org.userId,
    });
    expect(audit[0]?.changes).toMatchObject({
      before: {
        accreditationNumber: null,
        accreditationBody: null,
        accreditationActive: false,
      },
      after: {
        accreditationNumber: "0123",
        accreditationBody: "Cgcre",
        accreditationActive: true,
      },
    });
    expect(audit[1]?.changes).toMatchObject({
      before: { accreditationActive: true },
      after: { accreditationActive: false },
    });
    expect(audit[2]?.changes).toMatchObject({
      after: { scopeEnforcementMode: "warn" },
    });
  });

  it("is append-only: calibra_app can read and insert but not UPDATE or DELETE; the trigger stops the owner as well", async () => {
    const org = await seedOrg({ orgId: "org-append", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    await upload(org);
    const [row] = await auditRows(org.orgId);
    if (!row) throw new Error("no audit row");

    const app = openAppRoleDb();
    // The application role reads its own rows and appends to the log...
    await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, org.orgId);
      const own = await tx
        .select()
        .from(organizationComplianceAuditLog)
        .where(eq(organizationComplianceAuditLog.id, row.id));
      expect(own).toHaveLength(1);
      await tx.insert(organizationComplianceAuditLog).values({
        organizationId: org.orgId,
        action: "signing_credential.created",
        entityType: "organization_signing_certificate",
        changes: { note: "appended by calibra_app" },
      });
    });

    // ...but REVOKEd UPDATE / DELETE: 42501 insufficient_privilege.
    const update = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, org.orgId);
      await tx
        .update(organizationComplianceAuditLog)
        .set({ action: "tampered" })
        .where(eq(organizationComplianceAuditLog.id, row.id));
    });
    expect(await sqlStateOf(update)).toBe("42501");
    const remove = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, org.orgId);
      await tx
        .delete(organizationComplianceAuditLog)
        .where(eq(organizationComplianceAuditLog.id, row.id));
    });
    expect(await sqlStateOf(remove)).toBe("42501");

    // The owner has the privilege; the append-only trigger raises (P0001).
    expect(
      await sqlStateOf(
        db
          .update(organizationComplianceAuditLog)
          .set({ action: "tampered" })
          .where(eq(organizationComplianceAuditLog.id, row.id)),
      ),
    ).toBe("P0001");
    expect(
      await sqlStateOf(
        db
          .delete(organizationComplianceAuditLog)
          .where(eq(organizationComplianceAuditLog.id, row.id)),
      ),
    ).toBe("P0001");
    const [still] = await auditRows(org.orgId);
    expect(still?.action).toBe("signing_credential.created");
  });

  it("is tenant-isolated: with laboratory B set, calibra_app sees none of A's rows and cannot write A's", async () => {
    const orgA = await seedOrg({ orgId: "org-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-b", role: "admin" });
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    await upload(orgA);

    const app = openAppRoleDb();
    await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, orgB.orgId);
      const seen = await tx
        .select()
        .from(organizationComplianceAuditLog)
        .where(eq(organizationComplianceAuditLog.organizationId, orgA.orgId));
      expect(seen).toHaveLength(0);
    });
    const forge = app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, orgB.orgId);
      await tx.insert(organizationComplianceAuditLog).values({
        organizationId: orgA.orgId,
        action: "signing_credential.deleted",
        entityType: "organization_signing_certificate",
      });
    });
    expect(await sqlStateOf(forge)).toBe("42501");
  });
});

describe("REQ-B4A-5: deny tests through the real RBAC layer", () => {
  it("a technician gets 403 on upload, set-default and delete, and nothing changes or is audited", async () => {
    const admin = await seedOrg({ orgId: "org-deny", role: "admin" });
    loginAs({ userId: admin.userId, organizationId: admin.orgId });
    expect((await upload(admin, { setAsDefault: true })).status).toBe(200);
    const [cert] = await certRows(admin.orgId);
    const auditBefore = await auditRows(admin.orgId);

    // A technician of another laboratory (same shape: org-level technician).
    const tech = await seedOrg({ orgId: "org-tech", role: "technician" });
    loginAs({ userId: tech.userId, organizationId: tech.orgId });

    const post = await upload(tech);
    expect(post.status).toBe(403);
    expect(await certRows(tech.orgId)).toHaveLength(0);

    const setDefault = await signingRouter.request(
      `/certificates/${cert?.id}/set-default`,
      { method: "POST", headers: headers(tech) },
    );
    expect(setDefault.status).toBe(403);

    const remove = await signingRouter.request(`/certificates/${cert?.id}`, {
      method: "DELETE",
      headers: headers(tech),
      body: JSON.stringify({ reason: "tentativa" }),
    });
    expect(remove.status).toBe(403);

    // The admin's credential and trail are untouched.
    const [after] = await certRows(admin.orgId);
    expect(after).toMatchObject({ isActive: true, isDefault: true });
    expect(await auditRows(admin.orgId)).toHaveLength(auditBefore.length);
    expect(await auditRows(tech.orgId)).toHaveLength(0);
  });

  it("a technician of the SAME laboratory is refused too (upload and delete)", async () => {
    const lab = await seedOrg({ orgId: "org-same", role: "technician" });
    loginAs({ userId: lab.userId, organizationId: lab.orgId });
    expect((await upload(lab)).status).toBe(403);
    const missing = await signingRouter.request("/certificates/1", {
      method: "DELETE",
      headers: headers(lab),
      body: JSON.stringify({ reason: "x" }),
    });
    expect(missing.status).toBe(403);
    expect(await certRows(lab.orgId)).toHaveLength(0);
  });

  it("a technician of the SAME laboratory cannot set the default either: 403, the default and the trail are unchanged", async () => {
    const lab = await seedOrg({ orgId: "org-same-sd", role: "technician" });
    // The laboratory's credentials, seeded as the owner path would have them.
    const sealed = sealSigningCredential(
      { p12: Buffer.from("p12"), password: PASSWORD },
      {
        organizationId: lab.orgId,
        unitId: lab.unitId,
        serialNumber: "SD-1",
      },
      signingKeyringFromEnv(TRUSTED_ENV) ??
        (() => {
          throw new Error("no keyring");
        })(),
    );
    const [current] = await db
      .insert(organizationSigningCertificate)
      .values({
        organizationId: lab.orgId,
        unitId: lab.unitId,
        name: "Atual",
        serialNumber: "SD-1",
        issuerCn: "AC",
        subjectCn: "LAB",
        validFrom: new Date(Date.now() - DAY),
        validUntil: new Date(Date.now() + 365 * DAY),
        encryptedP12: sealed.encryptedP12,
        encryptedPassword: sealed.encryptedPassword,
        passwordIv: sealed.passwordIv,
        kekId: sealed.kekId,
        custodyFormatVersion: sealed.formatVersion,
        isActive: true,
        isDefault: true,
        createdBy: lab.userId,
      })
      .returning();
    const [other] = await db
      .insert(organizationSigningCertificate)
      .values({
        organizationId: lab.orgId,
        unitId: lab.unitId,
        name: "Outro",
        serialNumber: "SD-2",
        issuerCn: "AC",
        subjectCn: "LAB",
        validFrom: new Date(Date.now() - DAY),
        validUntil: new Date(Date.now() + 365 * DAY),
        encryptedP12: sealed.encryptedP12,
        encryptedPassword: sealed.encryptedPassword,
        passwordIv: sealed.passwordIv,
        kekId: sealed.kekId,
        custodyFormatVersion: sealed.formatVersion,
        isActive: true,
        isDefault: false,
        createdBy: lab.userId,
      })
      .returning();
    loginAs({ userId: lab.userId, organizationId: lab.orgId });

    const res = await signingRouter.request(
      `/certificates/${other?.id}/set-default`,
      { method: "POST", headers: headers(lab) },
    );

    expect(res.status).toBe(403);
    const rows = await certRows(lab.orgId);
    expect(rows.find((row) => row.id === current?.id)?.isDefault).toBe(true);
    expect(rows.find((row) => row.id === other?.id)?.isDefault).toBe(false);
    expect(await auditRows(lab.orgId)).toHaveLength(0);
  });

  it("another laboratory can neither read nor alter the credential: 404 on the routes, invisible and untouched through the application role", async () => {
    const orgA = await seedOrg({ orgId: "org-owner-a", role: "admin" });
    const orgB = await seedOrg({ orgId: "org-owner-b", role: "admin" });
    loginAs({ userId: orgA.userId, organizationId: orgA.orgId });
    expect((await upload(orgA, { setAsDefault: true })).status).toBe(200);
    const [cert] = await certRows(orgA.orgId);
    if (!cert) throw new Error("no certificate");

    loginAs({ userId: orgB.userId, organizationId: orgB.orgId });
    const read = await signingRouter.request(`/certificates/${cert.id}`, {
      headers: headers(orgB),
    });
    expect(read.status).toBe(404);
    const list = await signingRouter.request("/certificates", {
      headers: headers(orgB),
    });
    expect((await list.json()).certificates).toHaveLength(0);
    const setDefault = await signingRouter.request(
      `/certificates/${cert.id}/set-default`,
      { method: "POST", headers: headers(orgB) },
    );
    expect(setDefault.status).toBe(404);
    const remove = await signingRouter.request(`/certificates/${cert.id}`, {
      method: "DELETE",
      headers: headers(orgB),
      body: JSON.stringify({ reason: "intruso" }),
    });
    expect(remove.status).toBe(404);

    // Database level, as calibra_app bound to B: A's credential is invisible and
    // an UPDATE of it matches no row.
    const app = openAppRoleDb();
    await app.db.transaction(async (tx) => {
      await setTransactionOrganization(tx, orgB.orgId);
      expect(
        await tx
          .select({ id: organizationSigningCertificate.id })
          .from(organizationSigningCertificate)
          .where(eq(organizationSigningCertificate.id, cert.id)),
      ).toHaveLength(0);
      const touched = await tx
        .update(organizationSigningCertificate)
        .set({ isActive: false })
        .where(eq(organizationSigningCertificate.id, cert.id))
        .returning();
      expect(touched).toHaveLength(0);
    });

    const [unchanged] = await certRows(orgA.orgId);
    expect(unchanged).toMatchObject({ isActive: true, isDefault: true });

    // And even a leaked copy of A's ciphertext does not open under B's binding.
    const keyring = signingKeyringFromEnv(TRUSTED_ENV);
    if (!keyring) throw new Error("no keyring");
    const stored = {
      encryptedP12: cert.encryptedP12,
      encryptedPassword: cert.encryptedPassword,
      passwordIv: cert.passwordIv,
      kekId: cert.kekId,
      formatVersion: cert.custodyFormatVersion,
    };
    expect(() =>
      openSigningCredential(
        stored,
        {
          organizationId: orgB.orgId,
          unitId: orgB.unitId,
          serialNumber: cert.serialNumber,
        },
        keyring,
      ),
    ).toThrow();
    expect(
      openSigningCredential(
        stored,
        {
          organizationId: orgA.orgId,
          unitId: orgA.unitId,
          serialNumber: cert.serialNumber,
        },
        keyring,
      ).password,
    ).toBe(PASSWORD);
    // The same lookup, spelled with and(...), keeps the audit of A out of B's view.
    expect(
      await db
        .select()
        .from(organizationComplianceAuditLog)
        .where(
          and(
            eq(organizationComplianceAuditLog.organizationId, orgB.orgId),
            eq(organizationComplianceAuditLog.entityId, String(cert.id)),
          ),
        ),
    ).toHaveLength(0);
  });
});
