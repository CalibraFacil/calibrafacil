/**
 * REQ-SYNC-001/002/003/005/006/007 — lab-member → Resend audience sync.
 *
 * The selection (which members), the soft opt-in, suppression-awareness, the
 * derived properties, the safety gate, and the continue-past-error loop are all
 * exercised against a fully mocked `fetch` and injected member/suppression
 * sources, so each requirement has a behavioural guard that goes RED if the
 * rule is dropped (see the per-test comments).
 */
import { describe, it, expect, vi } from "vitest";
import {
  syncLabUsersToResendAudience,
  type RawAudienceMemberRow,
  type ResendAudienceSyncEnv,
} from "./resend-audience-sync";

const NOVIDADES_ID = "topic-novidades-0062";
const DICAS_ID = "topic-dicas-41674";
// The promotional "Ofertas" topic id — intentionally NOT in the env, so the
// sync can never opt anyone into it.
const OFERTAS_ID = "topic-ofertas-24dc";

function fullEnv(
  overrides: Partial<ResendAudienceSyncEnv> = {},
): ResendAudienceSyncEnv {
  return {
    RESEND_API_KEY: "re_test",
    RESEND_AUDIENCE_ID: "aud_marketing",
    RESEND_TOPIC_NOVIDADES_ID: NOVIDADES_ID,
    RESEND_TOPIC_DICAS_ID: DICAS_ID,
    MARKETING_CONTACT_SYNC_ENABLED: "true",
    ...overrides,
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

function okFetch() {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("{}", { status: 200 }));
}

/** Parse the JSON bodies of every PATCH/POST the sync sent. */
function sentBodies(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body));
}

function sentEmails(fetchImpl: ReturnType<typeof vi.fn>) {
  return sentBodies(fetchImpl).map((body) => body.email);
}

describe("REQ-SYNC-001: only lab-org INTERNAL_ROLE members are synced", () => {
  it("REQ-SYNC-001 syncs the two lab users; never client_user or non-LAB orgs", async () => {
    const fetchImpl = okFetch();
    const rows: RawAudienceMemberRow[] = [
      labRow({ email: "admin@lab.test", role: "admin" }),
      labRow({ email: "op@lab.test", role: "operator" }),
      // portal client → excluded by role
      labRow({
        email: "client@portal.test",
        role: "client_user",
        organizationType: "CLIENT",
      }),
      // member of a non-LAB org → excluded by org type
      labRow({
        email: "member@other.test",
        role: "member",
        organizationType: "CLIENT",
      }),
    ];

    const result = await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => rows,
      isSuppressed: async () => false,
      fetchImpl,
    });

    const emails = sentEmails(fetchImpl);
    expect(emails).toHaveLength(2);
    expect(emails).toContain("admin@lab.test");
    expect(emails).toContain("op@lab.test");
    // The portal client and the non-LAB org member are never synced.
    expect(emails).not.toContain("client@portal.test");
    expect(emails).not.toContain("member@other.test");
    expect(result.total).toBe(2);
  });

  it("REQ-SYNC-001 dedupes a user that belongs to multiple lab orgs into one contact", async () => {
    const fetchImpl = okFetch();
    const rows: RawAudienceMemberRow[] = [
      labRow({ email: "dup@lab.test", role: "admin", organizationId: "lab-1" }),
      labRow({
        email: "dup@lab.test",
        role: "technician",
        organizationId: "lab-2",
      }),
    ];

    await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => rows,
      isSuppressed: async () => false,
      fetchImpl,
    });

    expect(sentEmails(fetchImpl)).toEqual(["dup@lab.test"]);
  });

  it("REQ-SYNC-001 excludes a client_user even inside a LAB org (role filter is independent)", async () => {
    // Anomalous row: a portal client_user that is somehow a member of a LAB org.
    // The org-type filter passes here, so ONLY the role filter can exclude it —
    // this makes the role filter independently RED-able (drop it and the
    // client_user leaks into the marketing audience).
    const fetchImpl = okFetch();
    const rows: RawAudienceMemberRow[] = [
      labRow({ email: "admin@lab.test", role: "admin" }),
      labRow({
        email: "client@lab.test",
        role: "client_user",
        organizationType: "LAB",
      }),
    ];

    await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => rows,
      isSuppressed: async () => false,
      fetchImpl,
    });

    expect(sentEmails(fetchImpl)).toEqual(["admin@lab.test"]);
  });

  it("REQ-SYNC-001 skips a lab member with an empty email", async () => {
    const fetchImpl = okFetch();
    const rows: RawAudienceMemberRow[] = [
      labRow({ email: "real@lab.test", role: "admin" }),
      labRow({ email: "", role: "operator" }),
    ];

    const result = await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => rows,
      isSuppressed: async () => false,
      fetchImpl,
    });

    // The empty-email row is never upserted (no Resend contact without an address).
    expect(sentEmails(fetchImpl)).toEqual(["real@lab.test"]);
    expect(result.total).toBe(1);
  });
});

describe("REQ-SYNC-002: soft opt-in to Novidades + Dicas only", () => {
  it("REQ-SYNC-002 opts a clean lab user into the two opt_in topics, never Ofertas", async () => {
    const fetchImpl = okFetch();

    await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [labRow()],
      isSuppressed: async () => false,
      fetchImpl,
    });

    const [body] = sentBodies(fetchImpl);
    expect(body.topics).toEqual([
      { id: NOVIDADES_ID, subscription: "opt_in" },
      { id: DICAS_ID, subscription: "opt_in" },
    ]);
    const topicIds = body.topics.map((t: { id: string }) => t.id);
    expect(topicIds).not.toContain(OFERTAS_ID);
  });
});

