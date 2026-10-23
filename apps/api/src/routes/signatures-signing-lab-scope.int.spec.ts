/**
 * signatures-signing-lab-scope.int.spec.ts - P2-18e [HIGH RISK].
 *
 * Success paths (each with a cross-laboratory negative) of the visual-signature
 * and signing-certificate handlers that signatures.int.spec.ts and
 * signing.int.spec.ts do not reach. Run as the owner here and, through
 * `pnpm --filter @calibra-facil/api rls:shadow-report`, as `calibra_app` under
 * the `tenant_isolation` policies.
 *
 *   REQ-18E-SIG-1   Upload, replace (upsert), read and delete of the member's own visual
 *                   signature touch only that member's row; lab B's signature survives
 *                   and a second delete is a 404.
 *   REQ-18E-SIG-2   GET /member/:memberId returns the signature of a member of the caller's
 *                   lab and is a 404 for lab B's member.
 *   REQ-18E-CERT-1  POST /certificates/:id/set-default moves the unit default (and only that
 *                   unit's); lab B's default certificate keeps its flag.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  memberVisualSignature,
  organizationSigningCertificate,
} from "@calibra-facil/db/schema";
import { signaturesRouter } from "./signatures";
import { signingRouter } from "./signing";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";

vi.mock("../lib/storage", () => ({
  createR2Client: () => ({}),
  uploadToR2: () => Promise.resolve(),
  deleteFromR2: () => Promise.resolve(),
  generatePresignedUrl: () => Promise.resolve("https://r2.test/signed"),
  resolveBucketName: () => "media-test",
  resolveReadBucketName: () => Promise.resolve("media-test"),
}));

/** A 25-byte stub whose PNG magic and IHDR declare the given dimensions. */
function pngBuffer(width: number, height: number): Buffer {
  const buffer = Buffer.alloc(25);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

function upload(width: number, height: number) {
  const form = new FormData();
  form.append(
    "signature",
    new File([pngBuffer(width, height)], "sig.png", { type: "image/png" }),
  );
  return signaturesRouter.request("/my-signature", {
    method: "POST",
    body: form,
  });
}

async function signatureRows(organizationId: string) {
  return db
    .select()
    .from(memberVisualSignature)
    .where(eq(memberVisualSignature.organizationId, organizationId));
}

async function twoLabs() {
  const a = await seedOrg({ orgId: "org-a", role: "admin" });
  const b = await seedOrg({ orgId: "org-b", role: "admin" });
  return { a, b };
}

beforeEach(async () => {
  await truncateAll();
  logout();
});

describe("signatures router: own visual signature (P2-18e)", () => {
  it("REQ-18E-SIG-1: upload, replace, read and delete touch only the caller's own row; lab B's signature survives", async () => {
    const { a, b } = await twoLabs();

    // Lab B uploads first, so there is a foreign row to survive.
    loginAs({ userId: b.userId, organizationId: b.orgId });
    expect((await upload(300, 120)).status).toBe(200);
    const [foreign] = await signatureRows(b.orgId);
    expect(foreign?.width).toBe(300);

    loginAs({ userId: a.userId, organizationId: a.orgId });
    const none = await signaturesRouter.request("/my-signature");
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ hasSignature: false });

    expect((await upload(200, 100)).status).toBe(200);
    const [first] = await signatureRows(a.orgId);
    expect(first).toMatchObject({
      memberId: a.memberId,
      width: 200,
      height: 100,
    });

    // The second upload replaces the same row.
    expect((await upload(400, 150)).status).toBe(200);
    const afterReplace = await signatureRows(a.orgId);
    expect(afterReplace).toHaveLength(1);
    expect(afterReplace[0]).toMatchObject({
      id: first?.id,
      width: 400,
      height: 150,
    });

    const read = await signaturesRouter.request("/my-signature");
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      hasSignature: true,
      url: "https://r2.test/signed",
      dimensions: { width: 400, height: 150 },
    });

    const removed = await signaturesRouter.request("/my-signature", {
      method: "DELETE",
    });
    expect(removed.status).toBe(200);
    expect(await signatureRows(a.orgId)).toEqual([]);
    expect(
      (await signaturesRouter.request("/my-signature", { method: "DELETE" }))
        .status,
    ).toBe(404);

    const [survivor] = await signatureRows(b.orgId);
    expect(survivor?.id).toBe(foreign?.id);
    expect(survivor?.width).toBe(300);
  });

  it("REQ-18E-SIG-2: GET /member/:memberId reads a member of the caller's lab; lab B's member is a 404", async () => {
    const { a, b } = await twoLabs();
    loginAs({ userId: a.userId, organizationId: a.orgId });
    expect((await upload(220, 110)).status).toBe(200);
    loginAs({ userId: b.userId, organizationId: b.orgId });
    expect((await upload(330, 130)).status).toBe(200);

    loginAs({ userId: a.userId, organizationId: a.orgId });
    const own = await signaturesRouter.request(`/member/${a.memberId}`);
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({
      hasSignature: true,
      dimensions: { width: 220, height: 110 },
    });
    const foreign = await signaturesRouter.request(`/member/${b.memberId}`);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual({ error: "Membro não encontrado" });
  });
});

