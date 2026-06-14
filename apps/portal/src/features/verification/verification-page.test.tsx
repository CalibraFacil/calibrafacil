// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The verification page is public; the only router dependency is <Link> for the
// "current version" jump on a superseded certificate. Stub it to a plain anchor
// so the component renders without a RouterProvider.
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => <a className={className}>{children}</a>,
}));

import { VerificationPage } from "./verification-page";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    valid: true,
    jobId: "CAL-2026-0001",
    status: "APPROVED",
    hasDocument: true,
    lab: "Laboratório Exemplo",
    accreditation: { accredited: false, number: null },
    customer: "Cliente Exemplo",
    asset: { name: "Balança X", tag: "BAL-001" },
    service: "Calibração de massa",
    performedAt: "2026-05-02T12:00:00.000Z",
    approvedAt: "2026-05-03T12:00:00.000Z",
    digitalSignature: {
      signed: true,
      signedAt: "2026-05-03T12:00:00.000Z",
      signerName: "Maria Souza",
      signerCpfCnpj: "123.456.789-00",
      certificateSerial: "0A1B2C",
      pdfHash: "abc123",
      ltvEnabled: true,
    },
    isSuperseded: false,
    isAmendment: false,
    amendmentNumber: null,
    amendmentReason: null,
    supersededAt: null,
    supersededBy: null,
    supersedes: null,
    ...overrides,
  };
}

function signaturePayload(overrides: Record<string, unknown> = {}) {
  return {
    signed: true,
    source: "issue",
    computedAt: "2026-05-03T12:00:00.000Z",
    verdict: {
      hashMatch: true,
      signatureCryptographicallyValid: true,
      chainValid: true,
      signerChainsToIcpRoot: true,
      certNotExpiredAtCheckDate: true,
      signaturePresent: true,
      signer: {
        commonName: "Maria Souza",
        cpfCnpj: "123.456.789-00",
        certificateSerial: "0A1B2C",
      },
      overall: "VALID",
      details: [],
    },
    ...overrides,
  };
}

function matchPayload(match = true) {
  return {
    match,
    expectedSha256: "abc123",
    uploadedSha256: match ? "abc123" : "def456",
    uploadedVerdict: signaturePayload().verdict,
  };
}

/** Route the mocked fetch by URL suffix: `/signature`, `/match`, else verification. */
function stubFetch(
  verification: unknown,
  signature: unknown = signaturePayload(),
  match: unknown = matchPayload(),
) {
  vi.mocked(fetch).mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.endsWith("/signature"))
      return Promise.resolve(jsonResponse(signature));
    if (url.endsWith("/match")) return Promise.resolve(jsonResponse(match));
    return Promise.resolve(jsonResponse(verification));
  });
}

function renderPage(token = "11111111-1111-1111-1111-111111111111") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <VerificationPage token={token} />
    </QueryClientProvider>,
  );
}

describe("VerificationPage", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders an authentic signed certificate with a VALID integrity verdict", async () => {
    stubFetch(validPayload());

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Certificado autêntico" }),
    ).toBeTruthy();
    expect(screen.getByText("CAL-2026-0001")).toBeTruthy();
    expect(screen.getByText("Balança X")).toBeTruthy();
    expect(screen.getByText("Maria Souza")).toBeTruthy();
    expect(
      screen.getByText("Assinatura digital com certificado A1 (PAdES/PKCS#7)."),
    ).toBeTruthy();
    expect(
      await screen.findByText("Assinatura íntegra e confiável"),
    ).toBeTruthy();
  });

  it("flags an altered document in the integrity verdict", async () => {
    stubFetch(
      validPayload(),
      signaturePayload({
        verdict: {
          hashMatch: false,
          signatureCryptographicallyValid: true,
          chainValid: true,
          signerChainsToIcpRoot: true,
          certNotExpiredAtCheckDate: true,
          signaturePresent: true,
          signer: {
            commonName: "Maria Souza",
            cpfCnpj: null,
            certificateSerial: null,
          },
          overall: "ALTERED",
          details: ["O conteúdo do PDF não corresponde ao registro."],
        },
      }),
    );

    renderPage();

    expect(await screen.findByText("Documento alterado")).toBeTruthy();
  });

  it("shows the cloud-only note for an unsigned certificate", async () => {
    stubFetch(validPayload({ digitalSignature: { signed: false } }));

    renderPage();

    expect(
      await screen.findByText(/não possui assinatura digital/),
    ).toBeTruthy();
  });

  it("flags a superseded certificate and links to the current version", async () => {
    stubFetch(
      validPayload({
        status: "SUPERSEDED",
        isSuperseded: true,
        supersededAt: "2026-06-01T12:00:00.000Z",
        supersededBy: {
          id: 2,
          jobId: "CAL-2026-0002",
          verificationToken: "22222222-2222-2222-2222-222222222222",
        },
      }),
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Certificado substituído" }),
    ).toBeTruthy();
    expect(screen.getByText("Ver versão vigente: CAL-2026-0002")).toBeTruthy();
  });

  it("confirms an uploaded file that matches the record", async () => {
    stubFetch(validPayload());

    const { container } = renderPage();
    await screen.findByRole("heading", { name: "Certificado autêntico" });

    const input = container.querySelector('input[type="file"]');
    if (!(input instanceof HTMLInputElement)) {
      throw new Error("file input not found");
    }
    const file = new File([new Uint8Array([1, 2, 3])], "cert.pdf", {
      type: "application/pdf",
    });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Confere")).toBeTruthy();
  });

  it("renders a clear not-found state for an unknown token", async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        { valid: false, error: "Certificado nao encontrado" },
        {
          status: 404,
        },
      ),
    );

    renderPage();

    expect(
      await screen.findByRole("heading", { name: "Certificado inválido" }),
    ).toBeTruthy();
  });
});
