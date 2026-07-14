// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { CodeEntryPage } from "./code-entry-page";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
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
  return render(<CodeEntryPage />, { wrapper: Wrapper });
}

async function typeAndSubmit(code: string) {
  fireEvent.change(screen.getByLabelText("Código de aprovação"), {
    target: { value: code },
  });
  fireEvent.click(screen.getByRole("button", { name: /acessar orçamento/i }));
  // let the mutation settle
  await screen.findByRole("button", { name: /acessar orçamento/i });
}

describe("CodeEntryPage (REQ-QPUB-040/041)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("REQ-QPUB-040: a valid code navigates to the tokenized quote page", async () => {
    const token = "a".repeat(64);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          data: {
            token,
            accessUrl: `https://portal.example/service-order-access/${token}`,
          },
        }),
      ),
    );

    renderPage();
    await typeAndSubmit("K7WM3P9A");

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/service-order-access/$token",
      params: { token },
    });
  });

  it("REQ-QPUB-041: a 404 shows the persistent 'código inválido' state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "codigo_invalido" }, { status: 404 }),
        ),
    );

    renderPage();
    await typeAndSubmit("AAAA2222");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Código inválido ou expirado");
    expect(mockNavigate).not.toHaveBeenCalled();
    // still visible until the customer edits the input
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Código de aprovação"), {
      target: { value: "AAAA2223" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("REQ-QPUB-041: a 429 shows the 'muitas tentativas' state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: "muitas_tentativas" }, { status: 429 }),
        ),
    );

    renderPage();
    await typeAndSubmit("AAAA2222");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Muitas tentativas");
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
