import { describe, expect, it } from "vitest";

import { createCloudEndpointTransport } from "../transport/endpoint-client";
import { CalibraApiError } from "../transport/errors";
import { createOrganizationLifecycleApi } from "./organization-lifecycle";

function apiReplying(response: Response) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return response;
  };
  const api = createOrganizationLifecycleApi(
    createCloudEndpointTransport({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    }),
    {},
  );
  return { api, requests };
}

describe("organizationLifecycle.softDelete", () => {
  it("REQ-RET-3: posts the confirmation and the reason to /api/organization/soft-delete", async () => {
    const { api, requests } = apiReplying(
      Response.json({ success: true, deletedAt: "2026-10-21T00:00:00.000Z" }),
    );

    const result = await api.softDelete({
      body: {
        confirmName: "Lab Exemplo",
        reason: "Encerramento das atividades",
      },
    });

    expect(requests[0]?.url).toBe(
      "https://api.example.test/api/organization/soft-delete",
    );
    expect(requests[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      confirmName: "Lab Exemplo",
      reason: "Encerramento das atividades",
    });
    expect(result).toEqual({
      success: true,
      deletedAt: "2026-10-21T00:00:00.000Z",
    });
  });

  it("REQ-RET-3: a refusal surfaces the pt-BR message and the stable code", async () => {
    const { api } = apiReplying(
      Response.json(
        {
          error: "O nome digitado não confere com o nome da organização",
          code: "organization_confirmation_mismatch",
        },
        { status: 400 },
      ),
    );

    const failure = await api
      .softDelete({
        body: { confirmName: "x", reason: "Encerramento das atividades" },
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
    expect(failure).toMatchObject({
      message: "O nome digitado não confere com o nome da organização",
      status: 400,
      code: "organization_confirmation_mismatch",
    });
  });
});
