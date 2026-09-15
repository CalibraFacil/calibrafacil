import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@calibra-facil/db";
import {
  approvalRequest,
  billingCustomer,
  commercialDeal,
  commercialOffer,
  organization,
  user,
  type ApprovalRequestKind,
  type ApprovalRequestStatus,
} from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { loginAsBackoffice } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { backofficeRouter } from "./backoffice";
import { OFFER_CANCEL_DUAL_CONTROL_ERROR } from "../services/commercial/cancel";

// DOM-04 (#657): the backoffice commercial-offer cancel path is a money-touching
// financial action. It must refuse to execute unless a linked, APPROVED,
// same-organization, distinct-identity `approval_request` authorizes it, and it
// must persist that link. Real DB + real RBAC guard stack (via the real parent
// backofficeRouter mount, exactly like backoffice-commercial.int.spec.ts). The
// ONLY thing mocked besides the platform session is the ASAAS provider client —
// so the "no provider call on rejection" / "provider called once on success"
// assertions are real, but no network is touched.
//
// EARS proven here:
//   REQ-DOM-DC-001 [HIGH RISK] cancel WITHOUT a linked APPROVED approval (of the
//     appropriate kind, same org) → named 403, offer unchanged, no provider call.
//   REQ-DOM-DC-002            cancel WITH an APPROVED, distinct-identity, financial
//     approval → executes and persists commercial_offer.approval_request_id.
//   REQ-DOM-DC-003            approver must differ from requester (and executor);
//     the gate reuses the shared dual-control identity rule and fails CLOSED.

// ---------------------------------------------------------------------------
// Mock ONLY the ASAAS provider cancel calls (no network). importOriginal keeps
// every other asaas export intact so the router chain (issue/preview) still loads.
// ---------------------------------------------------------------------------
const { cancelPaymentMock, cancelCheckoutMock, cancelSubscriptionMock } =
  vi.hoisted(() => ({
    cancelPaymentMock: vi.fn(async () => ({})),
    cancelCheckoutMock: vi.fn(async () => ({})),
    cancelSubscriptionMock: vi.fn(async () => ({})),
  }));

vi.mock("../services/asaas", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../services/asaas")>();
  return {
    ...actual,
    cancelPayment: cancelPaymentMock,
    cancelCheckout: cancelCheckoutMock,
    cancelSubscription: cancelSubscriptionMock,
  };
});

const PRIMARY_ORG = "dc-org-primary";
const FOREIGN_ORG = "dc-org-foreign";
const OPERATOR = "dc-operator"; // executes the cancel (session user)
const REQUESTER = "dc-requester"; // opened the approval
const APPROVER = "dc-approver"; // decided the approval
const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const FUTURE = new Date("2099-01-01T00:00:00.000Z");
const JSON_HEADERS = { "content-type": "application/json" };
const CANCEL_REASON = "Cancelamento solicitado pelo cliente";

type Baseline = { dealId: string; billingCustomerId: number };

/** Seed both orgs, the three real user rows, a billing customer + deal in PRIMARY_ORG. */
async function seedBaseline(): Promise<Baseline> {
  await db.insert(organization).values([
    {
      id: PRIMARY_ORG,
      name: "Lab Primary",
      slug: PRIMARY_ORG,
      type: "LAB",
      status: "ACTIVE",
      createdAt: FIXED_NOW,
    },
    {
      id: FOREIGN_ORG,
      name: "Lab Foreign",
      slug: FOREIGN_ORG,
      type: "LAB",
      status: "ACTIVE",
      createdAt: FIXED_NOW,
    },
  ]);

  // Real user rows: canceledBy / actorUserId / requestedByUserId / decidedByUserId
  // are FKs to user.id — the FK insert fails if the id does not exist.
  await db.insert(user).values(
    [OPERATOR, REQUESTER, APPROVER].map((id) => ({
      id,
      name: `User ${id}`,
      email: `${id}@platform.test`,
    })),
  );

  const [customerRow] = await db
    .insert(billingCustomer)
    .values({
      organizationId: PRIMARY_ORG,
      provider: "ASAAS",
      providerCustomerId: `cus_${PRIMARY_ORG}`,
      status: "ACTIVE",
      name: "Cliente Primary",
      email: "primary@billing.test",
      taxId: "12345678000190",
    })
    .returning({ id: billingCustomer.id });
  if (!customerRow) throw new Error("seed: billingCustomer failed");

  const [deal] = await db
    .insert(commercialDeal)
    .values({
      organizationId: PRIMARY_ORG,
      title: "Deal Primary",
      status: "OPEN",
    })
    .returning({ id: commercialDeal.id });
  if (!deal) throw new Error("seed: commercialDeal failed");

  return { dealId: deal.id, billingCustomerId: customerRow.id };
}

