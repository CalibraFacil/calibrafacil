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

vi.mock("@calibra-facil/db", () => ({ db: dbMock }));

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
// Chain builder
// ---------------------------------------------------------------------------
function makeChain(result: unknown[] = []) {
  const c = {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(result),
    values: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    returning: vi.fn().mockResolvedValue(result),
  };
  return c;
}

const USER_ROW = { email: "customer@example.com", name: "Maria Silva" };
const VISIT_ROW = {
  id: 1,
  organizationId: "org-lab",
  technicianId: "tech-1",
  scheduledAt: new Date("2026-06-25T10:00:00Z"),
  sourceRequestId: 42,
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

/**
 * A db.select mock that routes based on call count.
 * For direct sendNotification tests:
 *   call 1: getUserPreferences → [] (uses DEFAULT_PREFERENCES)
 *   call 2: user email → [USER_ROW]
 *   call N>2: → []
 */
function setupDirectSend() {
  let n = 0;
  dbMock.select.mockImplementation(() => {
    n++;
    const chain = makeChain(n === 1 ? [] : n === 2 ? [USER_ROW] : []);
    return chain;
  });
  dbMock.insert.mockImplementation(() => makeChain([{ id: 99 }]));
  dbMock.update.mockImplementation(() => {
    const c = { set: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([]) };
    return c;
  });
}

/**
 * For notifyVisitConfirmed (confirmed → 1 send to customer only):
 *   call 1: getVisitDetails → [VISIT_ROW]
 *   call 2: getLabEmailBrand (org query) → [ORG_ROW]
 *   call 3: getUserPreferences → []
 *   call 4: user email → [USER_ROW]
 */
function setupVisitConfirmed() {
  let n = 0;
  dbMock.select.mockImplementation(() => {
    n++;
    const result =
      n === 1 ? [VISIT_ROW]
      : n === 2 ? [ORG_ROW]
      : n === 3 ? []
      : n === 4 ? [USER_ROW]
      : [];
    return makeChain(result);
  });
  dbMock.insert.mockImplementation(() => makeChain([{ id: 99 }]));
  dbMock.update.mockImplementation(() => ({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }));
}

/**
 * For functions with 2 sends (technician + customer).
 * Call sequence:
 *   1: getVisitDetails → [VISIT_ROW]
 *   --- technician send ---
 *   2: getUserPreferences(technicianId) → []
 *   3: user email lookup (tech) → [{ email: "tech@lab.com", name: "João" }]
 *   --- customer send ---
 *   4: getLabEmailBrand → [ORG_ROW]
 *   5: getUserPreferences(customer) → []
 *   6: user email lookup (customer) → [USER_ROW]
 */
function setupVisitTwoSends() {
  let n = 0;
  dbMock.select.mockImplementation(() => {
    n++;
    const result =
      n === 1 ? [VISIT_ROW]
      : n === 2 ? []                         // tech getUserPreferences → DEFAULT
      : n === 3 ? [{ email: "tech@lab.com", name: "João Técnico" }]
      : n === 4 ? [ORG_ROW]                  // getLabEmailBrand
      : n === 5 ? []                         // customer getUserPreferences → DEFAULT
      : n === 6 ? [USER_ROW]                 // customer email
      : [];
    return makeChain(result);
  });
  dbMock.insert.mockImplementation(() => makeChain([{ id: 99 }]));
  dbMock.update.mockImplementation(() => ({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }));
}

/**
 * For notifyVisitReminder (no actor check — both tech + customer get notified):
 * Same pattern as setupVisitTwoSends.
 */
function setupVisitReminder() {
  setupVisitTwoSends();
}

/**
 * For notifyVisitScheduled (technician only, no email brand):
 *   1: getVisitDetails → [VISIT_ROW]
 *   2: notifySelfActions check (tech != actor, skip)
 *   3: getActorName → user → [{ name: "Actor" }]
 *   4: getUserPreferences(tech) → []
 *   5: user email (tech) → [tech email] — but no emailBrand so no visit email
 */
function setupVisitScheduled() {
  let n = 0;
  dbMock.select.mockImplementation(() => {
    n++;
    const result =
      n === 1 ? [VISIT_ROW]
      : n === 2 ? [{ name: "Lab Actor" }]    // getActorName
      : n === 3 ? []                         // getUserPreferences → DEFAULT
      : n === 4 ? [{ email: "tech@lab.com", name: "João Técnico" }]
      : [];
    return makeChain(result);
  });
  dbMock.insert.mockImplementation(() => makeChain([{ id: 99 }]));
  dbMock.update.mockImplementation(() => ({
    set: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  }));
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

  it("notifyVisitConfirmed: VisitNotificationEmail called with variant:confirmed + customer data", async () => {
    setupVisitConfirmed();
    const { notifyVisitConfirmed } = await import("./service");
    await notifyVisitConfirmed(1, "lab-actor-user");
    expect(visitEmailSpy).toHaveBeenCalledTimes(1);
    expect(visitEmailSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "confirmed",
        customerName: "ACME Ltda",
        labName: "Lab Acme",
        technicianName: "João Técnico",
      }),
    );
  });

  it("notifyVisitRescheduled: customer branch calls VisitNotificationEmail with variant:rescheduled", async () => {
    setupVisitTwoSends();
    const { notifyVisitRescheduled } = await import("./service");
    await notifyVisitRescheduled(1, "lab-actor-user");
    const customerCall = visitEmailSpy.mock.calls.find(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        args[0].variant === "rescheduled" &&
        args[0].customerName === "ACME Ltda",
    );
    expect(customerCall).toBeDefined();
  });

  it("notifyVisitCancelled: customer branch calls VisitNotificationEmail with reason", async () => {
    setupVisitTwoSends();
    const { notifyVisitCancelled } = await import("./service");
    await notifyVisitCancelled(1, "lab-actor-user", "Laboratório indisponível");
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

  it("notifyVisitReminder: customer branch calls VisitNotificationEmail with variant:reminder", async () => {
    setupVisitReminder();
    const { notifyVisitReminder } = await import("./service");
    await notifyVisitReminder(1);
    const customerCall = visitEmailSpy.mock.calls.find(
      (args) =>
        args[0] &&
        typeof args[0] === "object" &&
        args[0].variant === "reminder" &&
        args[0].customerName === "ACME Ltda",
    );
    expect(customerCall).toBeDefined();
  });

  it("notifyVisitScheduled: does NOT call VisitNotificationEmail (technician in-app only)", async () => {
    setupVisitScheduled();
    const { notifyVisitScheduled } = await import("./service");
    await notifyVisitScheduled(1, "lab-actor-user");
    expect(visitEmailSpy).not.toHaveBeenCalled();
  });
});
