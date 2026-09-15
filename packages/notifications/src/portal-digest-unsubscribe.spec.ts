/**
 * REQ-DIGEST-001: the portal due-digest (a marketing-class email) must carry a
 * List-Unsubscribe header pointing at the portal notification-settings page, so
 * mail clients expose a native unsubscribe affordance.
 *
 * The DB + Resend are mocked; the test asserts the REAL header passed to
 * resend.emails.send (drop the header and this goes RED).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { dbMock, sendMock } = vi.hoisted(() => ({
  dbMock: { selectDistinct: vi.fn(), select: vi.fn(), insert: vi.fn() },
  sendMock: vi.fn().mockResolvedValue({ data: { id: "email_1" } }),
}));

vi.mock("@calibra-facil/db", () => ({ db: dbMock }));
vi.mock("@react-email/render", () => ({
  render: vi.fn().mockResolvedValue("<html>digest</html>"),
}));
vi.mock("resend", () => ({
  Resend: vi.fn(function MockResend() {
    return { emails: { send: sendMock } };
  }),
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

const RECIPIENT = {
  userId: "user-1",
  email: "client@empresa.com",
  name: "Cliente",
  frequency: "DAILY",
  customerId: 7,
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

const PREVIOUS_KEY = process.env.RESEND_API_KEY;
const PREVIOUS_FROM = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";

  let distinctCall = 0;
  dbMock.selectDistinct.mockImplementation(() => {
    distinctCall += 1;
    // 1: customer recipients → one due recipient. 2: group recipients → none.
    return makeChain(distinctCall === 1 ? [RECIPIENT] : []);
  });

  let selectCall = 0;
  dbMock.select.mockImplementation(() => {
    selectCall += 1;
    switch (selectCall) {
      case 1: // due counts
        return makeChain([{ total: 2, overdue: 1 }]);
      case 2: // due assets
        return makeChain([
          {
            name: "Balança",
            tag: "BAL-01",
            nextCalibrationDate: new Date("2026-07-01T00:00:00Z"),
          },
        ]);
      case 3: // getLabEmailBrand → organization row
        return makeChain([ORG_ROW]);
      default: // getPortalDigestBaseUrl → no custom domain (fallback)
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

describe("REQ-DIGEST-001: portal digest List-Unsubscribe header", () => {
  it("REQ-DIGEST-001 sends the digest with a List-Unsubscribe to the portal settings page", async () => {
    const result = await sendPortalDueDigests(new Date("2026-06-25T12:00:00Z"));

    expect(result.sent).toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);

    const sendArgs = sendMock.mock.calls[0]?.[0];
    expect(sendArgs).toBeDefined();
    const listUnsubscribe = sendArgs?.headers?.["List-Unsubscribe"];
    expect(typeof listUnsubscribe).toBe("string");
    // RFC 2369: a <URL> pointing at the portal notification-settings page.
    expect(listUnsubscribe).toMatch(
      /^<https?:\/\/.+\/settings\/notifications>$/,
    );
  });
});
