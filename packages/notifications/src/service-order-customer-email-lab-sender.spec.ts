/**
 * #584 P2: white-label envelope for service-order customer emails.
 *
 * Exercises sendServiceOrderCustomerEmail through the REAL
 * @calibra-facil/email-sender chain (credential resolution + decryption +
 * fallback) with only the DB and the Resend transport mocked:
 *
 *  - brand.sender present → the email leaves through the LAB's Resend key,
 *    From is first-party ("Lab <os@mail.lab.com.br>", no "via CalibraFácil"),
 *    and the template renders with the sender attached.
 *  - lab key revoked → the SAME call re-renders with the sender STRIPPED
 *    (HTML matches the platform envelope) and resends via the platform key,
 *    flipping key_status.
 *  - transient lab failure → reported as a send failure (retry-later), with
 *    NO platform attempt.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmailBrand } from "@calibra-facil/email";

const { dbState, resendCtorMock, resendSendMock } = vi.hoisted(() => ({
  dbState: {
    selectResults: Array.of<unknown[]>(),
    updates: Array.of<unknown>(),
    inserts: Array.of<unknown>(),
  },
  resendCtorMock: vi.fn(),
  resendSendMock: vi.fn(),
}));

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of ["from", "where", "limit", "set", "values"]) {
    chain[method] = vi.fn(() => chain);
  }
  // oxlint-disable-next-line unicorn/no-thenable -- mocks drizzle's awaitable query builder
  chain.then = (resolve: (value: unknown[]) => unknown) => resolve(result);
  chain.returning = vi.fn(() => Promise.resolve(result));
  return chain;
}

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: vi.fn(() => makeChain(dbState.selectResults.shift() ?? [])),
    update: vi.fn((table: unknown) => {
      dbState.updates.push(table);
      return makeChain([{ id: "emaildom-1" }]);
    }),
    insert: vi.fn((table: unknown) => {
      dbState.inserts.push(table);
      return makeChain([]);
    }),
  },
}));

vi.mock("@calibra-facil/db/schema", () => ({
  organizationEmailDomain: {
    organizationId: "organization_id",
    isActive: "is_active",
    keyStatus: "key_status",
    id: "id",
  },
  organizationEventLog: {},
  subscription: { organizationId: "organization_id", planId: "plan_id" },
}));

vi.mock("resend", () => {
  function MockResend(apiKey: string) {
    resendCtorMock(apiKey);
    return { emails: { send: resendSendMock } };
  }
  return { Resend: vi.fn(MockResend) };
});

vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html>rendered</html>"),
}));

import {
  sendServiceOrderCustomerEmail,
  type ServiceOrderEmailRenderContext,
} from "./service-order-customer-email";
import {
  encryptResendApiKey,
  generateEmailDomainMasterKey,
} from "@calibra-facil/email-sender";

const MASTER_KEY = generateEmailDomainMasterKey();
const LAB_KEY = "re_lab_key_xyz1";

function labDomainRow() {
  const encrypted = encryptResendApiKey(LAB_KEY, MASTER_KEY);
  return {
    id: "emaildom-1",
    organizationId: "org-1",
    mode: "byok",
    hostname: "mail.lab-a.com.br",
    resendDomainId: "rd-1",
    resendApiKeyEncrypted: encrypted.encrypted,
    resendApiKeyIv: encrypted.iv,
    resendApiKeyLast4: LAB_KEY.slice(-4),
    fromAddress: "os@mail.lab-a.com.br",
    status: "verified",
    verifiedAt: new Date(),
    isActive: true,
    keyStatus: "ok",
  };
}

function brandWithSender(): EmailBrand {
  return {
    name: "Lab A Calibrações",
    isWhiteLabel: true,
    supportEmail: "contato@lab-a.com.br",
    sender: { organizationId: "org-1", fromAddress: "os@mail.lab-a.com.br" },
  };
}

function makeInput(brand: EmailBrand | undefined) {
  const renderEmail = vi.fn(
    (ctx: ServiceOrderEmailRenderContext): React.ReactNode =>
      `mocked-element-${ctx.brand?.sender ? "lab" : "platform"}`,
  );
  return {
    input: {
      serviceOrder: {
        id: 1,
        publicId: "pub-1",
        organizationId: "org-1",
        customerId: 1,
        serviceOrderNumber: "OS-001",
        clientContactSnapshot: { email: "cliente@empresa.com.br" },
      },
      customer: { id: 1, name: "Cliente", email: null },
      brand,
      subject: "OS-001 atualização",
      renderEmail,
    },
    renderEmail,
  };
}

beforeEach(() => {
  dbState.selectResults.length = 0;
  dbState.updates.length = 0;
  dbState.inserts.length = 0;
  resendCtorMock.mockReset();
  resendSendMock.mockReset();
  vi.stubEnv("EMAIL_DOMAIN_MASTER_KEY", MASTER_KEY);
  vi.stubEnv("RESEND_API_KEY", "re_platform_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "Calibra Fácil <noreply@calibrafacil.com>");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Queue the two selects getLabEmailCredential performs: domain row, plan. */
