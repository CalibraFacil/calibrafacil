import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(
  (): {
    rows: Array<{
      linkId: string;
      integrationId: string;
      provider: "conta_azul" | "generic_http";
      target: string;
      localEntityId: string;
      remoteEntityId: string | null;
      remoteDisplayId: string | null;
      metadata: unknown;
      lastSyncedAt: Date | null;
    }>;
    updateCalls: Array<Record<string, unknown>>;
  } => ({
    rows: [],
    updateCalls: [],
  }),
);

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => mocks.rows,
            }),
          }),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          mocks.updateCalls.push(values);
        },
      }),
    }),
  },
}));

import {
  acknowledgeIntegrationDrift,
  buildIntegrationDriftQueue,
} from "../integration-drift";

beforeEach(() => {
  mocks.rows = [];
  mocks.updateCalls = [];
});

describe("buildIntegrationDriftQueue", () => {
  it("returns an empty list when there are no drift rows", async () => {
    mocks.rows = [];
    const result = await buildIntegrationDriftQueue({
      organizationId: "org-1",
    });
    expect(result).toEqual([]);
  });

  it("maps a remote_missing row to a provider-neutral DTO", async () => {
    mocks.rows = [
      {
        linkId: "lnk-1",
        integrationId: "int-1",
        provider: "conta_azul",
        target: "sale",
        localEntityId: "sale:1",
        remoteEntityId: "remote-1",
        remoteDisplayId: "F-99",
        metadata: {
          drift: {
            status: "remote_missing",
            checkedAt: "2026-05-26T00:00:00.000Z",
            reason: "not_found",
          },
        },
        lastSyncedAt: new Date("2026-05-25T12:00:00.000Z"),
      },
    ];

    const result = await buildIntegrationDriftQueue({
      organizationId: "org-1",
    });

    expect(result).toEqual([
      {
        linkId: "lnk-1",
        integrationId: "int-1",
        providerLabel: "Conta Azul",
        target: "sale",
        targetLabel: "Venda",
        localEntityId: "sale:1",
        remoteEntityId: "remote-1",
        remoteDisplayId: "F-99",
        driftStatus: "REMOTE_MISSING",
        driftCheckedAt: "2026-05-26T00:00:00.000Z",
        driftReason: "not_found",
        lastSyncedAt: "2026-05-25T12:00:00.000Z",
      },
    ]);
  });

  it("filters out non-remote_missing drift statuses (e.g. remote_present)", async () => {
    mocks.rows = [
      {
        linkId: "lnk-1",
        integrationId: "int-1",
        provider: "conta_azul",
        target: "sale",
        localEntityId: "sale:1",
        remoteEntityId: "r-1",
        remoteDisplayId: null,
        metadata: {
          drift: { status: "remote_present", checkedAt: "2026-05-26" },
        },
        lastSyncedAt: new Date("2026-05-25T12:00:00.000Z"),
      },
    ];

    const result = await buildIntegrationDriftQueue({
      organizationId: "org-1",
    });
    expect(result).toEqual([]);
  });
});

describe("acknowledgeIntegrationDrift", () => {
  it("rejects empty reasons", async () => {
    const result = await acknowledgeIntegrationDrift({
      organizationId: "org-1",
      linkId: "lnk-1",
      actorUserId: "user-1",
      reason: "   ",
    });
    expect(result).toEqual({ ok: false });
    expect(mocks.updateCalls).toHaveLength(0);
  });

  it("writes the acknowledgement when reason is non-empty", async () => {
    const result = await acknowledgeIntegrationDrift({
      organizationId: "org-1",
      linkId: "lnk-1",
      actorUserId: "user-1",
      reason: "cliente migrou de ERP",
    });
    expect(result).toEqual({ ok: true });
    expect(mocks.updateCalls).toHaveLength(1);
    const [first] = mocks.updateCalls;
    expect(first?.driftAcknowledgedByUserId).toBe("user-1");
    expect(first?.driftAcknowledgedReason).toBe("cliente migrou de ERP");
    expect(first?.driftAcknowledgedAt).toBeInstanceOf(Date);
  });
});
