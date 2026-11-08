/**
 * REQ-VISITEMAIL-004: notifications service renders VisitNotificationEmail
 *   (not the generic fallback) for visit notification types carrying
 *   a type:"visit" emailContext.
 * REQ-VISITEMAIL-005: the four customer-facing notify functions pass a
 *   type:"visit" emailContext.
 *
 * Strategy: mock the DB and Resend so no real infrastructure is needed.
 * Spy on VisitNotificationEmail to confirm it is invoked (not the generic
 * NotificationEmail fallback) when emailContext.type === "visit".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoist shared mocks
// ---------------------------------------------------------------------------

const { visitEmailSpy, renderMock } = vi.hoisted(() => ({
  visitEmailSpy: vi.fn().mockReturnValue({ type: "visit-stub" }),
  renderMock: vi.fn().mockResolvedValue("<html>mocked visit email</html>"),
}));

vi.mock("@react-email/render", () => ({
  render: renderMock,
}));

vi.mock("@calibra-facil/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@calibra-facil/email")>();
  return { ...real, VisitNotificationEmail: visitEmailSpy };
});

vi.mock("resend", () => {
  const sendMock = vi.fn().mockResolvedValue({ data: { id: "email_id_1" } });
  function MockResend(_key: string) {
    return { emails: { send: sendMock } };
  }
  return { Resend: vi.fn(MockResend) };
});

// ---------------------------------------------------------------------------
// Schema stubs — only the field names the service uses via destructuring
// ---------------------------------------------------------------------------
vi.mock("@calibra-facil/db/schema", () => ({
  notification: { id: "id" },
  notificationPreference: { userId: "userId" },
  member: {},
  user: { id: "id", name: "name", email: "email" },
  calibrationJob: {},
  customer: { id: "id", name: "name" },
  asset: {},
  referenceStandard: {},
  paymentHistory: {},
  personnelCompetence: {},
  calibrationRequest: {
    submittedBy: "submittedBy",
    authOrganizationId: "authOrganizationId",
    id: "id",
  },
  calibrationRequestItem: {},
  calibrationVisit: {
    id: "id",
    organizationId: "organizationId",
    technicianId: "technicianId",
    scheduledAt: "scheduledAt",
    sourceRequestId: "sourceRequestId",
    customerId: "customerId",
    address: "address",
  },
  organization: {
    id: "id",
    name: "name",
    logo: "logo",
    cnpj: "cnpj",
    accreditationNumber: "accreditationNumber",
    accreditationBody: "accreditationBody",
    street: "street",
    number: "number",
    complement: "complement",
    neighbourhood: "neighbourhood",
    city: "city",
    state: "state",
    cep: "cep",
    phone: "phone",
    email: "email",
    website: "website",
  },
  organizationCustomDomain: {},
  customerGroup: {},
}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
  },
}));

vi.mock("@calibra-facil/db", () => ({ db: dbMock, systemDb: dbMock }));
// Entity reads and notification rows run in `inOrg(lab, ...)` and the laboratory
// of a visit id is learned on the system path (lab-scope.ts): the double runs
// the transaction on the db mock and names a fixed laboratory.
vi.mock("./lab-scope", () => ({
  inOrg: (_organizationId: string, run: (tx: unknown) => unknown) =>
    run(dbMock),
  findVisitLaboratory: async () => "org-1",
  findJobLaboratory: async () => "org-1",
  findCalibrationRequestLaboratory: async () => "org-1",
  findAuditPackLaboratory: async () => "org-1",
  listPortalDigestRecipients: vi.fn(),
}));
// These specs exercise the PLATFORM sender path (the lab sender is stubbed to none).
// Lab-sender resolution has its own coverage in service-order-customer-email-lab-sender.spec.ts.
vi.mock("@calibra-facil/lab-email-domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@calibra-facil/lab-email-domain")>()),
  resolveLabEmailSender: vi.fn().mockResolvedValue(undefined),
}));

// The email path consults the suppression list before every send; stub it so
// these template tests never touch the (mocked-away) emailSuppression table.
vi.mock("./suppression", () => ({
  isEmailSuppressed: vi.fn().mockResolvedValue(false),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------
import { sendNotification } from "./service";

// ---------------------------------------------------------------------------
// Database double
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

/** Whether a drizzle `where(...)` condition carries `value` (as a bound value). */
function conditionMentions(condition: unknown, value: string): boolean {
  if (condition === value) return true;
  if (Array.isArray(condition)) {
    return condition.some((part) => conditionMentions(part, value));
  }
  if (condition !== null && typeof condition === "object") {
    return conditionMentions(Reflect.get(condition, "queryChunks"), value);
  }
  return false;
}

