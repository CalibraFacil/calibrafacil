import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(
  (): {
    selectRows: unknown[];
    updateRows: unknown[];
    inserted: unknown[];
    updateSet: unknown;
  } => ({
    selectRows: [],
    updateRows: [],
    inserted: [],
    updateSet: undefined,
  }),
);

vi.mock("@calibra-facil/db", () => ({ db: {} }));
vi.mock("@calibra-facil/db/for-org", () => {
  const handle = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => state.selectRows }),
      }),
    }),
    update: () => ({
      set: (values: unknown) => {
        state.updateSet = values;
        return {
          where: () => ({ returning: async () => state.updateRows }),
        };
      },
    }),
    insert: () => ({
      values: async (row: unknown) => {
        state.inserted.push(row);
      },
    }),
    transaction: async (run: (tx: unknown) => unknown) => run(handle),
  };
  return { forOrg: () => handle };
});
vi.mock("@calibra-facil/db/schema", () => ({
  organizationEmailDomain: {
    organizationId: "organization_id",
    isActive: "is_active",
    keyStatus: "key_status",
  },
  organizationEventLog: {},
}));

import {
  encryptResendApiKey,
  generateEmailDomainMasterKey,
} from "@calibra-facil/email-sender";
import {
  getLabEmailCredential,
  labEmailSenderResolver,
  markLabEmailKeyFailure,
  resolveLabEmailSender,
} from "./lab-email-sender";

const MASTER_KEY = generateEmailDomainMasterKey();

function managedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "dom-1",
    organizationId: "org-1",
    mode: "managed",
    hostname: "mail.lab.com.br",
    fromAddress: "os@mail.lab.com.br",
    verifiedAt: new Date(),
    resendApiKeyEncrypted: null,
    resendApiKeyIv: null,
    ...overrides,
  };
}

beforeEach(() => {
  state.selectRows = [];
  state.updateRows = [];
  state.inserted = [];
  state.updateSet = undefined;
  vi.stubEnv("EMAIL_TRANSPORT", "");
  vi.stubEnv("SMTP_HOST", "");
  vi.stubEnv("RESEND_API_KEY", "re_platform");
  vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", MASTER_KEY);
});

describe("resolveLabEmailSender", () => {
  it("resolves a verified managed domain without decrypting anything", async () => {
    state.selectRows = [managedRow()];
    expect(await resolveLabEmailSender("org-1")).toEqual({
      organizationId: "org-1",
      fromAddress: "os@mail.lab.com.br",
      hostname: "mail.lab.com.br",
    });
  });

  it("is undefined when the domain is not verified yet", async () => {
    state.selectRows = [managedRow({ verifiedAt: null })];
    expect(await resolveLabEmailSender("org-1")).toBeUndefined();
  });

  it("is undefined for a managed domain when the platform key is missing", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    state.selectRows = [managedRow()];
    expect(await resolveLabEmailSender("org-1")).toBeUndefined();
  });

  it("is undefined when there is no usable row", async () => {
    expect(await resolveLabEmailSender("org-1")).toBeUndefined();
  });
});

describe("getLabEmailCredential", () => {
  it("uses the platform Resend key for a managed domain", async () => {
    state.selectRows = [managedRow()];
    expect(await getLabEmailCredential("org-1")).toEqual({
      apiKey: "re_platform",
      fromAddress: "os@mail.lab.com.br",
      hostname: "mail.lab.com.br",
    });
  });

  it("decrypts the laboratory's own key for a legacy bring-your-own-key row", async () => {
    const encrypted = encryptResendApiKey("re_lab_key", MASTER_KEY);
    state.selectRows = [
      managedRow({
        mode: "byok",
        resendApiKeyEncrypted: encrypted.encrypted,
        resendApiKeyIv: encrypted.iv,
      }),
    ];
    expect(await getLabEmailCredential("org-1")).toMatchObject({
      apiKey: "re_lab_key",
    });
  });

  it("falls back to the platform sender when the master key is missing", async () => {
    vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", "");
    const encrypted = encryptResendApiKey("re_lab_key", MASTER_KEY);
    state.selectRows = [
      managedRow({
        mode: "byok",
        resendApiKeyEncrypted: encrypted.encrypted,
        resendApiKeyIv: encrypted.iv,
      }),
    ];
    expect(await getLabEmailCredential("org-1")).toBeUndefined();
  });
});

describe("markLabEmailKeyFailure", () => {
  it("flips the key status and writes the key_failed audit event on a transition", async () => {
    state.updateRows = [{ id: "dom-1" }];
    await markLabEmailKeyFailure(
      "org-1",
      "invalid_key",
      "invalid_api_key: bad",
    );

    expect(state.updateSet).toMatchObject({
      keyStatus: "invalid",
      keyLastError: "invalid_api_key: bad",
    });
    expect(state.inserted).toEqual([
      {
        organizationId: "org-1",
        action: "email_sender_domain.key_failed",
        entityType: "email_sender_domain",
        entityId: "dom-1",
        details: {
          failureClass: "invalid_key",
          keyStatus: "invalid",
          error: "invalid_api_key: bad",
        },
      },
    ]);
  });

  it("writes no audit event when the key was already in that state", async () => {
    state.updateRows = [];
    await markLabEmailKeyFailure("org-1", "quota_exhausted", "quota");
    expect(state.updateSet).toMatchObject({ keyStatus: "rate_limited" });
    expect(state.inserted).toEqual([]);
  });

  it("ignores a failure class that does not change the key", async () => {
    await markLabEmailKeyFailure("org-1", "sender_config", "x");
    expect(state.updateSet).toBeUndefined();
    expect(state.inserted).toEqual([]);
  });
});

describe("labEmailSenderResolver", () => {
  it("is the credential lookup and the failure recorder the transport is given", () => {
    expect(labEmailSenderResolver.getCredential).toBe(getLabEmailCredential);
    expect(labEmailSenderResolver.recordKeyFailure).toBe(
      markLabEmailKeyFailure,
    );
  });
});
