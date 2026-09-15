import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono, type Context, type Next } from "hono";

const mocks = vi.hoisted(() => {
  const job: {
    jobId: number;
    jobStatus: string;
    orgId: string;
    customerId: number;
    serviceOrderId: number | null;
    serviceOrderUnitId: number | null;
  } | null = null;
  const release: {
    id: number;
    status: string;
    appliedPolicyId: number | null;
    lastEvaluatedAt: Date;
    paymentStateSnapshot: unknown;
    releasedByUserId: string | null;
    releaseReason: string | null;
    releasedByUserName: string | null;
  } | null = null;
  const policy: { id: number; mode: string } | null = null;
  return {
    job,
    release,
    policy,
    recomputeCertificateRelease: vi.fn(async () => ({
      releaseId: 1,
      status: "RELEASED",
      appliedPolicyId: 11,
      changed: false,
    })),
    releaseByException: vi.fn(),
  };
});

vi.mock("@calibra-facil/db", () => {
  const buildSelect = (): unknown => {
    let stack: Array<unknown> = [mocks.job, mocks.release, mocks.policy].filter(
      Boolean,
    );
    const shape = {
      from: () => shape,
      leftJoin: () => shape,
      innerJoin: () => shape,
      where: () => shape,
      orderBy: () => shape,
      limit: async () => {
        const next = stack.shift();
        return next ? [next] : [];
      },
    };
    return shape;
  };

  return {
    db: {
      select: () => buildSelect(),
      insert: () => ({
        values: () => ({
          returning: async () => [
            {
              id: 1,
              mode: "release_after_invoice",
              customerId: null,
              commercialAgreementId: null,
              serviceCategory: null,
              priority: 0,
              archivedAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          ],
        }),
      }),
      update: () => ({
        set: () => ({
          where: async () => undefined,
        }),
      }),
    },
  };
});

vi.mock("../../middleware/permission", async () => {
  const labMiddleware = async (c: Context, next: Next) => {
    c.set("session", { user: { id: "user-1" } });
    c.set("member", {
      organizationId: "org-1",
      activeUnitId: 10,
      accessibleUnitIds: [10, 11],
      canAccessAllUnits: false,
      selectedUnitScope: "unit",
    });
    await next();
  };
  return {
    withLabPermission: () => [labMiddleware],
    requirePermission: () => async (_c: Context, next: Next) => next(),
    requireLabProtected: [labMiddleware],
    requireOrgType: () => async (_c: Context, next: Next) => next(),
  };
});

vi.mock("../../middleware/tier-guard", () => ({
  requireFeature: () => async (_c: Context, next: Next) => next(),
}));

vi.mock("../../lib/certificate-release", () => ({
  recomputeCertificateRelease: mocks.recomputeCertificateRelease,
  releaseByException: mocks.releaseByException,
}));

import { financeCertificateReleaseRouter } from "../finance/certificate-release";

function makeApp() {
  return new Hono().route("/", financeCertificateReleaseRouter);
}

beforeEach(() => {
  mocks.job = null;
  mocks.release = null;
  mocks.policy = null;
  mocks.recomputeCertificateRelease.mockClear();
  mocks.releaseByException.mockReset();
});

describe("finance certificate-release routes", () => {
  describe("POST /:calibrationJobId/release-by-exception", () => {
    it("returns 400 when reason is empty", async () => {
      mocks.job = {
        jobId: 42,
        jobStatus: "APPROVED",
        orgId: "org-1",
        customerId: 5,
        serviceOrderId: 7,
        serviceOrderUnitId: 10,
      };

      const res = await makeApp().request("/42/release-by-exception", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "   " }),
      });
      expect(res.status).toBe(400);
    });

    it("returns 404 when job is not in caller's org / unit scope", async () => {
      mocks.job = null;

      const res = await makeApp().request("/42/release-by-exception", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Cliente prioritário" }),
      });
      expect(res.status).toBe(404);
      expect(mocks.releaseByException).not.toHaveBeenCalled();
    });

    it("returns 409 when the engine reports the job is not yet approved", async () => {
      mocks.job = {
        jobId: 42,
        jobStatus: "APPROVED",
        orgId: "org-1",
        customerId: 5,
        serviceOrderId: 7,
        serviceOrderUnitId: 10,
      };
      mocks.releaseByException.mockResolvedValueOnce({ code: "NOT_APPROVED" });

      const res = await makeApp().request("/42/release-by-exception", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Cliente prioritário" }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe("GET /:calibrationJobId", () => {
    it("returns 404 when the job is outside the caller's organization", async () => {
      mocks.job = null;

      const res = await makeApp().request("/42", { method: "GET" });
      expect(res.status).toBe(404);
      expect(mocks.recomputeCertificateRelease).not.toHaveBeenCalled();
    });
  });
});
