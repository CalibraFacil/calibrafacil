import { describe, expect, it, vi } from "vitest";

import { CalibraApiError } from "../transport/errors";
import { createOrganizationLifecycleApi } from "./organization-lifecycle";

function rawClientReturning(response: Response) {
  const post = vi.fn().mockResolvedValue(response);
  return {
    post,
    raw: { api: { organization: { "soft-delete": { $post: post } } } },
  };
}

describe("organizationLifecycle.softDelete", () => {
  it("REQ-RET-3: posts the confirmation and the reason to /api/organization/soft-delete", async () => {
    const { raw, post } = rawClientReturning(
      Response.json({ success: true, deletedAt: "2026-10-21T00:00:00.000Z" }),
    );

    const result = await createOrganizationLifecycleApi(raw).softDelete({
      confirmName: "Lab Exemplo",
      reason: "Encerramento das atividades",
    });

    expect(post).toHaveBeenCalledWith({
      json: {
        confirmName: "Lab Exemplo",
        reason: "Encerramento das atividades",
      },
    });
    expect(result).toEqual({
      success: true,
      deletedAt: "2026-10-21T00:00:00.000Z",
    });
  });

  it("REQ-RET-3: a refusal surfaces the pt-BR message and the stable code", async () => {
    const { raw } = rawClientReturning(
      Response.json(
        {
          error: "O nome digitado não confere com o nome da organização",
          code: "organization_confirmation_mismatch",
        },
        { status: 400 },
      ),
    );

    const failure = await createOrganizationLifecycleApi(raw)
      .softDelete({ confirmName: "x", reason: "Encerramento das atividades" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(CalibraApiError);
    expect(failure).toMatchObject({
      message: "O nome digitado não confere com o nome da organização",
      status: 400,
      code: "organization_confirmation_mismatch",
    });
  });
});