function queueUsableLabSender() {
  dbState.selectResults.push([labDomainRow()], [{ planId: "STANDARD" }]);
}

describe("#584 service-order email white-label envelope", () => {
  it("sends through the lab's own Resend account with a first-party From", async () => {
    queueUsableLabSender();
    resendSendMock.mockResolvedValue({ data: { id: "e1" }, error: null });
    const { input, renderEmail } = makeInput(brandWithSender());

    const result = await sendServiceOrderCustomerEmail(input);

    expect(result.sent).toBe(true);
    expect(resendCtorMock).toHaveBeenCalledWith(LAB_KEY);
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.from).toBe("Lab A Calibrações <os@mail.lab-a.com.br>");
    expect(payload.from).not.toContain("via CalibraFácil");
    expect(payload.to).toBe("cliente@empresa.com.br");
    // The variant render kept the sender attached (first-party layout).
    const variantCtx = renderEmail.mock.calls.at(-1)?.[0];
    expect(variantCtx?.brand?.sender).toBeDefined();
  });

  it("falls back to the platform sender on a revoked lab key, re-rendering without the sender", async () => {
    queueUsableLabSender();
    resendSendMock
      .mockResolvedValueOnce({
        data: null,
        error: { name: "invalid_api_key", message: "API key is invalid" },
      })
      .mockResolvedValueOnce({ data: { id: "e2" }, error: null });
    const { input, renderEmail } = makeInput(brandWithSender());

    const result = await sendServiceOrderCustomerEmail(input);

    expect(result.sent).toBe(true);
    expect(resendCtorMock).toHaveBeenNthCalledWith(1, LAB_KEY);
    expect(resendCtorMock).toHaveBeenNthCalledWith(2, "re_platform_key");

    // Platform variant: shared envelope with the "via CalibraFácil" From and
    // a brand re-rendered WITHOUT the sender (HTML matches the envelope).
    const platformPayload = resendSendMock.mock.calls[1]?.[0];
    expect(platformPayload.from).toBe(
      "Lab A Calibrações via CalibraFácil <noreply@calibrafacil.com>",
    );
    const fallbackCtx = renderEmail.mock.calls.at(-1)?.[0];
    expect(fallbackCtx?.brand?.sender).toBeUndefined();

    // key_status flip persisted (update) + audit row (insert).
    expect(dbState.updates.length).toBeGreaterThan(0);
    expect(dbState.inserts.length).toBeGreaterThan(0);
  });

  it("reports a transient lab failure as retryable without a platform attempt", async () => {
    queueUsableLabSender();
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "internal_server_error", message: "boom" },
    });
    const { input } = makeInput(brandWithSender());

    const result = await sendServiceOrderCustomerEmail(input);

    expect(result.sent).toBe(false);
    expect(resendSendMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the platform envelope untouched when the brand has no sender", async () => {
    resendSendMock.mockResolvedValue({ data: { id: "e3" }, error: null });
    const brand = brandWithSender();
    brand.sender = undefined;
    const { input } = makeInput(brand);

    const result = await sendServiceOrderCustomerEmail(input);

    expect(result.sent).toBe(true);
    expect(resendCtorMock).toHaveBeenCalledTimes(1);
    expect(resendCtorMock).toHaveBeenCalledWith("re_platform_key");
    const payload = resendSendMock.mock.calls[0]?.[0];
    expect(payload.from).toBe(
      "Lab A Calibrações via CalibraFácil <noreply@calibrafacil.com>",
    );
  });
});
