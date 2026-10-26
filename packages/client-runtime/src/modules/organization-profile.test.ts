import { describe, expect, it, vi } from "vitest";

import { CalibraApiError } from "../transport/errors";
import { createOrganizationProfileApi } from "./organization-profile";

function rawClientReturning(response: Response) {
  const patch = vi.fn().mockResolvedValue(response);
  return {
    patch,
    raw: { api: { organization: { profile: { $patch: patch } } } },
  };
}

describe("organizationProfile.update", () => {
  it("patches the profile to /api/organization/profile and returns the stored profile", async () => {
    const { raw, patch } = rawClientReturning(
      Response.json({
        cnpj: "11.222.333/0001-81",
        accreditationActive: true,
        accreditationNumber: "0123",
      }),
    );

    const result = await createOrganizationProfileApi(raw).update({
      cnpj: "11.222.333/0001-81",
      accreditationActive: true,
      accreditationNumber: "0123",
    });

    expect(patch).toHaveBeenCalledWith({
      json: {
        cnpj: "11.222.333/0001-81",
        accreditationActive: true,
        accreditationNumber: "0123",
      },
    });
    expect(result).toMatchObject({
      accreditationActive: true,
      accreditationNumber: "0123",
    });
  });

  it("a refusal surfaces the status and the message", async () => {
    const { raw } = rawClientReturning(
      Response.json({ error: "Insufficient role privileges" }, { status: 403 }),
    );

    const failure = await createOrganizationProfileApi(raw)
      .update({ accreditationActive: true })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
  });
});
