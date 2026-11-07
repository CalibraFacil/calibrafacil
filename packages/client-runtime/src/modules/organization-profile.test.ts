import { describe, expect, it } from "vitest";

import { createCloudEndpointTransport } from "../transport/endpoint-client";
import { CalibraApiError } from "../transport/errors";
import { createOrganizationProfileApi } from "./organization-profile";

const storedProfile = {
  cnpj: "11.222.333/0001-81",
  accreditationNumber: "0123",
  accreditationBody: null,
  accreditationActive: true,
  accreditationValidFrom: null,
  accreditationValidUntil: null,
  permissionariaAuthorizationNumber: null,
  permissionariaAuthorizationState: null,
  street: null,
  number: null,
  complement: null,
  neighbourhood: null,
  city: null,
  state: null,
  cep: null,
  phone: null,
  email: null,
  website: null,
  technicalManagerName: null,
  technicalManagerTitle: null,
};

function apiReplying(response: Response) {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return response;
  };
  const api = createOrganizationProfileApi(
    createCloudEndpointTransport({
      baseUrl: "https://api.example.test",
      fetch: fetchImpl,
    }),
    {},
  );
  return { api, requests };
}

describe("organizationProfile.update", () => {
  it("patches the profile to /api/organization/profile and returns the stored profile", async () => {
    const { api, requests } = apiReplying(Response.json(storedProfile));

    const result = await api.update({
      body: {
        cnpj: "11.222.333/0001-81",
        accreditationActive: true,
        accreditationNumber: "0123",
      },
    });

    expect(requests[0]?.url).toBe(
      "https://api.example.test/api/organization/profile",
    );
    expect(requests[0]?.init?.method).toBe("PATCH");
    expect(JSON.parse(String(requests[0]?.init?.body))).toEqual({
      cnpj: "11.222.333/0001-81",
      accreditationActive: true,
      accreditationNumber: "0123",
    });
    expect(result).toMatchObject({
      accreditationActive: true,
      accreditationNumber: "0123",
    });
  });

  it("a refusal surfaces the status and the message", async () => {
    const { api } = apiReplying(
      Response.json({ error: "Insufficient role privileges" }, { status: 403 }),
    );

    const failure = await api
      .update({ body: { accreditationActive: true } })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
    expect(failure).toMatchObject({
      message: "Insufficient role privileges",
      status: 403,
    });
  });
});
