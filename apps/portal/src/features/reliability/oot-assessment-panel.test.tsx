// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OotAssessmentPanel } from "./oot-assessment-panel";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function ootEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    status: "OPEN",
    detectedAt: "2026-06-15T12:00:00.000Z",
    customerId: 1,
    assetId: 5,
    assetTag: "MAN-001",
    assetName: "Manômetro linha 2",
    jobId: 99,
    jobIdentifier: "CAL-2026-0099",
    suggestedPeriodStart: "2026-01-10T12:00:00.000Z",
    assessmentDecision: null,
    assessmentRationale: null,
    assessmentPeriodStart: null,
    assessmentPeriodEnd: null,
    assessmentSuspectShipped: null,
    assessmentCustomerNotified: null,
    assessmentCreatedAt: null,
    assessmentBy: null,
    ...overrides,
  };
}

function stubFetch(events: Array<unknown>) {
  vi.mocked(fetch).mockResolvedValue(jsonResponse({ data: events }));
}

function renderPanel(assetId = 5) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OotAssessmentPanel assetId={assetId} />
    </QueryClientProvider>,
  );
}

describe("OotAssessmentPanel", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders the assessment form for an OPEN event with the suspect-window defaults", async () => {
    stubFetch([ootEvent()]);

    renderPanel();

    expect(await screen.findByText("Avaliação de impacto")).toBeTruthy();
    expect(screen.getByText(/CAL-2026-0099/)).toBeTruthy();

    // Suspect-window defaults: last known-good calibration → detection date.
    const start = screen.getByLabelText("Início do período afetado");
    const end = screen.getByLabelText("Fim do período afetado");
    if (
      !(start instanceof HTMLInputElement) ||
      !(end instanceof HTMLInputElement)
    ) {
      throw new Error("period inputs not found");
    }
    expect(start.value).toBe("2026-01-10");
    expect(end.value).toBe("2026-06-15");
  });

  it("keeps submit disabled until the form is valid", async () => {
    stubFetch([ootEvent()]);

    renderPanel();

    const submit = await screen.findByRole("button", {
      name: /Registrar avaliação/,
    });
    if (!(submit instanceof HTMLButtonElement)) {
      throw new Error("submit button not found");
    }
    expect(submit.disabled).toBe(true);

    // Rationale below the 10-character minimum → still blocked.
    const rationale = screen.getByLabelText("Justificativa");
    fireEvent.change(rationale, { target: { value: "curto" } });
    expect(submit.disabled).toBe(true);

    // Valid rationale but no decision selected → still blocked.
    fireEvent.change(rationale, {
      target: {
        value: "Produtos do período verificados; nenhum lote afetado.",
      },
    });
    expect(submit.disabled).toBe(true);
  });

  it("ignores events from other assets", async () => {
    stubFetch([ootEvent({ assetId: 999 })]);

    const { container } = renderPanel(5);

    // Nothing to render for this asset.
    await Promise.resolve();
    expect(container.querySelector("section")).toBeNull();
  });

  it("renders the recorded assessment read-only for an ASSESSED event", async () => {
    stubFetch([
      ootEvent({
        status: "ASSESSED",
        assessmentDecision: "IMPACT_CONTAINED",
        assessmentRationale:
          "Lotes do período segregados e reinspecionados; nenhum desvio encontrado.",
        assessmentPeriodStart: "2026-01-10T12:00:00.000Z",
        assessmentPeriodEnd: "2026-06-15T12:00:00.000Z",
        assessmentSuspectShipped: true,
        assessmentCustomerNotified: true,
        assessmentCreatedAt: "2026-06-20T12:00:00.000Z",
        assessmentBy: "Maria Souza",
      }),
    ]);

    renderPanel();

    expect(
      await screen.findByText("Avaliação de impacto registrada"),
    ).toBeTruthy();
    expect(screen.getByText("Impacto identificado e contido")).toBeTruthy();
    expect(
      screen.getByText(
        "Lotes do período segregados e reinspecionados; nenhum desvio encontrado.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Registrado por Maria Souza em/)).toBeTruthy();
    // No form on an assessed event.
    expect(screen.queryByRole("button", { name: /Registrar avaliação/ })).toBe(
      null,
    );
  });
});
