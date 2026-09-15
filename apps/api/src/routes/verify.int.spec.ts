import { beforeEach, describe, expect, it } from "vitest";
import { verifyRouter } from "./verify";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  calibrationJob,
  customer,
  organization,
  organizationUnit,
  service,
  user,
  type JobStatus,
} from "@calibra-facil/db/schema";
import { sql } from "drizzle-orm";
import { truncateAll } from "../../test/integration/db";

// ---------------------------------------------------------------------------
// Real-DB integration test for the PUBLIC certificate-verification router.
//
// This surface is UNAUTHENTICATED by design (verify.calibrafacil.com / epic
// #431): an auditor or client resolves a certificate by its unguessable
// `verification_token` UUID. There is therefore NO tenant boundary to prove
// here — the correctness property is "right token → that certificate's own
// public data, and nothing else; unknown/invalid token → not-found with no
// leak". The cut-line is correctness + no-leak, not RBAC.
//
// The contract (from src/routes/verify.ts):
//   - lookup key:  eq(calibrationJob.verificationToken, token)
//                  AND status IN ("APPROVED","SUPERSEDED")    (only releasable)
//   - GET /:token            → 200 { valid:true, jobId, status, lab, customer,
//                              asset, service, accreditation, digitalSignature,
//                              amendment fields, ... }  | 404 { valid:false }
//   - GET /:token/signature  → fast path serves the stored signature_verdict
//                              (migration 0052) verbatim under `verdict`
//
// Covered:
//   REQ-VERIFY-001 [HIGH RISK]  token A resolves to A's data only; B never leaks
//   REQ-VERIFY-002              unknown valid-UUID token → 404 {valid:false}
//   REQ-VERIFY-003              stored signature_verdict is surfaced verbatim
//   happy-path                  documented public shape for a seeded cert
//
// R2-backed paths (GET /:token/download, the live-recheck branch of
// /:token/signature, and the verifyPdf crypto in POST /:token/match) require a
// real signed PDF in R2 + the ICP-Brasil trust store and are NOT reachable from
// this harness — flagged below, DB-lookup half of /match still exercised.
// ---------------------------------------------------------------------------

const VALID_UUID_A = "11111111-1111-4111-8111-111111111111";
const VALID_UUID_B = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_UUID = "99999999-9999-4999-8999-999999999999";

type SeededCert = {
  jobRowId: number;
  jobId: string;
  token: string;
  customerName: string;
  assetName: string;
  assetTag: string;
  serviceName: string;
  labName: string;
};

const NOW = new Date("2026-01-01T00:00:00.000Z");

/**
 * Seed a fully-joined, publicly-verifiable calibration job (status APPROVED)
 * together with the org/unit/customer/asset/service chain the GET /:token join
 * walks. Every distinguishing string is parameterised so cross-cert leakage is
 * observable.
 */
