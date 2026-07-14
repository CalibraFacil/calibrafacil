/**
 * REQ-VISITEMAIL-001: VisitNotificationEmail exported with 6 variants.
 * REQ-VISITEMAIL-002: rendered HTML contains scheduled date, customer name,
 *   and (when provided) técnico name + address.
 * REQ-VISITEMAIL-003: renders lab white-label brand name + CTA actionUrl.
 *
 * Non-tautological: we render to real HTML and assert the values appear in the
 * output. Deleting a field from the template turns these RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { VisitNotificationEmail } from "./visit-notification-email";

const BASE_PROPS = {
  recipientName: "Maria Silva",
  customerName: "ACME Indústria Ltda",
  scheduledDate: "25/06/2026",
  technicianName: "João Técnico",
  addressText: "Rua das Flores, 100 — São Paulo, SP",
  labName: "Lab Metrologia",
  actionUrl: "https://calibrafacil.com/portal/requests/42",
  brand: { name: "Lab Metrologia", isWhiteLabel: true as const },
} as const;

async function renderVariant(
  variant:
    | "scheduled"
    | "confirmed"
    | "rescheduled"
    | "reschedule_declined"
    | "cancelled"
    | "reminder",
  overrides: Record<string, unknown> = {},
): Promise<string> {
  return render(
    VisitNotificationEmail({
      ...BASE_PROPS,
      variant,
      ...overrides,
    }),
  );
}

describe("REQ-VISITEMAIL-001: VisitNotificationEmail is exported with all 6 variants", () => {
  it("module exports VisitNotificationEmail", () => {
    expect(typeof VisitNotificationEmail).toBe("function");
  });

  it("renders without throwing for variant: scheduled", async () => {
    const html = await renderVariant("scheduled");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders without throwing for variant: confirmed", async () => {
    const html = await renderVariant("confirmed");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders without throwing for variant: rescheduled", async () => {
    const html = await renderVariant("rescheduled");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders without throwing for variant: reschedule_declined", async () => {
    const html = await renderVariant("reschedule_declined");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders without throwing for variant: cancelled", async () => {
    const html = await renderVariant("cancelled");
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders without throwing for variant: reminder", async () => {
    const html = await renderVariant("reminder");
    expect(html.length).toBeGreaterThan(0);
  });
});

describe("REQ-VISITEMAIL-002: rendered HTML contains required fields per variant", () => {
  it("scheduled: contains scheduledDate, customerName, technicianName, addressText", async () => {
    const html = await renderVariant("scheduled");
    expect(html).toContain("25/06/2026");
    expect(html).toContain("ACME Indústria Ltda");
    expect(html).toContain("João Técnico");
    expect(html).toContain("Rua das Flores, 100");
  });

  it("confirmed: contains scheduledDate, customerName, technicianName, addressText", async () => {
    const html = await renderVariant("confirmed");
    expect(html).toContain("25/06/2026");
    expect(html).toContain("ACME Indústria Ltda");
    expect(html).toContain("João Técnico");
    expect(html).toContain("Rua das Flores, 100");
  });

  it("rescheduled: contains scheduledDate, customerName, technicianName, addressText", async () => {
    const html = await renderVariant("rescheduled");
    expect(html).toContain("25/06/2026");
    expect(html).toContain("ACME Indústria Ltda");
    expect(html).toContain("João Técnico");
    expect(html).toContain("Rua das Flores, 100");
  });

  it("cancelled: contains customerName, addressText (scheduledDate optional when cancelled)", async () => {
    const html = await renderVariant("cancelled");
    expect(html).toContain("ACME Indústria Ltda");
    expect(html).toContain("Rua das Flores, 100");
  });

  it("reminder: contains scheduledDate, customerName, technicianName, addressText", async () => {
    const html = await renderVariant("reminder");
    expect(html).toContain("25/06/2026");
    expect(html).toContain("ACME Indústria Ltda");
    expect(html).toContain("João Técnico");
    expect(html).toContain("Rua das Flores, 100");
  });

  it("omitting technicianName renders without error and field absent", async () => {
    const html = await renderVariant("confirmed", {
      technicianName: undefined,
    });
    expect(html).toContain("25/06/2026");
    expect(html).not.toContain("João Técnico");
  });

  it("omitting addressText renders without error and address absent", async () => {
    const html = await renderVariant("confirmed", { addressText: undefined });
    expect(html).toContain("25/06/2026");
    expect(html).not.toContain("Rua das Flores, 100");
  });

  it("reason field appears in cancelled variant when provided", async () => {
    const html = await renderVariant("cancelled", {
      reason: "Indisponibilidade do laboratório",
    });
    expect(html).toContain("Indisponibilidade do laboratório");
  });

  it("reschedule_declined: contains kept-date message, scheduledDate and reason", async () => {
    const html = await renderVariant("reschedule_declined", {
      reason: "Sem agenda disponível no mês",
    });
    expect(html).toContain("25/06/2026");
    expect(html).toContain("ACME Indústria Ltda");
    expect(html).toContain("data original está mantida");
    expect(html).toContain("Sem agenda disponível no mês");
  });

  it("reminder: contains the confirm/reschedule portal call-to-action line (#739)", async () => {
    const html = await renderVariant("reminder");
    expect(html).toContain("solicitar o reagendamento");
  });
});

describe("REQ-VISITEMAIL-003: renders lab brand name + CTA actionUrl", () => {
  it("scheduled: brand name and actionUrl appear", async () => {
    const html = await renderVariant("scheduled");
    expect(html).toContain("Lab Metrologia");
    expect(html).toContain("https://calibrafacil.com/portal/requests/42");
  });

  it("confirmed: brand name and actionUrl appear", async () => {
    const html = await renderVariant("confirmed");
    expect(html).toContain("Lab Metrologia");
    expect(html).toContain("https://calibrafacil.com/portal/requests/42");
  });

  it("rescheduled: brand name and actionUrl appear", async () => {
    const html = await renderVariant("rescheduled");
    expect(html).toContain("Lab Metrologia");
    expect(html).toContain("https://calibrafacil.com/portal/requests/42");
  });

  it("cancelled: brand name and actionUrl appear", async () => {
    const html = await renderVariant("cancelled");
    expect(html).toContain("Lab Metrologia");
    expect(html).toContain("https://calibrafacil.com/portal/requests/42");
  });

  it("reminder: brand name and actionUrl appear", async () => {
    const html = await renderVariant("reminder");
    expect(html).toContain("Lab Metrologia");
    expect(html).toContain("https://calibrafacil.com/portal/requests/42");
  });
});