async function seedCert(params: {
  organizationId: string;
  unitId: number;
  createdBy: string;
  serialNumber: string;
  isDefault: boolean;
}): Promise<number> {
  const [row] = await db
    .insert(organizationSigningCertificate)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      name: `Certificado ${params.serialNumber}`,
      serialNumber: params.serialNumber,
      issuerCn: "AC Test",
      subjectCn: "LAB",
      subjectCpfCnpj: "00000000000",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2027-01-01T00:00:00.000Z"),
      encryptedP12: "SENTINEL_P12",
      encryptedPassword: "SENTINEL_PW",
      passwordIv: "SENTINEL_IV",
      isActive: true,
      isDefault: params.isDefault,
      createdBy: params.createdBy,
    })
    .returning({ id: organizationSigningCertificate.id });
  if (!row) throw new Error("seedCert: insert failed");
  return row.id;
}

async function isDefault(id: number) {
  const [row] = await db
    .select({ isDefault: organizationSigningCertificate.isDefault })
    .from(organizationSigningCertificate)
    .where(and(eq(organizationSigningCertificate.id, id)));
  return row?.isDefault;
}

describe("signing router: default certificate (P2-18e)", () => {
  it("REQ-18E-CERT-1: set-default moves the unit default and leaves lab B's default alone", async () => {
    const { a, b } = await twoLabs();
    const current = await seedCert({
      organizationId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
      serialNumber: "SN-A-1",
      isDefault: true,
    });
    const next = await seedCert({
      organizationId: a.orgId,
      unitId: a.unitId,
      createdBy: a.userId,
      serialNumber: "SN-A-2",
      isDefault: false,
    });
    const foreignDefault = await seedCert({
      organizationId: b.orgId,
      unitId: b.unitId,
      createdBy: b.userId,
      serialNumber: "SN-B-1",
      isDefault: true,
    });
    loginAs({ userId: a.userId, organizationId: a.orgId });
    const headers = { "x-active-unit-id": String(a.unitId) };

    const res = await signingRouter.request(
      `/certificates/${next}/set-default`,
      {
        method: "POST",
        headers,
      },
    );
    expect(res.status).toBe(200);
    expect(await isDefault(next)).toBe(true);
    expect(await isDefault(current)).toBe(false);
    expect(await isDefault(foreignDefault)).toBe(true);

    // Lab B's certificate id from lab A's session: a 404, nothing moves.
    const refused = await signingRouter.request(
      `/certificates/${foreignDefault}/set-default`,
      { method: "POST", headers },
    );
    expect(refused.status).toBe(404);
    expect(await isDefault(next)).toBe(true);
    expect(await isDefault(foreignDefault)).toBe(true);
  });
});
