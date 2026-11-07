/**
 * The portal due-digest (a marketing-class email), driven through the real
 * `sendPortalDueDigests` with the database and Resend replaced by doubles.
 *
 * REQ-DIGEST-001: the email carries a List-Unsubscribe header pointing at the
 * portal notification-settings page, so mail clients expose a native
 * unsubscribe affordance.
 *
 * REQ-DIGEST-SUP-001: the digest must NOT be sent to an address on the
 * suppression ledger (e.g. a complaint / hard bounce). The recipient is skipped,
 * tallied under `result.suppressed` and not counted as `sent`.
 *
 * The database double answers a query by what it selects (the columns asked
 * for), never by the order the queries are issued: reordering or merging
 * queries in the digest does not break these specs, and a query asking for
 * something the double does not know answers nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SUPPRESSED_EMAIL = "blocked@empresa.com";
const ALLOWED_EMAIL = "ok@empresa.com";

const { dbMock, sendMock, isEmailSuppressedMock } = vi.hoisted(() => {
  const fake = {
    selectDistinct: (_fields?: Record<string, unknown>): unknown => undefined,
    select: (_fields?: Record<string, unknown>): unknown => undefined,
    execute: async () => [],
    // `inOrg(...)` (lab-scope.ts) runs its callback in `db.transaction(...)`:
    // the double runs it on itself.
    transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  return {
    dbMock: fake,
    sendMock: vi.fn(),
    isEmailSuppressedMock: vi.fn(),
  };
});

vi.mock("@calibra-facil/db", () => ({ db: dbMock, systemDb: dbMock }));
// These specs exercise the PLATFORM sender path. Lab-sender resolution has its
// own coverage in service-order-customer-email-lab-sender.spec.ts.
vi.mock("@calibra-facil/lab-email-domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/lab-email-domain")>()),
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

/** A query builder every method of which returns itself and which can be awaited. */
function queryResolvingTo(rows: unknown[]): Record<string, unknown> {
  const query: Record<string, unknown> = {};
  for (const method of [
    "from",
    "innerJoin",
    "leftJoin",
    "where",
    "orderBy",
    "limit",
  ]) {
    query[method] = () => query;
  }
  // oxlint-disable-next-line unicorn/no-thenable -- mocks drizzle's awaitable query builder
  query.then = (resolve: (value: unknown[]) => unknown) => resolve(rows);
  return query;
}

type Recipient = {
  userId: string;
  email: string;
  name: string;
  frequency: string;
  customerId: number;
  labOrganizationId: string;
};

const SUPPRESSED_RECIPIENT: Recipient = {
  userId: "user-blocked",
  email: SUPPRESSED_EMAIL,
  name: "Cliente Bloqueado",
  frequency: "DAILY",
  customerId: 7,
  labOrganizationId: "lab-org-1",
};

const ALLOWED_RECIPIENT: Recipient = {
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

/** Point the database double at a set of due recipients (each with one due asset). */
function givenDueRecipients(recipients: Recipient[]) {
  dbMock.selectDistinct = (fields) => {
    const columns = Object.keys(fields ?? {});
    // customer recipients carry a customerId; group recipients a groupId (none here)
    return queryResolvingTo(columns.includes("customerId") ? recipients : []);
  };
  dbMock.select = (fields) => {
    const columns = Object.keys(fields ?? {});
    if (columns.includes("total")) {
      return queryResolvingTo([{ total: 2, overdue: 1 }]);
    }
    if (columns.includes("nextCalibrationDate")) {
      return queryResolvingTo([
        {
          name: "Balança",
          tag: "BAL-01",
          nextCalibrationDate: new Date("2026-07-01T00:00:00Z"),
        },
      ]);
    }
    if (columns.includes("cnpj")) return queryResolvingTo([ORG_ROW]);
    // the lab's custom portal domain: none, so the default host is used
    return queryResolvingTo([]);
  };
}

const PREVIOUS_KEY = process.env.RESEND_API_KEY;
const PREVIOUS_FROM = process.env.RESEND_FROM_EMAIL;

beforeEach(() => {
  vi.clearAllMocks();
  sendMock.mockResolvedValue({ data: { id: "email_1" } });
  process.env.RESEND_API_KEY = "re_test_key";
  process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";

  // Suppressed iff the (normalized) address matches the ledgered one, exactly
  // like the real helper would resolve against the stored lowercased address.
  isEmailSuppressedMock.mockImplementation(
    async (email: string) => email.trim().toLowerCase() === SUPPRESSED_EMAIL,
  );
});

afterEach(() => {
  if (PREVIOUS_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = PREVIOUS_KEY;
  if (PREVIOUS_FROM === undefined) delete process.env.RESEND_FROM_EMAIL;
  else process.env.RESEND_FROM_EMAIL = PREVIOUS_FROM;
});

describe("REQ-DIGEST-001: portal digest List-Unsubscribe header", () => {
  it("REQ-DIGEST-001 sends the digest with a List-Unsubscribe to the portal settings page", async () => {
    givenDueRecipients([ALLOWED_RECIPIENT]);

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

describe("REQ-DIGEST-SUP-001: portal digest honours the suppression ledger", () => {
  it("REQ-DIGEST-SUP-001 skips a suppressed recipient and sends only to the clean address", async () => {
    givenDueRecipients([SUPPRESSED_RECIPIENT, ALLOWED_RECIPIENT]);

    const result = await sendPortalDueDigests(new Date("2026-06-25T12:00:00Z"));

    // Both recipients were due, but the suppressed one is gated out.
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0]?.[0]?.to).toBe(ALLOWED_EMAIL);

    // The suppressed address was consulted against the 'all' scope.
    expect(isEmailSuppressedMock).toHaveBeenCalledWith(SUPPRESSED_EMAIL, "all");

    // Tally: one sent, one suppressed; the suppressed one is NOT counted as sent.
    expect(result.sent).toBe(1);
    expect(result.suppressed).toBe(1);
  });
});
