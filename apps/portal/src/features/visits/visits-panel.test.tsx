// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalVisitsPanel } from "./visits-panel";
import type { PortalVisit } from "./queries";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
  }: {
    children?: React.ReactNode;
    to?: string;
    className?: string;
  }) => (
    <a data-to={to} className={className}>
      {children}
    </a>
  ),
}));

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function inDays(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function visitFixture(overrides: Partial<PortalVisit> = {}): PortalVisit {
  return {
    id: 1,
    status: "CONFIRMED",
    scheduledAt: inDays(7),
    scheduledEndAt: null,
    address: null,
    customerName: "ACME",
    technicianName: "João",
    sourceRequestId: null,
    cancelReason: null,
    assetCount: 2,
    customerConfirmedAt: null,
    rescheduleRequest: null,
    ...overrides,
  };
}

function stubVisits(visits: Array<PortalVisit>) {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: visits }));
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <PortalVisitsPanel />
    </QueryClientProvider>,
  );
}

describe("PortalVisitsPanel (#739 customer actions)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the awaiting-confirmation chip and both actions for an actionable visit", async () => {
    stubVisits([visitFixture()]);
    renderPanel();

    expect(await screen.findByText("Aguardando confirmação")).toBeTruthy();
    expect(screen.getByText("Confirmar presença")).toBeTruthy();
    expect(screen.getByText("Solicitar reagendamento")).toBeTruthy();
  });

  it("shows the confirmed chip and hides the confirm button once customerConfirmedAt is set", async () => {
    stubVisits([visitFixture({ customerConfirmedAt: inDays(-1) })]);
    renderPanel();

    expect(await screen.findByText("Presença confirmada")).toBeTruthy();
    expect(screen.queryByText("Confirmar presença")).toBeNull();
    // Reschedule stays available for a confirmed-attendance visit.
    expect(screen.getByText("Solicitar reagendamento")).toBeTruthy();
  });

  it("shows the pending-reschedule chip and no action buttons while a request is open", async () => {
    stubVisits([
      visitFixture({
        rescheduleRequest: {
          id: 10,
          status: "PENDING",
          reason: "Planta parada",
          preferredWindows: [{ date: "2026-08-10", period: "MORNING" }],
          resolutionNote: null,
          createdAt: inDays(-1),
          resolvedAt: null,
        },
      }),
    ]);
    renderPanel();

    expect(await screen.findByText("Reagendamento solicitado")).toBeTruthy();
    expect(screen.queryByText("Confirmar presença")).toBeNull();
    expect(screen.queryByText("Solicitar reagendamento")).toBeNull();
    expect(
      screen.getByText(/Aguardando resposta do laboratório/),
    ).toBeTruthy();
  });

  it("shows the lab's resolution note after a declined request", async () => {
    stubVisits([
      visitFixture({
        rescheduleRequest: {
          id: 10,
          status: "DECLINED",
          reason: null,
          preferredWindows: [],
          resolutionNote: "Sem agenda no mês",
          createdAt: inDays(-2),
          resolvedAt: inDays(-1),
        },
      }),
    ]);
    renderPanel();

    expect(
      await screen.findByText(/O laboratório manteve a data original/),
    ).toBeTruthy();
    expect(screen.getByText(/Sem agenda no mês/)).toBeTruthy();
    // The customer can act again after a decline.
    expect(screen.getByText("Confirmar presença")).toBeTruthy();
  });

  it("does not render actions for a completed visit", async () => {
    stubVisits([visitFixture({ status: "COMPLETED", scheduledAt: inDays(-3) })]);
    renderPanel();

    expect(await screen.findByText("Concluída")).toBeTruthy();
    expect(screen.queryByText("Confirmar presença")).toBeNull();
    expect(screen.queryByText("Solicitar reagendamento")).toBeNull();
  });

  it("POSTs to /confirm when the confirm button is clicked", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.endsWith("/confirm") && init?.method === "POST") {
        return jsonResponse({ ok: true });
      }
      return jsonResponse({ data: [visitFixture()] });
    });
    renderPanel();

    fireEvent.click(await screen.findByText("Confirmar presença"));

    await vi.waitFor(() => {
      const confirmCall = fetchMock.mock.calls.find(([input]) =>
        String(input).includes("/api/portal/visits/1/confirm"),
      );
      expect(confirmCall).toBeTruthy();
      expect(confirmCall?.[1]?.method).toBe("POST");
    });
  });
});
