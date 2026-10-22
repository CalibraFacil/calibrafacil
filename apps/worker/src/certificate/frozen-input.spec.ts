import {
  buildCertificateInput,
  canonicalJson,
  certificateInputSha256,
  type CertificateInput,
  type CertificateJobData,
} from "@calibra-facil/certificate-data";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCertificateLayoutData } from "./layout-data";
import { loadCertificateRenderSource, type RowQuery } from "./frozen-input";

/**
 * The worker's side of the frozen certificate input (ISO/IEC 17025 §7.8):
 * which source a certificate is rendered from, and that the data handed to the
 * template does not depend on the clock of whoever renders it.
 */

function job(overrides: Partial<CertificateJobData> = {}): CertificateJobData {
  return {
    jobId: "CAL-2026-0001",
    verificationToken: "tok-1",
    organizationId: "org-1",
    unitId: 1,
    performedAt: new Date("2026-01-01T09:00:00.000Z"),
    approvedAt: new Date("2026-01-02T12:00:00.000Z"),
    approverName: "Ana Aprovadora",
    scopeOverrideJustification: null,
    lab: {
      name: "Laboratório Teste",
      city: "Canoas",
      state: "RS",
      accreditationNumber: "9999",
      accreditationActive: true,
      accreditationValidFrom: new Date("2025-01-01T00:00:00.000Z"),
      // valid when approved, long gone by the time of a re-render
      accreditationValidUntil: new Date("2026-02-01T00:00:00.000Z"),
      technicalManagerTitle: "Signatário Autorizado",
    },
    customer: { name: "Cliente Teste", address: null },
    asset: {
      name: "Balança",
      serialNumber: "SN-1",
      tag: "TAG-1",
      model: null,
      manufacturer: null,
    },
    methodSnapshot: {
      methodId: 6,
      methodName: "Massa — balança",
      methodVersion: 1,
      accreditedScope: true,
      dataFields: [
        {
          key: "pontos",
          label: "Pontos",
          type: "table",
          columns: [
            {
              key: "carga_nominal",
              label: "Carga nominal",
              type: "number",
              unit: "g",
              quantityKind: "reference",
            },
          ],
        },
      ],
      formulas: [
        {
          outputKey: "erro",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: { role: "primary_result", group: "calibration_result" },
        },
        {
          outputKey: "u",
          expression: "x",
          unit: "g",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "expanded_uncertainty",
            group: "calibration_result",
          },
        },
        {
          outputKey: "k",
          expression: "2",
          scope: { kind: "table_row", tableKey: "pontos" },
          reporting: {
            role: "coverage_factor",
            group: "uncertainty_budget",
          },
        },
      ],
    },
    standardsSnapshot: null,
    data: { pontos: [{ carga_nominal: "500" }] },
    results: { erro: ["-0.52"], u: ["0.12"], k: ["2"] },
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

function frozen(): CertificateInput {
  return buildCertificateInput(job());
}

function layoutFromFrozen(input: CertificateInput) {
  const result = buildCertificateLayoutData(input.job, {
    qrCodeDataUrl: null,
    accredited: input.seal.accredited,
    verificationUrl: input.verificationUrl,
  });
  if (!result.ok) throw new Error(result.reasons.join(" "));
  return result.data;
}

describe("REQ-CIN-4: the data handed to the template depends on the frozen input only", () => {
  it("REQ-CIN-4 [HIGH RISK] the same frozen input gives byte-identical render data years later, after the accreditation vigência ended", () => {
    const input = frozen();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
    const atApproval = canonicalJson(layoutFromFrozen(input));
    vi.setSystemTime(new Date("2031-06-01T12:00:00.000Z"));
    const yearsLater = canonicalJson(layoutFromFrozen(input));

    expect(yearsLater).toBe(atApproval);
    expect(layoutFromFrozen(input).accredited).toBe(true);
  });

  it("REQ-CIN-4 the live path does not have that property (the vigência is evaluated at render time): it is the legacy behaviour the frozen seal replaces", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2031-06-01T12:00:00.000Z"));
    const legacy = buildCertificateLayoutData(job(), { qrCodeDataUrl: null });
    expect(legacy.ok && legacy.data.accredited).toBe(false);
  });

  it("REQ-CIN-4 a render from a JSON round trip of the frozen input (what the database returns) is identical", () => {
    const input = frozen();
    const reread: CertificateInput = JSON.parse(JSON.stringify(input));
    expect(canonicalJson(layoutFromFrozen(reread))).toBe(
      canonicalJson(layoutFromFrozen(input)),
    );
    expect(certificateInputSha256(reread)).toBe(certificateInputSha256(input));
  });
});

function clientReturning(rows: Record<string, unknown>[]): {
  client: RowQuery;
  query: ReturnType<typeof vi.fn>;
} {
  const query = vi.fn(async () => ({ rows }));
  return { client: { query }, query };
}

function storedRow(input: CertificateInput) {
  return {
    schema_version: input.schemaVersion,
    input,
    sha256: certificateInputSha256(input),
  };
}

describe("REQ-CIN-2: which source a certificate is rendered from", () => {
  const params = { jobId: 7, organizationId: "org-1" };

  it("REQ-CIN-2 [HIGH RISK] with a frozen input the live read is never made", async () => {
    const input = frozen();
    const { client, query } = clientReturning([storedRow(input)]);
    const legacy = vi.fn(async () => job());

    const source = await loadCertificateRenderSource(client, params, legacy);

    expect(source).toEqual({
      status: "ok",
      input,
      sha256: certificateInputSha256(input),
    });
    expect(legacy).not.toHaveBeenCalled();
    // and it is looked up for the job's own organization
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("organization_id"),
      [7, "org-1"],
    );
  });

  it("REQ-CIN-2 without a frozen input the legacy live read is used, once", async () => {
    const { client } = clientReturning([]);
    const legacyJob = job();
    const legacy = vi.fn(async () => legacyJob);

    const source = await loadCertificateRenderSource(client, params, legacy);

    expect(source).toEqual({ status: "legacy", job: legacyJob });
    expect(legacy).toHaveBeenCalledTimes(1);
  });

  it("REQ-CIN-2 [HIGH RISK] a frozen input that cannot be trusted is never replaced by a live read", async () => {
    const input = frozen();
    const tampered: CertificateInput = {
      ...input,
      job: { ...input.job, customer: { name: "Outro", address: null } },
    };
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      [
        "hash mismatch",
        { ...storedRow(input), input: tampered },
        /sha256 mismatch/,
      ],
      [
        "unknown schema version",
        { ...storedRow(input), schema_version: 2 },
        /unsupported schema version/,
      ],
      [
        "unexpected shape",
        { ...storedRow(input), input: { schemaVersion: 1 } },
        /unexpected shape/,
      ],
    ];
    for (const [label, row, reason] of cases) {
      const legacy = vi.fn(async () => job());
      const source = await loadCertificateRenderSource(
        clientReturning([row]).client,
        params,
        legacy,
      );
      expect(source.status, label).toBe("corrupt");
      expect(source.status === "corrupt" ? source.reason : "", label).toMatch(
        reason,
      );
      expect(legacy, label).not.toHaveBeenCalled();
    }
  });

  it("REQ-CIN-2 a job without an organization has no frozen input to look up and falls to the legacy read", async () => {
    const { client, query } = clientReturning([]);
    const legacy = vi.fn(async () => null);

    const source = await loadCertificateRenderSource(
      client,
      { jobId: 7, organizationId: null },
      legacy,
    );

    expect(source).toEqual({ status: "legacy", job: null });
    expect(query).not.toHaveBeenCalled();
  });
});
