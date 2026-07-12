// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The detail view is presentational; stub the router <Link> to a plain anchor
// so it renders without a RouterProvider (same approach as
// verification-page.test.tsx).
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => <a className={className}>{children}</a>,
}));

// The signature strip fetches the public verdict; keep it inert here.
vi.mock("@/features/verification/queries", () => ({
  useSignatureVerdict: () => ({
    isPending: true,
    isError: false,
    data: undefined,
  }),
}));

import {
  CertificateDetailView,
  type Certificate,
  type CertificateAmendment,
} from "./certificate-detail-view";

function certificate(overrides: Partial<Certificate> = {}): Certificate {
  return {
    id: 10,
    jobId: "CAL-2026-0123",
    status: "APPROVED",
    performedAt: "2026-06-01T12:00:00.000Z",
    approvedAt: "2026-06-02T12:00:00.000Z",
    dueDate: null,
    certificateUrl: "https://r2.example/cert.pdf",
    releaseStatus: "RELEASED",
    verificationToken: "11111111-2222-3333-4444-555555555555",
    verdict: null,
    methodSnapshot: null,
    results: null,
    assetId: 7,
    assetPublicId: "AST-0007",
    assetName: "Balança analítica",
    assetTag: "BAL-001",
    assetManufacturer: null,
    assetModel: null,
    assetSerialNumber: "SN-123",
    serviceName: "Calibração de massa",
    labName: "Laboratório Exemplo",
    labLogo: null,
    labEmail: null,
    labPhone: null,
    referenceStandards: [],
    ...overrides,
  };
}

function amendmentInfo(
  overrides: Partial<CertificateAmendment> = {},
): CertificateAmendment {
  return {
    isAmendment: false,
    isSuperseded: false,
    amendmentNumber: null,
    amendmentReason: null,
    supersededAt: null,
    supersedes: null,
    supersededBy: null,
    chain: [],
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("CertificateDetailView — amendment chain (§7.8.8)", () => {
  it("renders no amendment banner for a plain certificate", () => {
    render(<CertificateDetailView certificate={certificate()} />);

    expect(screen.queryByText("Certificado substituído")).toBeNull();
    expect(screen.queryByText(/Retificação/)).toBeNull();
  });

  it("flags a superseded certificate and links the current version", () => {
    render(
      <CertificateDetailView
        certificate={certificate({
          status: "SUPERSEDED",
          amendment: amendmentInfo({
            isSuperseded: true,
            amendmentReason: "Erro de digitação no valor de incerteza",
            supersededAt: "2026-07-03T12:00:00.000Z",
            supersededBy: {
              id: 11,
              jobId: "CAL-2026-0456",
              amendmentNumber: 2,
              approvedAt: "2026-07-03T12:00:00.000Z",
            },
          }),
        })}
      />,
    );

    expect(screen.getByText("Certificado substituído")).toBeDefined();
    expect(screen.getByText(/substituído pela retificação nº 2/)).toBeDefined();
    expect(screen.getByText("CAL-2026-0456")).toBeDefined();
    expect(
      screen.getByText(/Erro de digitação no valor de incerteza/),
    ).toBeDefined();
    expect(screen.getByText("Ver versão vigente")).toBeDefined();
    // Header chip.
    expect(screen.getByText("Substituído")).toBeDefined();
  });

  it("flags supersession even while the replacement is not yet issued", () => {
    render(
      <CertificateDetailView
        certificate={certificate({
          status: "SUPERSEDED",
          amendment: amendmentInfo({
            isSuperseded: true,
            supersededAt: "2026-07-03T12:00:00.000Z",
            supersededBy: null,
          }),
        })}
      />,
    );

    expect(screen.getByText("Certificado substituído")).toBeDefined();
    expect(
      screen.getByText(/será disponibilizada no portal assim que concluída/),
    ).toBeDefined();
    expect(screen.queryByText("Ver versão vigente")).toBeNull();
  });

  it("identifies an amendment and references the original it replaces", () => {
    render(
      <CertificateDetailView
        certificate={certificate({
          jobId: "CAL-2026-0456",
          amendment: amendmentInfo({
            isAmendment: true,
            amendmentNumber: 1,
            amendmentReason: "Correção da identificação do instrumento",
            supersedes: { id: 9, jobId: "CAL-2026-0123" },
          }),
        })}
      />,
    );

    // Banner title + header chip both carry the amendment number.
    expect(screen.getAllByText("Retificação nº 1").length).toBeGreaterThan(0);
    expect(screen.getByText("CAL-2026-0123")).toBeDefined();
    expect(
      screen.getByText(/Correção da identificação do instrumento/),
    ).toBeDefined();
    expect(screen.getByText("Ver certificado substituído")).toBeDefined();
  });

  it("shows the emission timeline only when the chain has more than 2 members", () => {
    const chain = [
      {
        id: 9,
        jobId: "CAL-2026-0123",
        amendmentNumber: null,
        approvedAt: "2026-05-01T12:00:00.000Z",
        isCurrent: false,
      },
      {
        id: 10,
        jobId: "CAL-2026-0456",
        amendmentNumber: 1,
        approvedAt: "2026-06-02T12:00:00.000Z",
        isCurrent: false,
      },
      {
        id: 11,
        jobId: "CAL-2026-0789",
        amendmentNumber: 2,
        approvedAt: "2026-07-03T12:00:00.000Z",
        isCurrent: true,
      },
    ];

    render(
      <CertificateDetailView
        certificate={certificate({
          jobId: "CAL-2026-0456",
          status: "SUPERSEDED",
          amendment: amendmentInfo({
            isAmendment: true,
            isSuperseded: true,
            amendmentNumber: 1,
            supersedes: { id: 9, jobId: "CAL-2026-0123" },
            supersededBy: {
              id: 11,
              jobId: "CAL-2026-0789",
              amendmentNumber: 2,
              approvedAt: "2026-07-03T12:00:00.000Z",
            },
            chain,
          }),
        })}
      />,
    );

    expect(screen.getByText("Histórico de emissões")).toBeDefined();
    expect(screen.getByText(/Emissão original/)).toBeDefined();
    expect(screen.getByText("Vigente")).toBeDefined();
    expect(screen.getByText(/· este certificado/)).toBeDefined();
  });
});
