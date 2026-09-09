/**
 * REQ-DIGEST-SUP-001: the portal due-digest (a marketing-class email) must NOT
 * be sent to an address on the suppression ledger. Before sending a recipient's
 * digest, sendPortalDueDigests skips the recipient when isEmailSuppressed(email,
 * 'all') is true (e.g. a complaint / hard bounce). Skipped recipients are tallied
 * under `result.suppressed` and do NOT count as `sent`.
 *
 * The DB, Resend and the suppression lookup are mocked; the test asserts the REAL
 * dispatch: given two due recipients where one address is suppressed, only the
 * non-suppressed address is handed to resend.emails.send. Remove the suppression
 * gate and the suppressed recipient is also sent → resend.emails.send fires twice
 * → this test goes RED.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const SUPPRESSED_EMAIL = "blocked@empresa.com";
const ALLOWED_EMAIL = "ok@empresa.com";

const { dbMock, sendMock, isEmailSuppressedMock } = vi.hoisted(() => ({
  dbMock: { selectDistinct: vi.fn(), select: vi.fn(), insert: vi.fn() },
  sendMock: vi.fn().mockResolvedValue({ data: { id: "email_1" } }),
  isEmailSuppressedMock: vi.fn(),
}));

vi.mock("@calibra-facil/db", () => ({ db: dbMock }));
// These specs exercise the PLATFORM sender path. `resolveLabEmailSender` now
// reads the email-domain row before checking any key (it must, so a managed
// row resolves with only RESEND_API_KEY), which would otherwise consume one
// extra `db.select()` and shift the call-count routing below. Lab-sender
// resolution has its own coverage in service-order-customer-email-lab-sender.spec.ts.
vi.mock("@calibra-facil/email-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/email-sender")>()),
  resolveLabEmailSender: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html>digest</html>"),
}));
vi.mock("resend", () => ({
  Resend: vi.fn(function MockResend() {
    return { emails: { send: sendMock } };
  }),
}));
vi.mock("./suppression", () => ({
  isEmailSuppressed: isEmailSuppressedMock,
}));

import { sendPortalDueDigests } from "./service";

function makeChain(result: unknown[]): Record<string, unknown> {
  const chain: Record<string, unknown> = {};
  for (const method of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
  ]) {
    chain[method] = vi.fn(() => chain);
  }
  // oxlint-disable-next-line unicorn/no-thenable -- mocks drizzle's awaitable query builder
  chain.then = (resolve: (value: unknown[]) => unknown) => resolve(result);
  return chain;
}

// Two recipients on the SAME lab → brand + portal URL are resolved once (for the
// first recipient) and cached, so the only per-recipient DB reads are the due
// counts + the due-asset list.
const SUPPRESSED_RECIPIENT = {
  userId: "user-blocked",
  email: SUPPRESSED_EMAIL,
  name: "Cliente Bloqueado",
  frequency: "DAILY",
  customerId: 7,
  labOrganizationId: "lab-org-1",
};

const ALLOWED_RECIPIENT = {
  userId: "user-ok",
  email: ALLOWED_EMAIL,
  name: "Cliente OK",
  frequency: "DAILY",
  customerId: 8,
  labOrganizationId: "lab-org-1",
};

const ORG_ROW = {
  name: "Lab Exemplo",
  logo: null,
  cnpj: null,
  accreditationNumber: null,
  accreditationBody: null,
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
};

const DUE_COUNTS = [{ total: 1, overdue: 0 }];
const DUE_ASSETS = [
  {
    name: "Balança",
    tag: "BAL-01",
    nextCalibrationDate: new Date("2026-07-10T00:00:00Z"),
  },
];

const PREVIOUS_KEY = process.env.RESEND_API_KEY;
const PREVIOUS_FROM = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";

  // Suppressed iff the (normalized) address matches the ledgered one, exactly
  // like the real helper would resolve against the stored lowercased address.
  isEmailSuppressedMock.mockImplementation(async (email: string) =>
    email.trim().toLowerCase() === SUPPRESSED_EMAIL,
  );

  let distinctCall = 0;
  dbMock.selectDistinct.mockImplementation(() => {
    distinctCall += 1;
    // 1: customer recipients → suppressed first, allowed second. 2: groups → none.
    return makeChain(
      distinctCall === 1
        ? [SUPPRESSED_RECIPIENT, ALLOWED_RECIPIENT]
        : [],
    );
  });

  let selectCall = 0;
  dbMock.select.mockImplementation(() => {
    selectCall += 1;
    switch (selectCall) {
      case 1: // suppressed recipient → due counts
        return makeChain(DUE_COUNTS);
      case 2: // suppressed recipient → due assets
        return makeChain(DUE_ASSETS);
      case 3: // getLabEmailBrand (cached afterwards for the shared lab)
        return makeChain([ORG_ROW]);
      case 4: // getPortalDigestBaseUrl → no custom domain (fallback)
        return makeChain([]);
      case 5: // allowed recipient → due counts
        return makeChain(DUE_COUNTS);
      case 6: // allowed recipient → due assets
        return makeChain(DUE_ASSETS);
      default:
        return makeChain([]);
    }
  });
});

afterEach(() => {
  if (PREVIOUS_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = PREVIOUS_KEY;
  if (PREVIOUS_FROM === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = PREVIOUS_FROM;
});

describe("REQ-DIGEST-SUP-001: portal digest honours the suppression ledger", () => {
  it("REQ-DIGEST-SUP-001 skips a suppressed recipient and sends only to the clean address", async () => {
    const result = await sendPortalDueDigests(
      new Date("2026-06-25T12:00:00Z"),
    );

    // Both recipients were due, but the suppressed one is gated out.
    expect(sendMock).toHaveBeenCalledTimes(1);
    const sendArgs = sendMock.mock.calls[0]?.[0];
    expect(sendArgs?.to).toBe(ALLOWED_EMAIL);

    // The suppressed address was consulted against the 'all' scope.
    expect(isEmailSuppressedMock).toHaveBeenCalledWith(SUPPRESSED_EMAIL, "all");

    // Tally: one sent, one suppressed; the suppressed one is NOT counted as sent.
    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(1);
  });
});
