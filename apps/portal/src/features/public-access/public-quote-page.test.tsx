// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PublicQuotePage } from "./public-quote-page";

const TOKEN = "b".repeat(64);

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function orderPayload(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      serviceOrderNumber: "OS-2026-042",
      status: "awaiting_quote_approval",
      statusLabel: "Aguardando aprovação",
      openedAt: "2026-06-19T00:00:00.000Z",
      claimedDefect: "Leitura instável",
      assetSnapshot: {
        assetName: "Balança analítica",
        manufacturer: "Mettler Toledo",
        model: "XS204",
        serialNumber: "B812345678",
        displaySpecs: [{ label: "Capacidade", value: "220 g" }],
      },
      evaluations: [
        {
          id: 1,
          diagnosis: "Célula de carga desgastada",
          clientVisibleNotes: "Recomendada substituição.",
          evaluatedAt: "2026-06-20T00:00:00.000Z",
        },
      ],
      quotes: [
        {
          id: 7,
          quoteNumber: "OS-2026-042/ORC",
          version: 1,
          status: "sent",
          totalCents: 115000,
          validUntil: "2026-08-01T00:00:00.000Z",
          clientMessage: null,
          warrantyTerms: null,
          items: [
            {
              id: 1,
              type: "service",
              description: "Calibração de balança",
              quantity: "1",
              unit: "un",
              unitPriceCents: 115000,
              totalPriceCents: 115000,
            },
          ],
        },
      ],
      ...overrides,
    },
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  }
  return render(<PublicQuotePage token={TOKEN} />, { wrapper: Wrapper });
}

describe("PublicQuotePage (REQ-QPUB-042/043/044/045)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("REQ-QPUB-042: renders the quote in instrument-panel surfaces (blueprint fields + mono totals)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(orderPayload())),
    );

    renderPage();

    expect(await screen.findByText("OS-2026-042")).toBeTruthy();
    // BlueprintField labels from the instrument-identification grid
    expect(screen.getByText("Fabricante / Modelo")).toBeTruthy();
    expect(screen.getByText("Defeito reclamado")).toBeTruthy();
    // instrument-agnostic displaySpecs row
    expect(screen.getByText("Capacidade")).toBeTruthy();
    // SignalTile total in BRL
    expect(screen.getAllByText(/1\.150,00/).length).toBeGreaterThan(0);
    // evaluation panel
    expect(screen.getByText("Célula de carga desgastada")).toBeTruthy();
  });

  it("REQ-QPUB-043: approving shows the terminal confirmation WITHOUT refetching through the revoked token", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(orderPayload()))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Aprovar orçamento" }),
    );

    expect(
      await screen.findByRole("heading", { name: "Orçamento aprovado" }),
    ).toBeTruthy();
    // exactly one GET + one POST — no post-decision refetch (the token is
    // revoked; a refetch would 410 and blank the page)
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const postCall = fetchMock.mock.calls[1];
    expect(String(postCall?.[0])).toContain(`/${TOKEN}/approve-quote`);
  });

  it("REQ-QPUB-043: rejecting asks for confirmation, then shows the terminal rejection state from local data", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(orderPayload()))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Recusar orçamento" }),
    );

    // Confirmation dialog: nothing is sent until the customer confirms.
    expect(await screen.findByText("Recusar este orçamento?")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("Motivo da recusa"), {
      target: { value: "Valor acima do esperado" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recusa" }));

    expect(
      await screen.findByRole("heading", { name: "Orçamento recusado" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("the rejection dialog can be dismissed without sending anything", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(orderPayload()));
    vi.stubGlobal("fetch", fetchMock);

    renderPage();
    fireEvent.click(
      await screen.findByRole("button", { name: "Recusar orçamento" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Voltar" }));

    expect(screen.queryByText("Recusar este orçamento?")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Aprovar orçamento" }),
    ).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("REQ-QPUB-044: a 410 renders 'Orçamento já respondido' without any pricing", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "orcamento_respondido" }, { status: 410 }),
        ),
    );

    renderPage();

    expect(await screen.findByText("Orçamento já respondido")).toBeTruthy();
    expect(screen.queryByText(/1\.150,00/)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Aprovar orçamento" }),
    ).toBeNull();
  });

  it("REQ-QPUB-045: a malformed response body is rejected by the schema and renders the invalid state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ data: { totallyWrong: true } })),
    );

    renderPage();

    expect(await screen.findByText("Link indisponível")).toBeTruthy();
  });

  it("a 404 renders the invalid-link state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "Link invalido ou expirado" }, { status: 404 }),
        ),
    );

    renderPage();

    expect(await screen.findByText("Link indisponível")).toBeTruthy();
  });
});