describe("REQ-SYNC-003: suppression-aware", () => {
  it("REQ-SYNC-003 a suppressed lab user is unsubscribed with NO opt_in topics", async () => {
    const fetchImpl = okFetch();

    const result = await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [labRow({ email: "stop@lab.test" })],
      isSuppressed: async (email) => email === "stop@lab.test",
      fetchImpl,
    });

    const [body] = sentBodies(fetchImpl);
    expect(body.unsubscribed).toBe(true);
    expect(body.topics).toBeUndefined();
    expect(result.suppressed).toBe(1);
  });

  it("REQ-SYNC-003 a banned lab user is unsubscribed with NO opt_in topics", async () => {
    const fetchImpl = okFetch();

    await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [
        labRow({ email: "ban@lab.test", banned: true }),
      ],
      isSuppressed: async () => false,
      fetchImpl,
    });

    const [body] = sentBodies(fetchImpl);
    expect(body.unsubscribed).toBe(true);
    expect(body.topics).toBeUndefined();
  });

  it("REQ-SYNC-003 a clean lab user is subscribed with opt_in topics", async () => {
    const fetchImpl = okFetch();

    await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [labRow({ email: "ok@lab.test" })],
      isSuppressed: async () => false,
      fetchImpl,
    });

    const [body] = sentBodies(fetchImpl);
    expect(body.unsubscribed).toBe(false);
    expect(body.topics).toHaveLength(2);
  });
});

describe("REQ-SYNC-005: schema-derivable properties only", () => {
  it("REQ-SYNC-005 sets account_type, role, lab_id, lab_name", async () => {
    const fetchImpl = okFetch();

    await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [
        labRow({
          email: "p@lab.test",
          role: "owner",
          organizationId: "org-xyz",
          organizationName: "Laboratório XYZ",
        }),
      ],
      isSuppressed: async () => false,
      fetchImpl,
    });

    const [body] = sentBodies(fetchImpl);
    expect(body.properties).toEqual({
      account_type: "lab",
      role: "owner",
      lab_id: "org-xyz",
      lab_name: "Laboratório XYZ",
    });
    // No invented plan/lifecycle fields.
    expect(body.properties.plan).toBeUndefined();
    expect(body.properties.lifecycle).toBeUndefined();
  });
});

describe("REQ-SYNC-006: safety gate (default OFF)", () => {
  it("REQ-SYNC-006 flag unset → zero Resend calls and members never loaded", async () => {
    const fetchImpl = okFetch();
    const loadMembers = vi.fn(async () => [labRow()]);

    const result = await syncLabUsersToResendAudience(
      fullEnv({ MARKETING_CONTACT_SYNC_ENABLED: undefined }),
      { loadMembers, isSuppressed: async () => false, fetchImpl },
    );

    expect(result.enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(loadMembers).not.toHaveBeenCalled();
  });

  it("REQ-SYNC-006 flag set to a non-'true' value → zero Resend calls", async () => {
    const fetchImpl = okFetch();

    await syncLabUsersToResendAudience(
      fullEnv({ MARKETING_CONTACT_SYNC_ENABLED: "1" }),
      {
        loadMembers: async () => [labRow()],
        isSuppressed: async () => false,
        fetchImpl,
      },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REQ-SYNC-006 missing audience id → no-op, zero Resend calls", async () => {
    const fetchImpl = okFetch();

    const result = await syncLabUsersToResendAudience(
      fullEnv({ RESEND_AUDIENCE_ID: undefined }),
      {
        loadMembers: async () => [labRow()],
        isSuppressed: async () => false,
        fetchImpl,
      },
    );

    expect(result.enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REQ-SYNC-006 missing a topic id → no-op, zero Resend calls", async () => {
    const fetchImpl = okFetch();

    const result = await syncLabUsersToResendAudience(
      fullEnv({ RESEND_TOPIC_DICAS_ID: undefined }),
      {
        loadMembers: async () => [labRow()],
        isSuppressed: async () => false,
        fetchImpl,
      },
    );

    expect(result.enabled).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("REQ-SYNC-006 missing api key → no-op, zero Resend calls", async () => {
    const fetchImpl = okFetch();

    await syncLabUsersToResendAudience(fullEnv({ RESEND_API_KEY: undefined }), {
      loadMembers: async () => [labRow()],
      isSuppressed: async () => false,
      fetchImpl,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("REQ-SYNC-007: continue past a single contact's HTTP error", () => {
  it("REQ-SYNC-007 counts one failure and still upserts the rest", async () => {
    // PATCH 500 only for the middle contact's email; 200 for the others.
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes(encodeURIComponent("boom@lab.test"))) {
        return new Response("{}", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    });

    const result = await syncLabUsersToResendAudience(fullEnv(), {
      loadMembers: async () => [
        labRow({ email: "a@lab.test" }),
        labRow({ email: "boom@lab.test" }),
        labRow({ email: "c@lab.test" }),
      ],
      isSuppressed: async () => false,
      fetchImpl,
    });

    expect(result.failed).toBe(1);
    expect(result.updated).toBe(2);
    expect(result.total).toBe(3);
  });
});
