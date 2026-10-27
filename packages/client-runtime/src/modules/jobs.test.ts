import { ResponseContractError } from "@calibra-facil/contracts";
import {
  buildJobAmendResponse,
  buildJobDetail,
  buildJobExecutionWarning,
  buildJobMutationResponse,
  buildJobsList,
  buildJobWithdrawCertificateResponse,
} from "@calibra-facil/contracts/jobs-fixtures";
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

describe("jobs module response contracts", () => {
  it("REQ-TC-2: list, get and technicians return the validated payload untouched", async () => {
    const list = buildJobsList();
    expect(
      await clientReplying({ body: list }).client.jobs.list({
        page: 1,
        limit: 20,
      }),
    ).toEqual(list);

    const detail = buildJobDetail({ status: "REVIEW" });
    const got = await clientReplying({ body: detail }).client.jobs.get(7);
    // Typed by the schema: no generic needed to read a detail field.
    expect(got.methodSnapshot.methodName).toBe("Método de massa");
    expect(got).toEqual(detail);

    const technicians = {
      data: [{ id: "u1", name: "Ana", email: "ana@lab.test", role: "admin" }],
    };
    expect(
      await clientReplying({ body: technicians }).client.jobs.listTechnicians(),
    ).toEqual(technicians);
  });

  it("REQ-TC-2: every job mutation returns the validated { message, data } row", async () => {
    const body = buildJobMutationResponse(
      { status: "REVIEW" },
      "Job submetido",
    );
    const { client, requests } = clientReplying({ body });

    const executionInput = { data: { load: 10 } };
    const results = [
      await client.jobs.approve(7, { reason: "ok" }),
      await client.jobs.reject(7, "motivo"),
      await client.jobs.cancel(7, "motivo"),
      await client.jobs.assign(7, "user-2"),
      await client.jobs.saveExecution(7, executionInput),
      await client.jobs.submitExecution(7, executionInput),
    ];

    for (const result of results) {
      expect(result.data.status).toBe("REVIEW");
    }
    expect(requests.map((request) => request.method)).toEqual([
      "POST",
      "POST",
      "DELETE",
      "POST",
      "POST",
      "POST",
    ]);
  });

  it("REQ-P111-4: saving a draft hands the standards warnings to the caller; a malformed warning breaks the contract", async () => {
    const warning = buildJobExecutionWarning({
      reason: "standard_inactive",
      standardIds: [11],
      standardNames: ["Peso padrão 10 g"],
    });
    const saved = await clientReplying({
      body: buildJobMutationResponse({ status: "IN_PROGRESS" }, "Salvo", [
        warning,
      ]),
    }).client.jobs.saveExecution(7, { data: { load: 10 } });
    expect(saved.warnings).toEqual([warning]);

    await expect(
      clientReplying({
        body: {
          ...buildJobMutationResponse(),
          warnings: [{ ...warning, standardIds: "11" }],
        },
      }).client.jobs.saveExecution(7, { data: { load: 10 } }),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("REQ-TC-2: amend and the download links are validated too", async () => {
    const amended = await clientReplying({
      body: buildJobAmendResponse(),
    }).client.jobs.amend(7, "Erro de digitação na incerteza");
    expect(amended.amendedJob.amendmentNumber).toBe(1);

    const link = { url: "https://files.example.test/c.pdf" };
    const { client } = clientReplying({ body: link });
    expect(await client.jobs.getCertificateDownloadUrl(7)).toEqual(link);
    expect(await client.jobs.getLabelDownloadUrl(7)).toEqual(link);
  });

  it("REQ-TC-2: withdrawCertificate posts the reason to the certificate route and validates the answer", async () => {
    const { client, requests } = clientReplying({
      body: buildJobWithdrawCertificateResponse(),
    });

    const withdrawn = await client.jobs.withdrawCertificate(
      7,
      "Padrao de referencia recolhido",
    );

    expect(withdrawn.certificateStatus).toBe("WITHDRAWN");
    expect(requests).toEqual([
      {
        url: "https://api.example.test/api/jobs/7/certificate/withdraw",
        method: "POST",
      },
    ]);
    await expect(
      clientReplying({
        body: {
          ...buildJobWithdrawCertificateResponse(),
          certificateStatus: "ISSUED",
        },
      }).client.jobs.withdrawCertificate(7, "Padrao de referencia recolhido"),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("REQ-TC-2: strict mode (the default) rejects a response that breaks its contract", async () => {
    const { client } = clientReplying({ body: { id: 7, jobId: "CAL-0007" } });

    const failure = await client.jobs.get(7).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ResponseContractError);
    if (failure instanceof ResponseContractError) {
      expect(failure.violation.endpoint).toBe("GET /api/jobs/:id");
      expect(failure.violation.issues.length).toBeGreaterThan(0);
    }

    await expect(
      clientReplying({ body: { message: "ok" } }).client.jobs.approve(7, {
        reason: "ok",
      }),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("REQ-TC-2: warn mode (production) reports the mismatch and keeps the UI working", async () => {
    const onViolation = vi.fn();
    const legacy = { id: 7, jobId: "CAL-0007", status: "REVIEW" };
    const { client } = clientReplying(
      { body: legacy },
      {
        responseValidation: "warn",
        onResponseContractViolation: onViolation,
      },
    );

    const result = await client.jobs.submitExecution(7, { data: {} });

    expect(result).toEqual(legacy);
    expect(onViolation).toHaveBeenCalledTimes(1);
    expect(onViolation.mock.calls[0]?.[0]).toMatchObject({
      endpoint: "POST /api/jobs/:id/submit",
    });
  });

  it("REQ-TC-2: an HTTP error is still a CalibraApiError, never a contract error", async () => {
    const { client } = clientReplying({
      status: 404,
      body: { error: "Job nao encontrado" },
    });

    const failure = await client.jobs.get(404).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
    expect(failure).toMatchObject({
      status: 404,
      message: "Job nao encontrado",
    });
  });
});