async function seedVerifiableCert(params: {
  orgId: string;
  token: string;
  jobId: string;
  status?: JobStatus;
  accreditationActive?: boolean;
  accreditationNumber?: string | null;
  methodAccreditedScope?: boolean;
  signatureMetadata?: typeof calibrationJob.$inferInsert.signatureMetadata;
  signatureVerdict?: typeof calibrationJob.$inferInsert.signatureVerdict;
  // Amendment linkage (ISO 17025 7.8.4.1) — set to wire this job as an
  // amendment that supersedes / is superseded by another seeded job's row id.
  supersedesId?: number;
  supersededById?: number;
}): Promise<SeededCert> {
  const {
    orgId,
    token,
    jobId,
    status = "APPROVED",
    accreditationActive = false,
    accreditationNumber = null,
    methodAccreditedScope = false,
  } = params;

  const userId = `user-${orgId}`;
  const labName = `Lab ${orgId}`;
  const customerName = `Cliente ${orgId}`;
  const assetName = `Instrumento ${orgId}`;
  const assetTag = `TAG-${orgId}`;
  const serviceName = `Serviço ${orgId}`;

  await db.insert(user).values({
    id: userId,
    name: `User ${userId}`,
    email: `${userId}@lab.test`,
  });

  await db.insert(organization).values({
    id: orgId,
    name: labName,
    slug: orgId,
    type: "LAB",
    status: "ACTIVE",
    accreditationActive,
    accreditationNumber,
    createdAt: NOW,
  });

  // CLIENT org backing the customer's portal access (FK target).
  const clientOrgId = `client-${orgId}`;
  await db.insert(organization).values({
    id: clientOrgId,
    name: `Client ${clientOrgId}`,
    slug: clientOrgId,
    type: "CLIENT",
    status: "ACTIVE",
    createdAt: NOW,
  });

  const [unit] = await db
    .insert(organizationUnit)
    .values({
      organizationId: orgId,
      name: "Matriz",
      slug: `matriz-${orgId}`,
      status: "ACTIVE",
      isDefault: true,
      createdBy: userId,
    })
    .returning({ id: organizationUnit.id });
  if (!unit) throw new Error("seedVerifiableCert: unit insert failed");

  const [customerRow] = await db
    .insert(customer)
    .values({
      name: customerName,
      authOrganizationId: clientOrgId,
      labOrganizationId: orgId,
    })
    .returning({ id: customer.id });
  if (!customerRow)
    throw new Error("seedVerifiableCert: customer insert failed");

  const [assetTypeRow] = await db
    .insert(assetType)
    .values({
      name: `Tipo ${orgId}`,
      slug: `tipo-${orgId}`,
      definition: [],
    })
    .returning({ id: assetType.id });
  if (!assetTypeRow)
    throw new Error("seedVerifiableCert: assetType insert failed");

  const [assetRow] = await db
    .insert(asset)
    .values({
      unitId: unit.id,
      customerId: customerRow.id,
      // SEC-03b (#638): per-org tag uniqueness — derive lab org from the customer.
      labOrganizationId: sql`(select "lab_organization_id" from "customer" where "id" = ${customerRow.id})`,
      assetTypeId: assetTypeRow.id,
      name: assetName,
      serialNumber: `SN-${orgId}`,
      tag: assetTag,
    })
    .returning({ id: asset.id });
  if (!assetRow) throw new Error("seedVerifiableCert: asset insert failed");

  // No methodId on the service: the GET join is a leftJoin against
  // calibrationMethod, so accredited-scope is read from the method snapshot.
  const [serviceRow] = await db
    .insert(service)
    .values({
      organizationId: orgId,
      unitId: unit.id,
      name: serviceName,
    })
    .returning({ id: service.id });
  if (!serviceRow) throw new Error("seedVerifiableCert: service insert failed");

  const [jobRow] = await db
    .insert(calibrationJob)
    .values({
      jobId,
      organizationId: orgId,
      unitId: unit.id,
      customerId: customerRow.id,
      assetId: assetRow.id,
      serviceId: serviceRow.id,
      methodSnapshot: { accreditedScope: methodAccreditedScope },
      status,
      verificationToken: token,
      createdBy: userId,
      performedAt: NOW,
      approvedAt: status === "APPROVED" ? NOW : null,
      signatureMetadata: params.signatureMetadata,
      signatureVerdict: params.signatureVerdict,
      supersedesId: params.supersedesId,
      supersededById: params.supersededById,
    })
    .returning({ id: calibrationJob.id });
  if (!jobRow) throw new Error("seedVerifiableCert: job insert failed");

  return {
    jobRowId: jobRow.id,
    jobId,
    token,
    customerName,
    assetName,
    assetTag,
    serviceName,
    labName,
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

describe("verifyRouter — real DB, public certificate verification", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // =========================================================================
  // REQ-VERIFY-001 [HIGH RISK]
  // A known token returns ONLY that certificate's verification data. Two
  // independent certs are seeded so the token is the SOLE discriminator: a
  // lookup for A's token must never surface any of B's data.
  //
  // Mutation proof: neutralizing `eq(calibrationJob.verificationToken, token)`
  // in the GET /:token query (so the WHERE no longer pins the row) lets an
  // arbitrary releasable job satisfy the filter → A's jobId / customer / asset
  // assertions go RED (and B's data can leak through). Verified RED then
  // reverted.
  // =========================================================================
  it("REQ-VERIFY-001: token A → A's own data only; B's data never leaks", async () => {
    const certA = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-0001",
    });
    const certB = await seedVerifiableCert({
      orgId: "org-b",
      token: VALID_UUID_B,
      jobId: "CAL-B-0001",
    });

    // --- Lookup by A's token resolves to A's own data, B never leaking. ---
    const resA = await verifyRouter.request(`/${certA.token}`);
    expect(resA.status).toBe(200);
    const bodyA: unknown = await resA.json();
    expect(isRecord(bodyA)).toBe(true);
    if (!isRecord(bodyA)) throw new Error("unreachable");

    expect(bodyA.valid).toBe(true);
    expect(bodyA.jobId).toBe(certA.jobId);
    expect(bodyA.lab).toBe(certA.labName);
    expect(bodyA.customer).toBe(certA.customerName);
    expect(isRecord(bodyA.asset) && bodyA.asset.name).toBe(certA.assetName);
    expect(isRecord(bodyA.asset) && bodyA.asset.tag).toBe(certA.assetTag);
    expect(bodyA.service).toBe(certA.serviceName);

    const serializedA = JSON.stringify(bodyA);
    expect(serializedA).not.toContain(certB.jobId);
    expect(serializedA).not.toContain(certB.labName);
    expect(serializedA).not.toContain(certB.customerName);
    expect(serializedA).not.toContain(certB.assetTag);
    expect(serializedA).not.toContain(certB.serviceName);

    // --- Lookup by B's token resolves to B's OWN data, A never leaking. ---
    // Both directions are asserted so the token is provably the discriminator:
    // a neutralized token filter (with no ORDER BY) would return the SAME
    // physical-scan row for both tokens, so at least one direction must fail.
    const resB = await verifyRouter.request(`/${certB.token}`);
    expect(resB.status).toBe(200);
    const bodyB: unknown = await resB.json();
    expect(isRecord(bodyB)).toBe(true);
    if (!isRecord(bodyB)) throw new Error("unreachable");

    expect(bodyB.jobId).toBe(certB.jobId);
    expect(bodyB.lab).toBe(certB.labName);
    expect(bodyB.customer).toBe(certB.customerName);
    expect(isRecord(bodyB.asset) && bodyB.asset.tag).toBe(certB.assetTag);

    const serializedB = JSON.stringify(bodyB);
    expect(serializedB).not.toContain(certA.jobId);
    expect(serializedB).not.toContain(certA.labName);
    expect(serializedB).not.toContain(certA.customerName);
    expect(serializedB).not.toContain(certA.assetTag);
    expect(serializedB).not.toContain(certA.serviceName);
  });

  // =========================================================================
  // REQ-VERIFY-002
  // An unknown (but syntactically valid) UUID resolves to not-found: 404 with
  // { valid:false } and no internal payload. A real cert is seeded under a
  // DIFFERENT token so "no row matches" is genuine, not an empty DB.
  //
  // Mutation proof: dropping the token filter (or the status filter) from the
  // GET /:token WHERE makes the seeded cert satisfy the query for ANY token →
  // 200 { valid:true } → this 404 / valid:false assertion goes RED. Verified
  // RED then reverted.
  // =========================================================================
  it("REQ-VERIFY-002: unknown valid-UUID token → 404 { valid:false }, no leak", async () => {
    const seeded = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-0001",
    });

    const res = await verifyRouter.request(`/${UNKNOWN_UUID}`);
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error("unreachable");

    expect(body.valid).toBe(false);
    // No internal/other-cert data leaked through the not-found response.
    expect(body.jobId).toBeUndefined();
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(seeded.jobId);
    expect(serialized).not.toContain(seeded.customerName);
    expect(serialized).not.toContain(seeded.assetTag);
  });

  // =========================================================================
  // REQ-VERIFY-002b
  // A DRAFT (not-yet-releasable) cert must not be publicly verifiable even via
  // its real token — the status filter `status IN ("APPROVED","SUPERSEDED")`
  // is the guard. Proves the status half of the lookup key independently.
  //
  // Mutation proof: removing the inArray(status, ...) filter makes the DRAFT
  // resolvable → 200 → this 404 assertion goes RED.
  // =========================================================================
  it("REQ-VERIFY-002b: DRAFT cert (real token) is not publicly verifiable → 404", async () => {
    const draft = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-DRAFT",
      status: "DRAFT",
    });

    const res = await verifyRouter.request(`/${draft.token}`);
    expect(res.status).toBe(404);
    const body: unknown = await res.json();
    expect(isRecord(body) && body.valid).toBe(false);
  });

  // =========================================================================
  // REQ-VERIFY-002c
  // A malformed (non-UUID) token is rejected at the format gate before any DB
  // lookup: 400 "Token invalido". This bounds enumeration on the public route.
  // =========================================================================
  it("REQ-VERIFY-002c: malformed (non-UUID) token → 400 before lookup", async () => {
    const res = await verifyRouter.request("/not-a-uuid");
    expect(res.status).toBe(400);
    const body: unknown = await res.json();
    expect(isRecord(body) && body.error).toBe("Token invalido");
  });

  // =========================================================================
  // REQ-VERIFY-003
  // GET /:token/signature serves the at-issue signature_verdict (migration
  // 0052) verbatim under `verdict`, with `source:"issue"`. A cert is seeded
  // with a KNOWN stored verdict; the response must reflect THAT verdict.
  //
  // Mutation proof: replacing `job.signatureVerdict` with `null` in the fast
  // path (so it falls through to the live/unverifiable branch) changes the
  // source away from "issue" and drops the stored `overall:"VALID"` →
  // assertions go RED. Verified RED then reverted.
  // =========================================================================
  it("REQ-VERIFY-003: stored signature_verdict is surfaced verbatim (source=issue)", async () => {
    const computedAt = "2026-01-02T03:04:05.000Z";
    const storedVerdict = {
      hashMatch: true,
      signatureCryptographicallyValid: true,
      chainValid: true,
      signerChainsToIcpRoot: true,
      certNotExpiredAtCheckDate: true,
      signaturePresent: true,
      signer: {
        commonName: "FULANO DE TAL:12345678900",
        cpfCnpj: "12345678900",
        certificateSerial: "0A1B2C3D",
      },
      overall: "VALID",
      details: ["Assinatura íntegra e cadeia ICP-Brasil válida."],
      computedAt,
    } satisfies NonNullable<
      typeof calibrationJob.$inferInsert.signatureVerdict
    >;

    const cert = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-SIGNED",
      signatureMetadata: {
        signedAt: "2026-01-02T03:00:00.000Z",
        signerCertificateSerial: "0A1B2C3D",
        signerName: "FULANO DE TAL",
        signerCpfCnpj: "12345678900",
        pdfHash:
          "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ltvEnabled: true,
      },
      signatureVerdict: storedVerdict,
    });

    const res = await verifyRouter.request(`/${cert.token}/signature`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error("unreachable");

    expect(body.signed).toBe(true);
    // Served from the at-issue stored verdict, no R2 round-trip.
    expect(body.source).toBe("issue");
    expect(body.computedAt).toBe(computedAt);
    expect(isRecord(body.verdict)).toBe(true);
    if (!isRecord(body.verdict)) throw new Error("unreachable");
    // The stored verdict, verbatim (computedAt is hoisted out of `verdict`).
    expect(body.verdict.overall).toBe("VALID");
    expect(body.verdict.hashMatch).toBe(true);
    expect(body.verdict.signerChainsToIcpRoot).toBe(true);
    expect(isRecord(body.verdict.signer) && body.verdict.signer.cpfCnpj).toBe(
      "12345678900",
    );
    expect(body.verdict.computedAt).toBeUndefined();
  });

  // =========================================================================
  // REQ-VERIFY-003b
  // An unsigned, releasable cert reports { signed:false, verdict:null } from
  // GET /:token/signature — never 500s, no R2 access. Guards the unsigned
  // branch of the same surface.
  // =========================================================================
  it("REQ-VERIFY-003b: unsigned cert → signature endpoint reports signed:false", async () => {
    const cert = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-UNSIGNED",
    });

    const res = await verifyRouter.request(`/${cert.token}/signature`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error("unreachable");
    expect(body.signed).toBe(false);
    expect(body.verdict).toBeNull();
    expect(body.source).toBeNull();
  });

  // =========================================================================
  // REQ-SEC-VER-001 (SEC-07)
  // `supersedesInfo` (the "supersedes" field: the ORIGINAL job this amendment
  // replaces) must apply the same terminal-status filter
  // `inArray(status, ["APPROVED","SUPERSEDED"])` that `supersededByInfo` and
  // every other query in this file already apply. Before the fix, the
  // supersedesId lookup had NO status filter, so an original job stuck in a
  // non-terminal state (DRAFT/IN_PROGRESS/REVIEW/GENERATING_PDF/REJECTED/
  // CANCELED) would still leak its jobId/verificationToken to anyone holding
  // the (already-terminal) amendment's public verify link.
  //
  // Mutation proof: reverting the fix (dropping the inArray filter from the
  // supersedesId query) makes the REJECTED original resolve → `supersedes`
  // becomes non-null → the first assertion below goes RED.
  // =========================================================================
  it("REQ-SEC-VER-001: supersedesInfo omits a non-terminal-status original", async () => {
    // The "original" certificate this amendment corrects — stuck in a
    // non-terminal state (e.g. reopened for rework after the amendment was
    // already approved). Its own token is irrelevant to this assertion; it
    // must not be reachable via the amendment's `supersedes` field either.
    const original = await seedVerifiableCert({
      orgId: "org-orig",
      token: VALID_UUID_B,
      jobId: "CAL-A-ORIG-NONTERMINAL",
      status: "REJECTED",
    });

    const amendment = await seedVerifiableCert({
      orgId: "org-amend",
      token: VALID_UUID_A,
      jobId: "CAL-A-AMENDMENT",
      status: "APPROVED",
      supersedesId: original.jobRowId,
    });

    const res = await verifyRouter.request(`/${amendment.token}`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error("unreachable");

    // isAmendment reflects the raw supersedesId column (unfiltered) — only
    // the *resolved* `supersedes` payload is status-gated.
    expect(body.isAmendment).toBe(true);
    expect(body.supersedes).toBeNull();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(original.jobId);
    expect(serialized).not.toContain(original.token);
  });

  // =========================================================================
  // REQ-SEC-VER-001 (positive control)
  // A terminal-status (SUPERSEDED) original IS still surfaced in
  // `supersedesInfo` — the fix must not over-filter and break the documented,
  // legitimate amendment-chain-navigation case.
  // =========================================================================
  it("REQ-SEC-VER-001: supersedesInfo still includes a terminal-status original", async () => {
    const original = await seedVerifiableCert({
      orgId: "org-orig",
      token: VALID_UUID_B,
      jobId: "CAL-A-ORIG-TERMINAL",
      status: "SUPERSEDED",
    });

    const amendment = await seedVerifiableCert({
      orgId: "org-amend",
      token: VALID_UUID_A,
      jobId: "CAL-A-AMENDMENT-2",
      status: "APPROVED",
      supersedesId: original.jobRowId,
    });

    const res = await verifyRouter.request(`/${amendment.token}`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error("unreachable");

    expect(body.isAmendment).toBe(true);
    expect(isRecord(body.supersedes)).toBe(true);
    if (!isRecord(body.supersedes)) throw new Error("unreachable");
    expect(body.supersedes.jobId).toBe(original.jobId);
    expect(body.supersedes.verificationToken).toBe(original.token);
  });

  // =========================================================================
  // happy-path
  // GET /:token returns the documented public shape for a fully-populated,
  // accredited, signed cert — including the accreditation seal (lab active +
  // numbered AND method in accredited scope) and the digital-signature block.
  // =========================================================================
  it("happy-path: GET /:token returns the documented public shape (accredited + signed)", async () => {
    const cert = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-FULL",
      accreditationActive: true,
      accreditationNumber: "9999",
      methodAccreditedScope: true,
      signatureMetadata: {
        signedAt: "2026-01-02T03:00:00.000Z",
        signerCertificateSerial: "DEADBEEF",
        signerName: "SIGNER NAME",
        signerCpfCnpj: "98765432100",
        pdfHash:
          "1111111111111111111111111111111111111111111111111111111111111111",
        ltvEnabled: true,
      },
    });

    const res = await verifyRouter.request(`/${cert.token}`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(isRecord(body)).toBe(true);
    if (!isRecord(body)) throw new Error("unreachable");

    expect(body.valid).toBe(true);
    expect(body.jobId).toBe(cert.jobId);
    expect(body.status).toBe("APPROVED");
    expect(body.lab).toBe(cert.labName);
    expect(body.customer).toBe(cert.customerName);
    expect(body.service).toBe(cert.serviceName);

    // Accreditation seal: lab active+numbered AND method in scope → number
    // surfaced in normalized digits-only form.
    expect(isRecord(body.accreditation)).toBe(true);
    if (!isRecord(body.accreditation)) throw new Error("unreachable");
    expect(body.accreditation.accredited).toBe(true);
    expect(body.accreditation.number).toBe("9999");

    // Digital-signature block — ISO 17025 7.8.2.1(q).
    expect(isRecord(body.digitalSignature)).toBe(true);
    if (!isRecord(body.digitalSignature)) throw new Error("unreachable");
    expect(body.digitalSignature.signed).toBe(true);
    expect(body.digitalSignature.signerName).toBe("SIGNER NAME");
    expect(body.digitalSignature.signerCpfCnpj).toBe("98765432100");

    // Amendment fields are present and null for an original certificate.
    expect(body.isSuperseded).toBe(false);
    expect(body.isAmendment).toBe(false);
    expect(body.supersededBy).toBeNull();
    expect(body.supersedes).toBeNull();
  });

  // =========================================================================
  // happy-path (unaccredited)
  // When the lab is NOT accredited, the seal must be suppressed and the number
  // withheld even though every other public field is returned.
  // =========================================================================
  it("happy-path: unaccredited lab → accreditation seal suppressed, number null", async () => {
    const cert = await seedVerifiableCert({
      orgId: "org-a",
      token: VALID_UUID_A,
      jobId: "CAL-A-NOACC",
      accreditationActive: false,
      accreditationNumber: "9999",
      methodAccreditedScope: true,
    });

    const res = await verifyRouter.request(`/${cert.token}`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    if (!isRecord(body) || !isRecord(body.accreditation)) {
      throw new Error("unexpected body shape");
    }
    expect(body.accreditation.accredited).toBe(false);
    expect(body.accreditation.number).toBeNull();
  });
});