/**
 * A query builder that answers when awaited (or at `.limit()`), with `rowsFor`
 * given the `where(...)` condition it was built with.
 */
function makeChain(rowsFor: (condition: unknown) => unknown[] = () => []) {
  let condition: unknown;
  const chain = {
    from: () => chain,
    where: (value: unknown) => {
      condition = value;
      return chain;
    },
    innerJoin: () => chain,
    leftJoin: () => chain,
    limit: async () => rowsFor(condition),
    values: () => chain,
    set: () => chain,
    returning: async () => rowsFor(condition),
    // oxlint-disable-next-line unicorn/no-thenable -- stands in for a drizzle query, which is awaited
    then: (
      resolve: (rows: unknown[]) => unknown,
      reject: (reason: unknown) => unknown,
    ) => Promise.resolve(rowsFor(condition)).then(resolve, reject),
  };
  return chain;
}

const USER_ROW = { email: "customer@example.com", name: "Maria Silva" };
const VISIT_ROW = {
  id: 1,
  organizationId: "org-lab",
  technicianId: "tech-1",
  scheduledAt: new Date("2026-06-25T10:00:00Z"),
  sourceRequestId: 42,
  address: {
    street: "Rua das Balanças",
    number: "100",
    neighbourhood: "Centro",
    city: "Porto Alegre",
    state: "RS",
    cep: "90000-000",
  },
  customerName: "ACME Ltda",
  labName: "Lab Acme",
  technicianName: "João Técnico",
  requestSubmittedBy: "customer-user-1",
  requestAuthOrganizationId: "org-customer",
};
const ORG_ROW = {
  name: "Lab Acme",
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

const TECHNICIAN_ROW = { email: "tech@lab.com", name: "João Técnico" };

/**
 * The rows the database holds, answered by what a query selects and, for the
 * user table, by whose id it asks for: the order of the queries does not
 * matter. A notification preference row is never present (the registry's
 * defaults apply).
 */
function givenDatabase(world: { visit?: Row; users?: Record<string, Row> }) {
  const users: Record<string, Row> = world.users ?? {};
  dbMock.select.mockImplementation((fields?: Row) => {
    const columns = Object.keys(fields ?? {});
    if (columns.length === 0) return makeChain(); // notification_preference
    if (columns.includes("scheduledAt")) {
      return makeChain(() => (world.visit ? [world.visit] : []));
    }
    if (columns.includes("cnpj")) return makeChain(() => [ORG_ROW]);
    // user lookups: the e-mail of a recipient, or the name of an actor
    return makeChain((condition) => {
      const entry = Object.entries(users).find(([id]) =>
        conditionMentions(condition, id),
      );
      if (!entry) return [];
      const [, row] = entry;
      return [
        columns.includes("email") ? row : { name: row["name"] ?? undefined },
      ];
    });
  });
  dbMock.insert.mockImplementation(() => makeChain(() => [{ id: 99 }]));
  dbMock.update.mockImplementation(() => makeChain());
}

/** A direct `sendNotification` to a recipient with an address on file. */
function setupDirectSend() {
  givenDatabase({ users: { "user-123": USER_ROW } });
}

/** A visit whose customer is the request's submitter and whose technician has an address. */
function setupVisit(visit: Row = VISIT_ROW) {
  givenDatabase({
    visit,
    users: {
      "tech-1": TECHNICIAN_ROW,
      "customer-user-1": USER_ROW,
      "lab-actor-user": { name: "Lab Actor" },
    },
  });
}

// ---------------------------------------------------------------------------
// REQ-VISITEMAIL-004: renderEmailTemplate dispatches to VisitNotificationEmail
// ---------------------------------------------------------------------------

describe("REQ-VISITEMAIL-004: VisitNotificationEmail rendered for visit emailContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitEmailSpy.mockReturnValue({ type: "visit-stub" });
    renderMock.mockResolvedValue("<html>mocked visit email</html>");
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";
  });

  it("calls VisitNotificationEmail for VISIT_CONFIRMED with variant:confirmed", async () => {
    setupDirectSend();
    await sendNotification({
      recipientUserId: "user-123",
      organizationId: "org-abc",
      type: "VISIT_CONFIRMED",
      title: "Visita confirmada",
      message: "Sua visita foi confirmada.",
      actionUrl: "https://calibrafacil.com/portal/requests/1",
      emailBrand: { name: "Lab Acme", isWhiteLabel: true },
      emailContext: {
        type: "visit",
        data: {
          customerName: "ACME Ltda",
          scheduledDate: "25/06/2026",
          technicianName: "João Técnico",
          labName: "Lab Acme",
        },
      },
    });
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "confirmed",
        customerName: "ACME Ltda",
        scheduledDate: "25/06/2026",
        technicianName: "João Técnico",
        labName: "Lab Acme",
      }),
    );
  });

  it("calls VisitNotificationEmail for VISIT_RESCHEDULED with variant:rescheduled", async () => {
    setupDirectSend();
    await sendNotification({
      recipientUserId: "user-123",
      organizationId: "org-abc",
      type: "VISIT_RESCHEDULED",
      title: "Visita reagendada",
      message: "Sua visita foi reagendada.",
      emailBrand: { name: "Lab Acme", isWhiteLabel: true },
      emailContext: {
        type: "visit",
        data: {
          customerName: "ACME Ltda",
          scheduledDate: "30/06/2026",
          labName: "Lab Acme",
        },
      },
    });
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "rescheduled" }),
    );
  });

  it("calls VisitNotificationEmail for VISIT_CANCELLED with reason", async () => {
    setupDirectSend();
    await sendNotification({
      recipientUserId: "user-123",
      organizationId: "org-abc",
      type: "VISIT_CANCELLED",
      title: "Visita cancelada",
      message: "Sua visita foi cancelada.",
      emailBrand: { name: "Lab Acme", isWhiteLabel: true },
      emailContext: {
        type: "visit",
        data: {
          customerName: "ACME Ltda",
          scheduledDate: "25/06/2026",
          reason: "Motivo do cancelamento",
          labName: "Lab Acme",
        },
      },
    });
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "cancelled",
        reason: "Motivo do cancelamento",
      }),
    );
  });

  it("calls VisitNotificationEmail for VISIT_REMINDER with variant:reminder", async () => {
    setupDirectSend();
    await sendNotification({
      recipientUserId: "user-123",
      organizationId: "org-abc",
      type: "VISIT_REMINDER",
      title: "Lembrete de visita",
      message: "Lembrete da sua visita.",
      emailBrand: { name: "Lab Acme", isWhiteLabel: true },
      emailContext: {
        type: "visit",
        data: {
          customerName: "ACME Ltda",
          scheduledDate: "25/06/2026",
          labName: "Lab Acme",
        },
      },
    });
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "reminder" }),
    );
  });

  it("does NOT call VisitNotificationEmail when emailContext is absent", async () => {
    setupDirectSend();
    await sendNotification({
      recipientUserId: "user-123",
      organizationId: "org-abc",
      type: "VISIT_CONFIRMED",
      title: "Visita confirmada",
      message: "Sua visita foi confirmada.",
      // no emailContext → falls through to generic NotificationEmail
    });
    expect(visitEmailSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// REQ-VISITEMAIL-005: customer-facing notify functions pass type:"visit" emailContext
// ---------------------------------------------------------------------------

describe("REQ-VISITEMAIL-005: customer-facing notify functions pass type:visit emailContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    visitEmailSpy.mockReturnValue({ type: "visit-stub" });
    renderMock.mockResolvedValue("<html>mocked visit email</html>");
    process.env.RESEND_API_KEY = "test-key";
    process.env.RESEND_FROM_EMAIL = "noreply@calibrafacil.com";
  });

  it("VISIT_CONFIRMED: VisitNotificationEmail called with variant:confirmed + customer data", async () => {
    setupVisit();
    const { notify } = await import("./service");
    await notify("VISIT_CONFIRMED", {
      visitId: 1,
      actorUserId: "lab-actor-user",
    });
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "confirmed",
        customerName: "ACME Ltda",
        labName: "Lab Acme",
        technicianName: "João Técnico",
        addressText:
          "Rua das Balanças, 100 · Centro - Porto Alegre - RS · 90000-000",
      }),
    );
  });

  it("VISIT_RESCHEDULED: customer branch calls VisitNotificationEmail with variant:rescheduled", async () => {
    setupVisit();
    const { notify } = await import("./service");
    await notify("VISIT_RESCHEDULED", {
      visitId: 1,
      actorUserId: "lab-actor-user",
    });
    const customerCall = visitEmailSpy.mock.calls.find(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        args[0].variant === "rescheduled" &&
        args[0].customerName === "ACME Ltda",
    );
    expect(customerCall).toBeDefined();
    expect(customerCall?.[0].addressText).toBe(
      "Rua das Balanças, 100 · Centro - Porto Alegre - RS · 90000-000",
    );
  });

  it("VISIT_CONFIRMED: addressText is undefined when the visit has no address", async () => {
    setupVisit({ ...VISIT_ROW, address: null });
    const { notify } = await import("./service");
    await notify("VISIT_CONFIRMED", {
      visitId: 1,
      actorUserId: "lab-actor-user",
    });
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy.mock.calls[0]?.[0]?.addressText).toBeUndefined();
  });

  it("VISIT_CANCELLED: customer branch calls VisitNotificationEmail with reason", async () => {
    setupVisit();
    const { notify } = await import("./service");
    await notify("VISIT_CANCELLED", {
      visitId: 1,
      actorUserId: "lab-actor-user",
      reason: "Laboratório indisponível",
    });
    const customerCall = visitEmailSpy.mock.calls.find(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        args[0].variant === "cancelled" &&
        args[0].customerName === "ACME Ltda",
    );
    expect(customerCall).toBeDefined();
    expect(customerCall?.[0].reason).toBe("Laboratório indisponível");
  });

  it("VISIT_REMINDER: customer branch calls VisitNotificationEmail with variant:reminder", async () => {
    setupVisit();
    const { notify } = await import("./service");
    await notify("VISIT_REMINDER", { visitId: 1 });
    const customerCall = visitEmailSpy.mock.calls.find(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        args[0].variant === "reminder" &&
        args[0].customerName === "ACME Ltda",
    );
    expect(customerCall).toBeDefined();
  });

  it("VISIT_SCHEDULED: does NOT call VisitNotificationEmail (technician in-app only)", async () => {
    setupVisit();
    const { notify } = await import("./service");
    await notify("VISIT_SCHEDULED", {
      visitId: 1,
      actorUserId: "lab-actor-user",
    });
    expect(visitEmailSpy).not.toHaveBeenCalled();
  });
});
