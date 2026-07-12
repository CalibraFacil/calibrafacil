// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The page's only router dependency is <Link>. Stub it to a plain anchor so
// the component renders without a RouterProvider.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
    "aria-label": ariaLabel,
  }: {
    children?: ReactNode;
    className?: string;
    "aria-label"?: string;
  }) => (
    <a className={className} aria-label={ariaLabel}>
      {children}
    </a>
  ),
}));

import { AssetDetailPage } from "./asset-detail-page";
import type { AssetDetail, IntervalInsight } from "./types";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function assetPayload(overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: 11,
    publicId: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    customerId: 3,
    customerName: "Indústria de Alimentos Modelo Ltda.",
    assetTypeId: 2,
    assetTypeName: "Balança Digital",
    assetTypeSlug: "balanca-digital",
    name: "Balança semianalítica da expedição",
    manufacturer: "Shimadzu",
    model: "BL-3200H",
    serialNumber: "SHM-88213",
    tag: "BAL-002",
    status: "ACTIVE",
    specifications: null,
    lastCalibrationDate: "2026-05-11T12:00:00.000Z",
    nextCalibrationDate: "2027-05-11T12:00:00.000Z",
    calibrationIntervalMonths: 12,
    intervalSetBy: "customer_confirmed",
    metrologyRegime: "INDUSTRIAL",
    regulatedInterval: null,
    nextLegalVerificationDate: null,
    inLab: false,
    comments: null,
    createdAt: "2026-07-11T12:00:00.000Z",
    updatedAt: "2026-07-11T12:00:00.000Z",
    certificates: [
      {
        id: 1,
        jobId: "CAL-2026-9006",
        certificateName: null,
        status: "APPROVED",
        performedAt: "2026-05-11T12:00:00.000Z",
        approvedAt: "2026-05-12T12:00:00.000Z",
        certificateUrl: null,
        verificationToken: "tok",
        serviceName: "Calibração de Balança Analítica até 220 g",
        labName: "CalibraFácil",
      },
    ],
    certificateCount: 6,
    ...overrides,
  };
}

function driftingInsight(): IntervalInsight {
  return {
    classification: "DRIFTING",
    reliability: 1,
    coverage: 1,
    recommendation: {
      action: "shorten",
      method: "ilac-g24-m2",
      proposedIntervalMonths: 2,
      reliabilityBound: 0.95,
    },
    series: [],
    engineVersion: "0.3.0",
    fingerprint: "abc",
  };
}

/** Route the mocked fetch by URL suffix. */
function stubFetch(asset: AssetDetail, insight: IntervalInsight) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.includes("/interval-insight")) {
      return Promise.resolve(jsonResponse(insight));
    }
    if (url.includes("/drift-series")) {
      return Promise.resolve(
        jsonResponse({
          coverage: { cyclesWithMargins: 2, totalCycles: 6 },
          attribution:
            "Margens conforme os resultados “como recebido” do certificado.",
          cycles: [],
          points: [],
        }),
      );
    }
    if (url.includes("/oot-events")) {
      return Promise.resolve(jsonResponse({ data: [] }));
    }
    return Promise.resolve(jsonResponse({ data: asset }));
  });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AssetDetailPage assetId="11" />
    </QueryClientProvider>,
  );
}

describe("AssetDetailPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the hero, vitals and history, without the removed filler panel", async () => {
    stubFetch(assetPayload(), driftingInsight());

    renderPage();

    expect(
      await screen.findByText("Balança semianalítica da expedição"),
    ).toBeTruthy();
    // Certificate id shows twice: the vitals tile hint and the history link.
    expect((await screen.findAllByText("CAL-2026-9006")).length).toBe(2);
    // The redundant "Resumo operacional" panel is gone.
    expect(screen.queryByText("Resumo operacional")).toBeNull();
    // Empty specifications no longer render a placeholder panel.
    expect(screen.queryByText("Nenhuma especificação registrada.")).toBeNull();
    // Situação folded into Identificação.
    expect(screen.getByText("Situação")).toBeTruthy();
    expect(screen.getByText("Ativo")).toBeTruthy();
  });

  it("surfaces the drift verdict above the fold when the engine says DRIFTING", async () => {
    stubFetch(assetPayload(), driftingInsight());

    renderPage();

    expect(
      await screen.findByText("Deriva detectada no histórico de calibração"),
    ).toBeTruthy();
    expect(
      screen.getByText(/encurtar a periodicidade para 2 meses/),
    ).toBeTruthy();
  });

  it("asks for confirmation with the current → proposed delta before applying the suggestion", async () => {
    stubFetch(assetPayload(), driftingInsight());

    renderPage();

    const applyButton = await screen.findByRole("button", {
      name: /Aplicar sugestão/,
    });
    fireEvent.click(applyButton);

    expect(
      await screen.findByText("Aplicar a sugestão do motor?"),
    ).toBeTruthy();
    expect(screen.getByText("12 meses")).toBeTruthy();
    expect(screen.getByText("2 meses")).toBeTruthy();
    // Nothing was written yet — confirmation only.
    const putCalls = vi
      .mocked(fetch)
      .mock.calls.filter(
        (call) => typeof call[1] === "object" && call[1]?.method === "PUT",
      );
    expect(putCalls.length).toBe(0);
  });

  it("does not render the attention strip for a stable instrument", async () => {
    stubFetch(assetPayload(), {
      ...driftingInsight(),
      classification: "STABLE",
      recommendation: {
        action: "keep",
        method: "ilac-g24-m2",
        proposedIntervalMonths: 12,
        reliabilityBound: 0.95,
      },
    });

    renderPage();

    expect(
      await screen.findByText("Balança semianalítica da expedição"),
    ).toBeTruthy();
    expect(
      screen.queryByText("Deriva detectada no histórico de calibração"),
    ).toBeNull();
  });
});
