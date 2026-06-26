/**
 * REQ-HARD-001 — the per-contact `propertiesSkipped` flag is propagated to the
 * run result as a `propertiesSkipped` counter (and a properties-422 contact is
 * still counted as synced, never failed).
 */
import { describe, it, expect, vi } from "vitest";
import {
  syncLabUsersToResendAudience,
  type RawAudienceMemberRow,
  type ResendAudienceSyncEnv,
} from "./resend-audience-sync";

function fullEnv(): ResendAudienceSyncEnv {
  return {
    RESEND_API_KEY: "re_test",
    RESEND_AUDIENCE_ID: "aud_marketing",
    RESEND_TOPIC_NOVIDADES_ID: "topic-novidades",
    RESEND_TOPIC_DICAS_ID: "topic-dicas",
    MARKETING_CONTACT_SYNC_ENABLED: "true",
  };
}

function labRow(
  overrides: Partial<RawAudienceMemberRow> = {},
): RawAudienceMemberRow {
  return {
    email: "tech@lab.test",
    name: "Tech User",
    role: "technician",
    organizationId: "org-lab",
    organizationName: "Lab A",
    organizationType: "LAB",
    banned: false,
    ...overrides,
  };
}

const PROPERTY_422_BODY = JSON.stringify({
  statusCode: 422,
  message: "One or more properties do not exist",
  name: "validation_error",
});

describe("REQ-HARD-001: propertiesSkipped counter on the run result", () => {
  it("REQ-HARD-001 a properties-422 contact is synced (not failed) and bumps propertiesSkipped", async () => {
    // PATCH 200 (update) for the clean contact; PATCH 422(properties) then a
    // 200 retry for the property-rejecting contact.
    const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      const body = JSON.parse(String(init?.body));
      if (url.includes(encodeURIComponent("prop@lab.test"))) {
        // First attempt carries `properties`; the property-stripped retry omits it.
        if ("properties" in body) {
          return new Response(PROPERTY_422_BODY, { status: 422 });
        }
        return new Response("{}", { status: 200 });
      }
      return new Response("{}", { status: 200 });
    });

    const result = await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [
        labRow({ email: "clean@lab.test" }),
        labRow({ email: "prop@lab.test" }),
      ],
      isSuppressed: async () => false,
      fetchImpl,
    });

    expect(result.failed).toBe(0);
    expect(result.updated).toBe(2);
    expect(result.propertiesSkipped).toBe(1);
    expect(result.total).toBe(2);
  });
});
