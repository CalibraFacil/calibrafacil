import { ResponseContractError } from "@calibra-facil/contracts";
import {
  buildEffectiveEnvironmentalLimits,
  buildEnvironmentalLimitsResponse,
  buildDeleteEnvironmentalLimitResponse,
  buildMassCompositionProfilesResponse,
  buildSaveEnvironmentalLimitResponse,
  buildStandard,
  buildStandardCertificateDocumentDownloadResponse,
  buildStandardCertificateDocumentUploadResponse,
  buildStandardRecord,
  buildStandardsList,
} from "@calibra-facil/contracts/standards-fixtures";
import { describe, expect, it, vi } from "vitest";

import { createCloudApiClient } from "../index";
import { CalibraApiError } from "../transport/errors";

type Reply = { status?: number; body: unknown };

function clientReplying(
  reply: Reply,
  options: Partial<Parameters<typeof createCloudApiClient>[0]> = {},
) {
  const requests: Array<{ url: string; method: string }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
    });
    return Response.json(reply.body, { status: reply.status ?? 200 });
  };
  const client = createCloudApiClient({
    baseUrl: "https://api.example.test",
    fetch: fetchImpl,
    ...options,
  });
  return { client, requests };
}

describe("standards module response contracts", () => {
  it("REQ-TC-1: list, detail, create and update return the validated payload untouched", async () => {
    const list = buildStandardsList();
    expect(
      await clientReplying({ body: list }).client.standards.list({
        page: 1,
        limit: 20,
      }),
    ).toEqual(list);

    const detail = buildStandard({ isExpired: true, daysUntilExpiry: -3 });
    const got = await clientReplying({ body: detail }).client.standards.get(1);
    // Typed by the schema: no generic needed to read a field.
    expect(got.daysUntilExpiry).toBe(-3);
    expect(got).toEqual(detail);

    const record = buildStandardRecord();
    // Create and update answer with the stored row (no validity verdict).
    expect(
      (await clientReplying({ body: record }).client.standards.create({}))
        .certificateNumber,
    ).toBe("CERT-001");
    expect(
      await clientReplying({ body: record }).client.standards.update(1, {}),
    ).toEqual(record);
  });

  it("REQ-TC-1: the composition-profile catalog and the active-standards lookup are validated", async () => {
    const catalog = buildMassCompositionProfilesResponse();
    expect(
      await clientReplying({
        body: catalog,
      }).client.standards.listCompositionProfiles(),
    ).toEqual(catalog);

    const list = buildStandardsList();
    const { client, requests } = clientReplying({ body: list });
    expect(await client.jobs.listStandards()).toEqual(list);
    expect(requests[0]?.url).toBe(
      "https://api.example.test/api/standards?status=ACTIVE&limit=100",
    );
  });

  it("REQ-TC-1: the certificate document upload and download links are validated", async () => {
    const uploaded = buildStandardCertificateDocumentUploadResponse();
    expect(
      await clientReplying({
        body: uploaded,
      }).client.standards.uploadCertificateDocument(
        1,
        new Blob(["%PDF-1.4"], { type: "application/pdf" }),
      ),
    ).toEqual(uploaded);

    const link = buildStandardCertificateDocumentDownloadResponse();
    expect(
      await clientReplying({
        body: link,
      }).client.standards.getCertificateDocumentDownloadUrl(1),
    ).toEqual(link);

    await expect(
      clientReplying({
        body: { url: 42, filename: "x.pdf" },
      }).client.standards.getCertificateDocumentDownloadUrl(1),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("REQ-TC-1: strict mode rejects a standard that breaks its contract, naming the endpoint", async () => {
    const { client } = clientReplying({ body: { id: 1, name: "Sem datas" } });

    const failure = await client.standards
      .get(1)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ResponseContractError);
    if (failure instanceof ResponseContractError) {
      expect(failure.violation.endpoint).toBe("GET /api/standards/:id");
    }
    await expect(
      clientReplying({ body: { data: [] } }).client.standards.list(),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("REQ-TC-1: warn mode (production) reports the mismatch and hands the body through", async () => {
    const onViolation = vi.fn();
    const legacy = { data: [] };
    const { client } = clientReplying(
      { body: legacy },
      {
        responseValidation: "warn",
        onResponseContractViolation: onViolation,
      },
    );

    expect(await client.standards.list()).toEqual(legacy);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "GET /api/standards",
    });
  });

  it("REQ-TC-1: an HTTP error is still a CalibraApiError, never a contract error", async () => {
    const failure = await clientReplying({
      status: 404,
      body: { error: "Padrão não encontrado" },
    })
      .client.standards.get(404)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
    expect(failure).toMatchObject({ status: 404 });
  });
});

describe("environmental-limits module response contracts", () => {
  it("REQ-TC-1: list, save and delete return the validated payload untouched", async () => {
    const list = buildEnvironmentalLimitsResponse();
    expect(
      await clientReplying({ body: list }).client.environmentalLimits.list(),
    ).toEqual(list);

    const saved = buildSaveEnvironmentalLimitResponse();
    expect(
      await clientReplying({ body: saved }).client.environmentalLimits.save({
        assetTypeId: null,
        temperatureMin: 18,
        temperatureMax: 25,
        humidityMin: null,
        humidityMax: null,
        pressureMin: null,
        pressureMax: null,
      }),
    ).toEqual(saved);

    const removed = buildDeleteEnvironmentalLimitResponse();
    expect(
      await clientReplying({ body: removed }).client.environmentalLimits.delete(
        5,
      ),
    ).toEqual(removed);
  });

  it("REQ-TC-1: the effective limits lookup is validated; an HTTP error still means no limits", async () => {
    const effective = buildEffectiveEnvironmentalLimits({
      source: "asset_type",
    });
    const got = await clientReplying({
      body: effective,
    }).client.jobs.getEffectiveEnvironmentalLimits(3, { unitId: 1 });
    expect(got.source).toBe("asset_type");
    expect(got.limits?.temperatureMax).toBe(25);

    expect(
      await clientReplying({
        status: 403,
        body: { error: "Sem acesso" },
      }).client.jobs.getEffectiveEnvironmentalLimits(3),
    ).toEqual({ limits: null, source: null });

    await expect(
      clientReplying({
        body: { limits: null, source: "local" },
      }).client.jobs.getEffectiveEnvironmentalLimits(3),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("REQ-TC-1: strict mode rejects a list that breaks its contract", async () => {
    await expect(
      clientReplying({
        body: { limits: [{ id: 1 }], unit: { unitId: 1, unitName: null } },
      }).client.environmentalLimits.list(),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });
});
