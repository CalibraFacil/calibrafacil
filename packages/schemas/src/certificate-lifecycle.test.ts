import { describe, expect, it } from "vitest";
import {
  deriveCertificateLifecycle,
  WithdrawCertificateSchema,
  type CertificateStatusEventLike,
} from "./certificate-lifecycle";

function event(
  id: number,
  type: CertificateStatusEventLike["event"],
  reason: string | null = null,
): CertificateStatusEventLike {
  return {
    id,
    event: type,
    reason,
    occurredAt: new Date(`2026-03-${String(id).padStart(2, "0")}T12:00:00Z`),
  };
}

describe("deriveCertificateLifecycle", () => {
  it("REQ-B3-L1: the state is the LATEST event, whatever the order the rows come in", () => {
    const events = [
      event(3, "WITHDRAWN", "Recall"),
      event(1, "ISSUED"),
      event(2, "SUPERSEDED"),
    ];

    const lifecycle = deriveCertificateLifecycle(events, 9);

    expect(lifecycle.status).toBe("WITHDRAWN");
    expect(lifecycle.latest?.id).toBe(3);
    expect(lifecycle.latest?.reason).toBe("Recall");
  });

  it("REQ-B3-L1: ISSUED, then SUPERSEDED when an amendment is issued", () => {
    expect(deriveCertificateLifecycle([event(1, "ISSUED")], null).status).toBe(
      "ISSUED",
    );
    expect(
      deriveCertificateLifecycle(
        [event(1, "ISSUED"), event(2, "SUPERSEDED")],
        7,
      ).status,
    ).toBe("SUPERSEDED");
  });

  it("REQ-B3-L1: a certificate with no event yet reads from the job's own supersession link", () => {
    expect(deriveCertificateLifecycle([], null)).toEqual({
      status: "ISSUED",
      latest: null,
    });
    expect(deriveCertificateLifecycle([], 12)).toEqual({
      status: "SUPERSEDED",
      latest: null,
    });
  });

  it("REQ-B3-L1: a reinstatement returns to what the job's supersession says", () => {
    const events = [
      event(1, "ISSUED"),
      event(2, "WITHDRAWN", "Recall"),
      event(3, "REINSTATED", "Recall lifted"),
    ];

    expect(deriveCertificateLifecycle(events, null).status).toBe("ISSUED");
    expect(deriveCertificateLifecycle(events, 5).status).toBe("SUPERSEDED");
  });
});

describe("WithdrawCertificateSchema", () => {
  it("REQ-B3-L2: the written reason is mandatory, trimmed, and at least 10 characters", () => {
    expect(WithdrawCertificateSchema.safeParse({}).success).toBe(false);
    expect(WithdrawCertificateSchema.safeParse({ reason: "" }).success).toBe(
      false,
    );
    expect(
      WithdrawCertificateSchema.safeParse({ reason: "   curto   " }).success,
    ).toBe(false);
    const parsed = WithdrawCertificateSchema.parse({
      reason: "  Padrao recolhido pelo fabricante  ",
    });
    expect(parsed.reason).toBe("Padrao recolhido pelo fabricante");
  });
});
