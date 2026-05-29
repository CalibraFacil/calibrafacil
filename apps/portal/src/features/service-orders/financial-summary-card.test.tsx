// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FinancialSummaryCard,
  isFinancialSummary,
  type PortalFinancialSummary,
} from "./financial-summary-card";

function summary(
  overrides: Partial<PortalFinancialSummary> = {},
): PortalFinancialSummary {
  return {
    state: "PAYMENT_PENDING",
    visible: true,
    dueDate: "2026-06-10T00:00:00.000Z",
    paidAt: null,
    openAmountCents: 10000,
    overdueAmountCents: 0,
    lastUpdatedAt: "2026-05-02T12:00:00.000Z",
    freshness: "fresh",
    documents: [
      {
        kind: "invoice",
        label: "Fatura",
        availableAt: "2026-05-01T12:00:00.000Z",
        href: null,
      },
    ],
    ...overrides,
  };
}

function expectPortalNeutralCopy(container: HTMLElement) {
  const text = container.textContent ?? "";
  const forbiddenTerms = [
    // Keep this split so the repo-wide portal neutrality grep does not match this test.
    ["Conta", "Azul"].join(" "),
    "ERP",
    "saleRemoteId",
    "pessoa",
    "cobrança",
    "baixa",
    "NF-e",
    "NFS-e",
    "https://api.contaazul",
  ];

  for (const term of forbiddenTerms) {
    expect(text).not.toContain(term);
  }
}

describe("FinancialSummaryCard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-15T12:00:00.000Z"));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders payment pending without repeating the evidence line", () => {
    const { container } = render(<FinancialSummaryCard summary={summary()} />);

    expect(
      screen.getByRole("heading", { name: "Pagamento pendente" }),
    ).toBeTruthy();
    expect(screen.getAllByText("Pagamento pendente")).toHaveLength(1);
    expect(screen.getAllByText("Vence em 10 de junho de 2026")).toHaveLength(1);
    expectPortalNeutralCopy(container);
  });

  it("renders invoice available", () => {
    const { container } = render(
      <FinancialSummaryCard
        summary={summary({
          state: "INVOICE_AVAILABLE",
          documents: [],
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Fatura disponível" }),
    ).toBeTruthy();
    expect(screen.getByText("Vence em 10 de junho de 2026")).toBeTruthy();
    expectPortalNeutralCopy(container);
  });

  it("renders paid with a textual status cue", () => {
    const { container } = render(
      <FinancialSummaryCard
        summary={summary({
          state: "PAID",
          dueDate: null,
          paidAt: "2026-06-08T10:00:00.000Z",
          openAmountCents: 0,
          documents: [
            {
              kind: "receipt",
              label: "Recibo",
              availableAt: "2026-06-08T10:00:00.000Z",
              href: null,
            },
          ],
        })}
      />,
    );

    expect(screen.getByRole("heading", { name: "Pago" }).className).toContain(
      "text-emerald-600",
    );
    expect(
      screen.getByText("Pagamento confirmado em 08 de junho de 2026"),
    ).toBeTruthy();
    expectPortalNeutralCopy(container);
  });

  it("renders overdue as destructive only when an amount is overdue", () => {
    const { container } = render(
      <FinancialSummaryCard
        summary={summary({
          state: "OVERDUE",
          dueDate: "2026-06-10T00:00:00.000Z",
          openAmountCents: 17500,
          overdueAmountCents: 10000,
        })}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Vencido" }).className,
    ).toContain("text-destructive");
    expect(container.textContent).toContain("Vencido há 5 dias");
    expect(container.textContent).toContain("R$");
    expect(container.textContent).toContain("175,00 em aberto");
    expectPortalNeutralCopy(container);
  });

  it("renders the stale freshness footer without provider wording", () => {
    const { container } = render(
      <FinancialSummaryCard summary={summary({ freshness: "stale" })} />,
    );

    expect(screen.getByText("Atualização pendente")).toBeTruthy();
    expectPortalNeutralCopy(container);
  });

  it("renders document rows as links only when a customer-safe href is present", () => {
    render(
      <FinancialSummaryCard
        summary={summary({
          documents: [
            {
              kind: "fiscal_document",
              label: "Documento fiscal",
              availableAt: "2026-06-09T10:00:00.000Z",
              href: null,
            },
            {
              kind: "receipt",
              label: "Recibo",
              availableAt: "2026-06-08T10:00:00.000Z",
              href: "https://signed.example/receipt.pdf",
            },
          ],
        })}
      />,
    );

    expect(screen.queryByText("Solicite ao laboratório")).toBeNull();
    const receiptLink = screen.getByRole("link", {
      name: /Recibo 08 de junho de 2026/,
    });
    expect(receiptLink.getAttribute("href")).toBe(
      "https://signed.example/receipt.pdf",
    );
    expect(receiptLink.hasAttribute("download")).toBe(true);
    expect(screen.getByText("Documento fiscal")).toBeTruthy();
  });

  it("renders nothing when the summary is hidden", () => {
    const { container } = render(
      <FinancialSummaryCard
        summary={summary({ state: null, visible: false })}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("rejects malformed summaries before rendering the card", () => {
    expect(
      isFinancialSummary({
        visible: false,
        state: null,
        freshness: "unknown",
        documents: [],
      }),
    ).toBe(true);
    expect(
      isFinancialSummary({
        visible: false,
        state: "PAYMENT_PENDING",
        freshness: "fresh",
        documents: [],
      }),
    ).toBe(false);
    expect(
      isFinancialSummary({
        visible: true,
        state: "PAYMENT_PENDING",
        freshness: "fresh",
      }),
    ).toBe(false);
    expect(
      isFinancialSummary({
        visible: true,
        state: "PAYMENT_PENDING",
        freshness: "expired",
        documents: [],
      }),
    ).toBe(false);

    expect(() =>
      render(<FinancialSummaryCard isError summary={undefined} />),
    ).not.toThrow();
    expect(screen.getByText("Informações indisponíveis")).toBeTruthy();
  });
});
