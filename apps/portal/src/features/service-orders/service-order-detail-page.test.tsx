// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="/">{children}</a>,
}));

import { createPortalKeys } from "@/lib/portal-keys";
import { portalQueryKey } from "@/lib/portal-query-keys";
import { ServiceOrderDetailPage } from "./service-order-detail-page";

// Rendered without an organization provider: keys are scoped to "no organization".
const keys = createPortalKeys((...parts) => portalQueryKey(null, ...parts));

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const ORDER = {
  id: 7,
  serviceOrderNumber: "OS-7",
  status: "quote_sent",
  openedAt: "2026-06-01T12:00:00.000Z",
  claimedDefect: null,
  intakeCondition: null,
  accessories: null,
  clientVisibleNotes: null,
  quotes: [
    {
      id: 3,
      quoteNumber: "ORC-3",
      version: 1,
      status: "sent",
      totalCents: 12000,
      validUntil: null,
      clientMessage: null,
      warrantyTerms: null,
      items: [],
    },
  ],
};

function stubFetch() {
  vi.mocked(fetch).mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/financial-summary")) {
      return json({
        data: {
          state: null,
          visible: false,
          dueDate: null,
          paidAt: null,
          openAmountCents: 0,
          overdueAmountCents: 0,
          lastUpdatedAt: null,
          freshness: "unknown",
          documents: [],
        },
      });
    }
    if (url.includes("/quotes/")) return json({ ok: true });
    return json({ data: ORDER });
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const list = keys.serviceOrdersPage({
    page: 1,
    limit: 10,
    search: "",
    statusFilter: "",
  });
  queryClient.setQueryData(list, { data: [] });
  render(
    <QueryClientProvider client={queryClient}>
      <ServiceOrderDetailPage id="so-7" />
    </QueryClientProvider>,
  );
  return { queryClient, list };
}

describe("ServiceOrderDetailPage quote decisions", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    stubFetch();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ["approving", "Aprovar orçamento"],
    ["rejecting", "Recusar orçamento"],
  ])(
    "%s a quote refreshes the service-order list the customer returns to",
    async (_name, buttonLabel) => {
      const { queryClient, list } = renderPage();

      fireEvent.click(await screen.findByRole("button", { name: buttonLabel }));

      await vi.waitFor(() => {
        expect(queryClient.getQueryState(list)?.isInvalidated).toBe(true);
      });
    },
  );
});