/**
 * Seed a cancelable offer (PENDING_PAYMENT) in PRIMARY_ORG with a PAYMENT provider
 * id, so a proceeding cancel WOULD call `cancelPayment` — letting us assert it is
 * NOT called on rejection and IS called once on success. Returns the offer id.
 */
async function seedOffer(base: Baseline): Promise<string> {
  const [offer] = await db
    .insert(commercialOffer)
    .values({
      dealId: base.dealId,
      organizationId: PRIMARY_ORG,
      kind: "PLAN_RECURRING",
      status: "PENDING_PAYMENT",
      provider: "ASAAS",
      providerMode: "PAYMENT",
      activationBehavior: "NONE",
      currency: "BRL",
      subtotalAmount: 1499_00,
      discountAmount: 0,
      totalAmount: 1499_00,
      dueDate: FUTURE,
      paymentMethods: ["PIX"],
      termsSnapshot: {},
      customerSnapshot: {},
      billingCustomerId: base.billingCustomerId,
      providerPaymentId: `pay_${PRIMARY_ORG}`,
      issuedAt: FIXED_NOW,
    })
    .returning({ id: commercialOffer.id });
  if (!offer) throw new Error("seed: commercialOffer failed");
  return offer.id;
}

async function seedApproval(params: {
  organizationId: string;
  status: ApprovalRequestStatus;
  kind: ApprovalRequestKind;
  requestedByUserId: string | null;
  decidedByUserId: string | null;
}): Promise<number> {
  const [row] = await db
    .insert(approvalRequest)
    .values({
      organizationId: params.organizationId,
      kind: params.kind,
      summary: "Estorno/cancelamento de oferta",
      amountCents: 1499_00,
      status: params.status,
      requestedByUserId: params.requestedByUserId,
      decidedByUserId: params.decidedByUserId,
      decidedAt: params.status === "PENDING" ? null : FIXED_NOW,
    })
    .returning({ id: approvalRequest.id });
  if (!row) throw new Error("seed: approvalRequest failed");
  return row.id;
}

