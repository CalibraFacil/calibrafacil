// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BrandingProvider, useBranding } from "./branding-context";
import {
  BRANDING_FIRST_PAINT_WAIT_MS,
  brandingQueryOptions,
  settleBrandingForFirstPaint,
} from "./queries";

function BrandName() {
  const { name, isCustom } = useBranding();
  return (
    <p data-testid="brand">
      {name}:{String(isCustom)}
    </p>
  );
}

function renderProvider(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <BrandingProvider>
        <BrandName />
      </BrandingProvider>
    </QueryClientProvider>,
  );
}

describe("portal branding", () => {
  const fetchMock = vi.fn();
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("REQ-PORTAL-START-010: a failing branding request renders the default brand instead of blocking", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await settleBrandingForFirstPaint(queryClient);
    renderProvider(queryClient);

    expect((await screen.findByTestId("brand")).textContent).toBe(
      "CalibraFácil:false",
    );
  });

  it("REQ-PORTAL-START-011: an error status from the branding endpoint also falls back to the default brand", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 503 }));

    await settleBrandingForFirstPaint(queryClient);
    renderProvider(queryClient);

    expect((await screen.findByTestId("brand")).textContent).toBe(
      "CalibraFácil:false",
    );
  });

  it("REQ-PORTAL-START-012: a hanging branding request never holds the first paint past the wait budget", async () => {
    vi.useFakeTimers();
    fetchMock.mockReturnValue(new Promise<Response>(() => {}));

    let settled = false;
    const wait = settleBrandingForFirstPaint(queryClient).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(BRANDING_FIRST_PAINT_WAIT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await wait;
    expect(settled).toBe(true);

    // The default brand renders while the request is still pending.
    renderProvider(queryClient);
    expect(screen.getByTestId("brand").textContent).toBe("CalibraFácil:false");
  });

  it("REQ-PORTAL-START-013: a late branding answer still white-labels the page once it lands", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ name: "Lab Metrologia", logo: null }), {
        status: 200,
      }),
    );

    renderProvider(queryClient);

    await waitFor(() =>
      expect(screen.getByTestId("brand").textContent).toBe(
        "Lab Metrologia:true",
      ),
    );
    // The tab title follows the brand that landed after first render.
    await waitFor(() =>
      expect(document.title).toBe("Lab Metrologia | Portal do Cliente"),
    );
    expect(queryClient.getQueryData(brandingQueryOptions().queryKey)).toEqual({
      name: "Lab Metrologia",
      logo: null,
    });
  });
});
