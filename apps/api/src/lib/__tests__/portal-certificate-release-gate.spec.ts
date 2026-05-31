import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{ calibrationJobId: number; status: string }>,
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: async () => mocks.rows,
      }),
    }),
  },
}));

import {
  applyPortalCertificateReleaseGate,
  loadPortalReleaseStatuses,
  toPortalReleaseStatus,
} from "../portal-certificate-release-gate";

beforeEach(() => {
  mocks.rows = [];
});

describe("toPortalReleaseStatus", () => {
  it("maps HELD_FOR_BILLING and HELD_FOR_PAYMENT to PAYMENT_PENDING", () => {
    expect(toPortalReleaseStatus("HELD_FOR_BILLING")).toBe("PAYMENT_PENDING");
    expect(toPortalReleaseStatus("HELD_FOR_PAYMENT")).toBe("PAYMENT_PENDING");
  });

  it("maps RELEASED, RELEASED_BY_EXCEPTION, and missing to RELEASED", () => {
    expect(toPortalReleaseStatus("RELEASED")).toBe("RELEASED");
    expect(toPortalReleaseStatus("RELEASED_BY_EXCEPTION")).toBe("RELEASED");
    expect(toPortalReleaseStatus(null)).toBe("RELEASED");
    expect(toPortalReleaseStatus(undefined)).toBe("RELEASED");
  });
});

describe("loadPortalReleaseStatuses", () => {
  it("returns an empty map when no job ids are provided", async () => {
    const map = await loadPortalReleaseStatuses({
      organizationId: "org-1",
      calibrationJobIds: [],
    });
    expect(map.size).toBe(0);
  });
});

describe("applyPortalCertificateReleaseGate", () => {
  const rows = [
    { id: 1, certificateUrl: "https://r2.example/sign/abc" },
    { id: 2, certificateUrl: "https://r2.example/sign/def" },
    { id: 3, certificateUrl: "https://r2.example/sign/ghi" },
  ];

  it("nullifies certificateUrl on held certificates and stamps releaseStatus", async () => {
    mocks.rows = [
      { calibrationJobId: 1, status: "RELEASED" },
      { calibrationJobId: 2, status: "HELD_FOR_PAYMENT" },
      { calibrationJobId: 3, status: "HELD_FOR_BILLING" },
    ];

    const gated = await applyPortalCertificateReleaseGate(rows, "org-1");

    expect(gated[0]).toEqual({
      id: 1,
      certificateUrl: "https://r2.example/sign/abc",
      releaseStatus: "RELEASED",
    });
    expect(gated[1]).toEqual({
      id: 2,
      certificateUrl: null,
      releaseStatus: "PAYMENT_PENDING",
    });
    expect(gated[2]).toEqual({
      id: 3,
      certificateUrl: null,
      releaseStatus: "PAYMENT_PENDING",
    });
  });

  it("treats missing release rows as RELEASED (backfill safety net)", async () => {
    mocks.rows = []; // no release rows
    const gated = await applyPortalCertificateReleaseGate(rows, "org-1");
    expect(gated.every((row) => row.releaseStatus === "RELEASED")).toBe(true);
    expect(gated.map((row) => row.certificateUrl)).toEqual(
      rows.map((row) => row.certificateUrl),
    );
  });

  it("produces a portal payload with no policy / ERP / provider vocabulary", async () => {
    mocks.rows = [
      { calibrationJobId: 1, status: "HELD_FOR_PAYMENT" },
      { calibrationJobId: 2, status: "RELEASED_BY_EXCEPTION" },
    ];

    const gated = await applyPortalCertificateReleaseGate(
      [rows[0]!, rows[1]!],
      "org-1",
    );

    const serialized = JSON.stringify(gated);
    expect(serialized).not.toMatch(
      /Conta Azul|ContaAzul|conta_azul|ERP|sale|pessoa|cobrança|policy|mode|HELD_/i,
    );
    // The two customer-facing statuses are the only ones in the payload.
    expect(serialized).toMatch(/RELEASED|PAYMENT_PENDING/);
  });
});
