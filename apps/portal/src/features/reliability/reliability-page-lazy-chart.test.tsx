// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
}));

import { ReliabilityPage } from "./reliability-page";

const rates = {
  jobs: 6,
  known: 5,
  conforming: 4,
  nonConforming: 1,
  unknown: 1,
  ootRatePct: 20,
  coveragePct: 83,
};

function analyticsPayload() {
  return {
    mode: "single",
    period: {
      from: "2024-07-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      bucket: "quarter",
    },
    totals: rates,
    legalExcluded: 0,
    trend: [{ bucket: "2026-T1", ...rates }],
    byAssetType: [],
    worstOffenders: [],
    attribution: "Pareceres do laboratório.",
  };
}

describe("ReliabilityPage lazy trend chart", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const body = String(input).includes("/api/portal/units")
          ? { mode: "single", units: [{ id: 1, name: "Matriz" }] }
          : analyticsPayload();
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads the recharts chart module on demand and renders it once available", async () => {
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ReliabilityPage />
      </QueryClientProvider>,
    );

    // The caption lives in the lazily imported trend-bar-chart module: it only
    // appears after the dynamic import resolves.
    expect(
      await screen.findByText(/Barras sobre os ciclos com parecer conhecido/),
    ).toBeTruthy();
  });
});
