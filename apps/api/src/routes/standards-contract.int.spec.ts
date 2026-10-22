/**
 * standards-contract.int.spec.ts: P2-15 REQ-TC-1. The standards endpoints'
 * REAL responses (real handlers, real middleware, real Postgres) must parse
 * with the response schemas in `@calibra-facil/contracts` that the client SDK
 * validates against and the desktop local-server mirrors. A handler that
 * changes the shape it returns fails here before a client sees it.
 *
 * Covered: GET /, GET /:id, POST /, PUT /:id (changed and unchanged),
 * GET /composition-profiles, POST /:id/certificate-document and
 * GET /:id/certificate-document/download (object storage is stubbed: the
 * handlers still `satisfies` the contract type).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";
import {
  massCompositionProfilesResponseSchema,
  standardCertificateDocumentDownloadResponseSchema,
  standardCertificateDocumentUploadResponseSchema,
  standardRecordSchema,
  standardSchema,
  standardsListResponseSchema,
} from "@calibra-facil/contracts";
import { db } from "@calibra-facil/db";
import { massCompositionProfile } from "@calibra-facil/db/schema";
import { standardsRouter } from "./standards";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedStandard } from "../../test/integration/seed";

vi.mock("../lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/storage")>();
  return {
    ...actual,
    createR2Client: vi.fn(() => ({})),
    uploadToR2: vi.fn().mockResolvedValue(undefined),
    generatePresignedUrl: vi
      .fn()
      .mockResolvedValue("https://storage.example.test/signed.pdf"),
  };
});

vi.mock("../lib/oot-notifications", () => ({
  ensureStandardRecall: vi.fn().mockResolvedValue(undefined),
  createStandardRecallNotifications: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ENV = { R2_BUCKET_NAME: "test-bucket" };

const NEW_STANDARD = {
  name: "Massa padrão 1 kg",
  kind: "generic_scalar",
  type: "Peso",
  serialNumber: "SN-CONTRACT-1",
  manufacturer: "Fabricante",
  model: "M-1",
  certificateNumber: "RBC-2026-777",
  calibratedBy: "INMETRO",
  calibrationDate: "2026-01-01",
  nextCalibrationDate: "2027-01-01",
  referenceValue: 1000,
  uncertainty: 0.01,
  uncertaintyUnit: "g",
  coverageFactor: 2,
  distribution: "normal",
  certifiedValues: [
    { nominal: "1000", value: 1000, uncertainty: 0.01, unit: "g" },
  ],
  status: "ACTIVE",
} as const;

/** Parses with the contract schema; the issues name the drifting path on failure. */
async function parsedBody<TSchema extends z.ZodType>(
  response: Response,
  schema: TSchema,
  expectedStatus = 200,
): Promise<z.output<TSchema>> {
  const body: unknown = await response.json();
  expect(response.status, JSON.stringify(body)).toBe(expectedStatus);
  const result = schema.safeParse(body);
  expect(result.success, JSON.stringify(result.error?.issues)).toBe(true);
  return schema.parse(body);
}

describe("standards endpoints: real responses honor the contract schemas (P2-15 REQ-TC-1)", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  it("REQ-TC-1: GET / and GET /:id parse, with the validity verdict and a null certificate document", async () => {
    const org = await seedOrg({ orgId: "org-std-contract", role: "admin" });
    const id = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
      name: "Padrão de leitura",
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const list = await parsedBody(
      await standardsRouter.request("/?page=1&limit=20", {
        headers: JSON_HEADERS,
      }),
      standardsListResponseSchema,
    );
    expect(list.data.map((standard) => standard.name)).toEqual([
      "Padrão de leitura",
    ]);
    expect(list.data[0]?.certificateDocument).toBeNull();
    expect(list.pagination.total).toBe(1);

    const detail = await parsedBody(
      await standardsRouter.request(`/${id}`, { headers: JSON_HEADERS }),
      standardSchema,
    );
    expect(detail.id).toBe(id);
    expect(typeof detail.isExpired).toBe("boolean");
    expect(typeof detail.daysUntilExpiry).toBe("number");
  });

  it("REQ-TC-1: POST / answers 201 with the stored row; PUT /:id answers the updated row, or the unchanged one", async () => {
    const org = await seedOrg({ orgId: "org-std-contract", role: "admin" });
    loginAs({ userId: org.userId, organizationId: org.orgId });
    const headers = { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) };

    const created = await parsedBody(
      await standardsRouter.request("/", {
        method: "POST",
        headers,
        body: JSON.stringify(NEW_STANDARD),
      }),
      standardRecordSchema,
      201,
    );
    expect(created.certificateNumber).toBe("RBC-2026-777");
    expect(created.certifiedValues?.[0]?.nominal).toBe("1000");

    const updated = await parsedBody(
      await standardsRouter.request(`/${created.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status: "INACTIVE" }),
      }),
      standardRecordSchema,
    );
    expect(updated.status).toBe("INACTIVE");

    // No field changed: the handler returns the row it read.
    const unchanged = await parsedBody(
      await standardsRouter.request(`/${created.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status: "INACTIVE" }),
      }),
      standardRecordSchema,
    );
    expect(unchanged.id).toBe(created.id);
  });

  it("REQ-TC-1: the certificate document upload and download links parse, and the list then carries the document", async () => {
    const org = await seedOrg({ orgId: "org-std-contract", role: "admin" });
    const id = await seedStandard({
      organizationId: org.orgId,
      unitId: org.unitId,
      createdBy: org.userId,
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const form = new FormData();
    form.set(
      "certificate",
      new File(["%PDF-1.4 contract"], "certificado.pdf", {
        type: "application/pdf",
      }),
    );
    const uploaded = await parsedBody(
      await standardsRouter.request(
        `/${id}/certificate-document`,
        { method: "POST", body: form },
        ENV,
      ),
      standardCertificateDocumentUploadResponseSchema,
    );
    expect(uploaded.document.fileName).toBe("certificado.pdf");

    const link = await parsedBody(
      await standardsRouter.request(
        `/${id}/certificate-document/download`,
        { headers: JSON_HEADERS },
        ENV,
      ),
      standardCertificateDocumentDownloadResponseSchema,
    );
    expect(link.filename).toBe("certificado.pdf");

    const detail = await parsedBody(
      await standardsRouter.request(`/${id}`, { headers: JSON_HEADERS }),
      standardSchema,
    );
    expect(detail.certificateDocument?.documentId).toBe(
      uploaded.document.documentId,
    );
  });

  it("REQ-TC-1: GET /composition-profiles parses", async () => {
    const org = await seedOrg({ orgId: "org-std-contract", role: "admin" });
    await db.insert(massCompositionProfile).values({
      organizationId: org.orgId,
      profileKey: "M1:1g",
      profileClass: "M1",
      nominal: "1 g",
      nominalG: 1,
      value: 1,
      uncertainty: 0.001,
      unit: "g",
      coverageFactor: 2,
      quantityAvailable: 1,
    });
    loginAs({ userId: org.userId, organizationId: org.orgId });

    const catalog = await parsedBody(
      await standardsRouter.request("/composition-profiles", {
        headers: JSON_HEADERS,
      }),
      massCompositionProfilesResponseSchema,
    );
    expect(catalog.data.map((profile) => profile.profileKey)).toEqual([
      "M1:1g",
    ]);
  });
});
