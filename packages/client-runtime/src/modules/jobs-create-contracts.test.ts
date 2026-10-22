import { ResponseContractError } from "@calibra-facil/contracts";
import {
  buildJobCreateResponse,
  buildJobFlagOotResponse,
  buildJobGenerateLabelResponse,
} from "@calibra-facil/contracts/jobs-fixtures";
import { describe, expect, it, vi } from "vitest";

import { createCloudApiClient } from "../index";

function clientReplying(
  body: unknown,
  options: Partial<Parameters<typeof createCloudApiClient>[0]> = {},
) {
  const fetchImpl: typeof fetch = async () => Response.json(body);
  return createCloudApiClient({
    baseUrl: "https://api.example.test",
    fetch: fetchImpl,
    ...options,
  });
}

describe("jobs create, flag-oot and generate-label response contracts", () => {
  it("REQ-TC-2: create returns the validated job row (no generic, typed by the schema)", async () => {
    const created = buildJobCreateResponse({ jobId: "CAL-2026-0001" });
    const result = await clientReplying(created).jobs.create({
      assetId: 5,
      serviceId: 6,
    });
    expect(result.jobId).toBe("CAL-2026-0001");
    expect(result.status).toBe("DRAFT");
    expect(result).toEqual(created);
  });

  it("REQ-TC-2: flag-oot returns the validated nc and notification", async () => {
    const flagged = buildJobFlagOotResponse();
    const result = await clientReplying(flagged).jobs.flagOutOfTolerance(7, {
      notifyCustomer: true,
    });
    expect(result.data.nc.ncNumber).toBe("NC-2026-0001");
    expect(result.data.notification?.status).toBe("PENDING");

    const withoutNotice = buildJobFlagOotResponse({ notification: null });
    expect(
      (
        await clientReplying(withoutNotice).jobs.flagOutOfTolerance(7, {
          notifyCustomer: false,
        })
      ).data.notification,
    ).toBeNull();
  });

  it("REQ-TC-2: generate-label returns the validated queued acknowledgement", async () => {
    const queued = buildJobGenerateLabelResponse(7);
    const result = await clientReplying(queued).jobs.generateLabel(7);
    expect(result.jobId).toBe(7);
    expect(result).toEqual(queued);
  });

  it("REQ-TC-2: strict mode rejects each of the three when the body breaks the contract", async () => {
    const broken = clientReplying({ message: "ok" });
    await expect(
      broken.jobs.create({ assetId: 5, serviceId: 6 }),
    ).rejects.toBeInstanceOf(ResponseContractError);
    await expect(
      broken.jobs.flagOutOfTolerance(7, { notifyCustomer: true }),
    ).rejects.toBeInstanceOf(ResponseContractError);
    await expect(broken.jobs.generateLabel(7)).rejects.toBeInstanceOf(
      ResponseContractError,
    );
  });

  it("REQ-TC-2: warn mode (production) reports the endpoint and hands the body through", async () => {
    const onViolation = vi.fn();
    const legacy = { message: "Gerando etiqueta..." };
    const client = clientReplying(legacy, {
      responseValidation: "warn",
      onResponseContractViolation: onViolation,
    });

    expect(await client.jobs.generateLabel(7)).toEqual(legacy);
    expect(onViolation.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "POST /api/jobs/:id/generate-label",
    });
  });
});