function cancelRequest(offerId: string, body: Record<string, unknown>) {
  return backofficeRouter.request(`/commercial/offers/${offerId}/cancel`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

/** Extract `error` from an unknown JSON body without an `as` assertion. */
function errorOf(body: unknown): string | undefined {
  if (
    typeof body === "object" &&
    body !== null &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return undefined;
}

async function reloadOffer(offerId: string) {
  const row = await db.query.commercialOffer.findFirst({
    where: eq(commercialOffer.id, offerId),
  });
  if (!row) throw new Error("offer disappeared");
  return row;
}

function noProviderCall() {
  expect(cancelPaymentMock).not.toHaveBeenCalled();
  expect(cancelCheckoutMock).not.toHaveBeenCalled();
  expect(cancelSubscriptionMock).not.toHaveBeenCalled();
}

describe("backoffice offer cancel — dual-control gate (real DB + real guards)", () => {
  beforeEach(async () => {
    await truncateAll();
    cancelPaymentMock.mockClear();
    cancelCheckoutMock.mockClear();
    cancelSubscriptionMock.mockClear();
    loginAsBackoffice({ userId: OPERATOR, role: "platform_admin" });
  });

  // =========================================================================
  // REQ-DOM-DC-001 [HIGH RISK]
  // =========================================================================
  it("REQ-DOM-DC-001: cancel with NO linked approval → named 403, offer unchanged, no provider call", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);

    const res = await cancelRequest(offerId, { reason: CANCEL_REASON });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });

  it("REQ-DOM-DC-001: cancel with a PENDING approval → named 403, offer unchanged, no provider call", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    const approvalId = await seedApproval({
      organizationId: PRIMARY_ORG,
      status: "PENDING",
      kind: "refund",
      requestedByUserId: REQUESTER,
      decidedByUserId: null,
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });

  it("REQ-DOM-DC-001: cancel with a REJECTED approval → named 403, offer unchanged, no provider call", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    const approvalId = await seedApproval({
      organizationId: PRIMARY_ORG,
      status: "REJECTED",
      kind: "refund",
      requestedByUserId: REQUESTER,
      decidedByUserId: APPROVER,
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });

  it("REQ-DOM-DC-001: cancel with an APPROVED approval of non-financial kind 'other' → named 403, offer unchanged", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    const approvalId = await seedApproval({
      organizationId: PRIMARY_ORG,
      status: "APPROVED",
      kind: "other",
      requestedByUserId: REQUESTER,
      decidedByUserId: APPROVER,
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });

  it("REQ-DOM-DC-001: cancel with an APPROVED approval from a DIFFERENT organization → named 403, offer unchanged", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    const approvalId = await seedApproval({
      organizationId: FOREIGN_ORG, // approved, distinct identity — but wrong org
      status: "APPROVED",
      kind: "refund",
      requestedByUserId: REQUESTER,
      decidedByUserId: APPROVER,
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });

  // =========================================================================
  // REQ-DOM-DC-002 — happy path
  // =========================================================================
  it("REQ-DOM-DC-002: cancel with an APPROVED distinct-identity financial approval → 200, status CANCELED, link persisted, provider called once", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    const approvalId = await seedApproval({
      organizationId: PRIMARY_ORG,
      status: "APPROVED",
      kind: "refund",
      requestedByUserId: REQUESTER, // maker
      decidedByUserId: APPROVER, // checker (distinct from maker AND from OPERATOR)
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(200);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("CANCELED");
    expect(after.canceledBy).toBe(OPERATOR);
    // The audit link is persisted (REQ-DOM-DC-002).
    expect(after.approvalRequestId).toBe(approvalId);
    // The offer WOULD-cancel path ran: exactly one provider cancel, matching mode.
    expect(cancelPaymentMock).toHaveBeenCalledTimes(1);
    expect(cancelCheckoutMock).not.toHaveBeenCalled();
    expect(cancelSubscriptionMock).not.toHaveBeenCalled();
  });

  // =========================================================================
  // REQ-DOM-DC-003 — reused identity rule fails CLOSED
  // =========================================================================
  it("REQ-DOM-DC-003: APPROVED approval whose approver == requester → named 403, offer unchanged", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    // Same identity decided AND requested — the decision route would have blocked
    // this, but a tampered row must still be refused at the execution gate.
    const approvalId = await seedApproval({
      organizationId: PRIMARY_ORG,
      status: "APPROVED",
      kind: "refund",
      requestedByUserId: REQUESTER,
      decidedByUserId: REQUESTER,
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });

  it("REQ-DOM-DC-003: APPROVED approval whose approver == executing operator → named 403, offer unchanged", async () => {
    const base = await seedBaseline();
    const offerId = await seedOffer(base);
    // Approver is the SAME person now executing the cancel — no single person may
    // both approve and execute.
    const approvalId = await seedApproval({
      organizationId: PRIMARY_ORG,
      status: "APPROVED",
      kind: "refund",
      requestedByUserId: REQUESTER,
      decidedByUserId: OPERATOR,
    });

    const res = await cancelRequest(offerId, {
      reason: CANCEL_REASON,
      approvalRequestId: approvalId,
    });

    expect(res.status).toBe(403);
    expect(errorOf(await res.json())).toBe(OFFER_CANCEL_DUAL_CONTROL_ERROR);

    const after = await reloadOffer(offerId);
    expect(after.status).toBe("PENDING_PAYMENT");
    expect(after.approvalRequestId).toBeNull();
    noProviderCall();
  });
});
