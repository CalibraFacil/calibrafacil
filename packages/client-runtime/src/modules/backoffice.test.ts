import { describe, expect, it, vi } from "vitest";

import { createBackofficeApi } from "./backoffice";

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("backoffice.commercial.cancelOffer (REQ-DOM-DC-UI-003)", () => {
  it("types and forwards approvalRequestId in the JSON body", async () => {
    const cancelPost = vi
      .fn()
      .mockResolvedValue(jsonResponse({ offer: { id: "off_1" } }));

    const rawCloudClient = {
      api: {
        backoffice: {
          commercial: {
            offers: {
              ":offerId": { cancel: { $post: cancelPost } },
            },
          },
        },
      },
    };

    const api = createBackofficeApi(rawCloudClient);

    await api.commercial.cancelOffer("off_1", {
      reason: "Estorno aprovado no controle duplo",
      approvalRequestId: 42,
    });

    expect(cancelPost).toHaveBeenCalledWith({
      param: { offerId: "off_1" },
      json: {
        reason: "Estorno aprovado no controle duplo",
        approvalRequestId: 42,
      },
    });
  });
});
