// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page's only router dependency is <Link> (worst-offender tags). Stub it to
// a plain anchor so the component renders without a RouterProvider.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => <a className={className}>{children}</a>,
}));

import { ReliabilityPage } from "./reliability-page";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function rateFields(overrides: Record<string, unknown> = {}) {
  return {
    jobs: 12,
    known: 9,
    conforming: 7,
    nonConforming: 2,
    unknown: 3,
    ootRatePct: 22.2,
    coveragePct: 75,
    ...overrides,
  };
}

function analyticsPayload(overrides: Record<string, unknown> = {}) {
  return {
    mode: "single",
    period: {
      from: "2024-07-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      bucket: "quarter",
    },
    totals: rateFields(),
    legalExcluded: 2,
    trend: [
      {
        bucket: "2026-T1",
        ...rateFields({ jobs: 6, known: 5, ootRatePct: 20 }),
      },
      {
        bucket: "2026-T2",
        ...rateFields({ jobs: 6, known: 4, ootRatePct: 25 }),
      },
    ],
    byAssetType: [
      { assetTypeId: 1, assetTypeName: "Manômetro", ...rateFields() },
    ],
    worstOffenders: [
      {
        assetId: 10,
        tag: "MAN-001",
        name: "Manômetro linha 2",
        assetTypeName: "Manômetro",
        jobs: 4,
        known: 4,
        nonConforming: 2,
        failureRatePct: 50,
        lastNonConformingAt: "2026-05-01T12:00:00.000Z",
      },
    ],
    attribution:
      "Pareceres de conformidade conforme a regra de decisão aplicada pelo laboratório em cada certificado; o portal reproduz os pareceres sem reavaliação.",
    ...overrides,
  };
}

/** Route the mocked fetch by URL: `/units` list, else fleet analytics. */
function stubFetch(analytics: unknown) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/api/portal/units")) {
      return Promise.resolve(
        jsonResponse({ mode: "single", units: [{ id: 1, name: "Matriz" }] }),
      );
    }
    return Promise.resolve(jsonResponse(analytics));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ReliabilityPage />
    </QueryClientProvider>,
  );
}

describe("ReliabilityPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the fleet totals and the coverage honesty line", async () => {
    stubFetch(analyticsPayload());

    renderPage();

    // OOT rate tile (also repeated in the by-type table).
    expect((await screen.findAllByText("22,2%")).length).toBeGreaterThan(0);
    // Coverage honesty line — always visible.
    expect(
      screen.getByText(/3 de 12 calibrações sem sinal as-found no período\./),
    ).toBeTruthy();
    // Legal-regime exclusion note.
    expect(
      screen.getByText(
        /2 calibrações de instrumentos em regime legal \(Inmetro\) não entram nos indicadores\./,
      ),
    ).toBeTruthy();
    // Worst offender row links by tag.
    expect(screen.getByText("MAN-001")).toBeTruthy();
    // Verdict attribution must be displayed.
    expect(
      screen.getByText(/o portal reproduz os pareceres sem reavaliação/),
    ).toBeTruthy();
  });

  it("shows honest empty states when there is no as-found signal", async () => {
    stubFetch(
      analyticsPayload({
        totals: rateFields({
          jobs: 0,
          known: 0,
          conforming: 0,
          nonConforming: 0,
          unknown: 0,
          ootRatePct: null,
          coveragePct: null,
        }),
        legalExcluded: 0,
        trend: [
          {
            bucket: "2026-T1",
            ...rateFields({
              jobs: 0,
              known: 0,
              conforming: 0,
              nonConforming: 0,
              unknown: 0,
              ootRatePct: null,
              coveragePct: null,
            }),
          },
        ],
        byAssetType: [],
        worstOffenders: [],
      }),
    );

    renderPage();

    // Trend empty state (no KNOWN cycles anywhere).
    expect(
      await screen.findByText(
        /Nenhuma calibração com sinal as-found no período/,
      ),
    ).toBeTruthy();
    // Worst-offenders empty state.
    expect(
      screen.getByText("Nenhuma reprovação as-found no período."),
    ).toBeTruthy();
    // Null rates render as "—" tiles instead of a misleading 0%.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // Coverage line still present.
    expect(
      screen.getByText(/0 de 0 calibrações sem sinal as-found no período\./),
    ).toBeTruthy();
  });
});
