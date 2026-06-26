import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getContaAzulScheduleState,
  processScheduledContaAzulIntegrationSyncs,
  processScheduledContaAzulPolls,
  runContaAzulScheduledPoll,
} from "../integrations";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const mocks = vi.hoisted(() => {
  const operations: Array<{
    kind: "insert" | "update";
    value: Record<string, unknown>;
  }> = [];
  const adapterPollProtocols = vi.fn();
  const subscriptionFindFirst = vi.fn();
  let updateCallCount = 0;
  let failFirstScheduleUpdate = true;
  let activePollRuns: unknown[] = [];
  let cursor: unknown = null;
  let errorEvents: unknown[] = [];
  let integrationRecord: unknown = null;
  let rows: unknown[] = [
    {
      config: {
        enabledTargets: {
          customers: true,
        },
        schedules: {
          customer: {
            frequency: "daily",
            lastScheduledRunAt: null,
            mode: "scheduled",
            nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
          },
        },
      },
      integrationId: "int-1",
      organizationId: "org-1",
    },
  ];

  // oxlint-disable-next-line unicorn/consistent-function-scoping -- helper must stay inside vi.hoisted with the mock state it builds.
  function createSelectQuery(selectRows: unknown[]) {
    let query: Promise<unknown[]> & {
      from: ReturnType<typeof vi.fn>;
      innerJoin: ReturnType<typeof vi.fn>;
      where: ReturnType<typeof vi.fn>;
    };
    query = Object.assign(Promise.resolve(selectRows), {
      from: vi.fn(() => query),
      innerJoin: vi.fn(() => query),
      where: vi.fn(() => query),
    });
    return query;
  }

  return {
    operations,
    adapterPollProtocols,
    reset() {
      operations.splice(0);
      adapterPollProtocols.mockReset();
      adapterPollProtocols.mockResolvedValue({
        cursor: {
          cursorType: "conta_azul_protocols",
          lastRemoteUpdatedAt: "2026-05-24T12:00:00.000Z",
          lastSuccessfulPollAt: "2026-05-24T12:00:00.000Z",
          nextPage: null,
          state: {},
        },
        processedCount: 1,
        updatedCount: 1,
        warnings: [],
      });
      activePollRuns = [];
      cursor = null;
      errorEvents = [];
      integrationRecord = null;
      subscriptionFindFirst.mockResolvedValue({
        planId: "PROFESSIONAL",
        status: "ACTIVE",
      });
      updateCallCount = 0;
      failFirstScheduleUpdate = true;
      rows = [
        {
          config: {
            enabledTargets: {
              customers: true,
            },
            schedules: {
              customer: {
                frequency: "daily",
                lastScheduledRunAt: null,
                mode: "scheduled",
                nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
              },
            },
          },
          integrationId: "int-1",
          organizationId: "org-1",
        },
      ];
    },
    allowScheduleUpdate() {
      failFirstScheduleUpdate = false;
    },
    setActivePollRuns(nextRuns: unknown[]) {
      activePollRuns = nextRuns;
    },
    setCursor(nextCursor: unknown) {
      cursor = nextCursor;
    },
    setErrorEvents(nextEvents: unknown[]) {
      errorEvents = nextEvents;
    },
    setIntegrationRecord(nextRecord: unknown) {
      integrationRecord = nextRecord;
    },
    setRows(nextRows: unknown[]) {
      rows = nextRows;
    },
    db: {
      insert: vi.fn(() => ({
        values: vi.fn((value: Record<string, unknown>) => {
          operations.push({ kind: "insert", value });
          return Promise.resolve();
        }),
      })),
      query: {
        integrationEventLog: {
          findMany: vi.fn((args?: { limit?: number }) =>
            Promise.resolve(errorEvents.slice(0, args?.limit)),
          ),
        },
        integrationSyncCursor: {
          findFirst: vi.fn(() => Promise.resolve(cursor)),
        },
        integrationSyncRun: {
          findFirst: vi.fn(() => Promise.resolve(null)),
          findMany: vi.fn((args?: { limit?: number }) =>
            Promise.resolve(activePollRuns.slice(0, args?.limit)),
          ),
        },
        organizationIntegration: {
          findFirst: vi.fn(() => Promise.resolve(integrationRecord)),
        },
        subscription: {
          findFirst: subscriptionFindFirst,
        },
      },
      select: vi.fn(() => createSelectQuery(rows)),
      update: vi.fn(() => ({
        set: vi.fn((value: Record<string, unknown>) => ({
          where: vi.fn(() => {
            operations.push({ kind: "update", value });
            updateCallCount += 1;
            if (failFirstScheduleUpdate && updateCallCount === 1) {
              return Promise.reject(new Error("schedule update failed"));
            }
            return Promise.resolve();
          }),
        })),
      })),
    },
  };
});

vi.mock("@calibra-facil/db", () => ({
  db: mocks.db,
}));

vi.mock("@calibra-facil/signing", () => ({
  decryptPassword: vi.fn(() => "secret"),
  encryptPassword: vi.fn(() => ({
    encryptedSecret: "encrypted",
    secretIv: "iv",
  })),
}));

vi.mock("../conta-azul-oauth", () => ({
  buildContaAzulRefreshFailurePolicy: vi.fn(),
  getContaAzulOAuthConfig: vi.fn(() => ({})),
  parseContaAzulTokenBundle: vi.fn(() => ({
    accessToken: "access-token",
    expiresAt: "2099-05-24T13:00:00.000Z",
    refreshToken: "refresh-token",
    scopes: [],
  })),
  refreshContaAzulAccessToken: vi.fn(),
  serializeContaAzulTokenBundle: vi.fn(() => "serialized"),
}));

vi.mock("../financial-erp-adapters", () => ({
  createFinancialErpAdapter: vi.fn(() => ({
    pollProtocols: mocks.adapterPollProtocols,
  })),
}));

const consoleInfoSpy = vi
  .spyOn(console, "info")
  .mockImplementation(() => undefined);
const consoleWarnSpy = vi
  .spyOn(console, "warn")
  .mockImplementation(() => undefined);

afterAll(() => {
  consoleInfoSpy.mockRestore();
  consoleWarnSpy.mockRestore();
});

function contaAzulPollRow() {
  return {
    config: {
      enabledTargets: {
        paymentStatusPolling: false,
        payables: false,
        fiscalDocuments: false,
        protocols: true,
        driftChecks: false,
      },
      polling: {},
    },
    integrationId: "int-1",
    organizationId: "org-1",
  };
}

function contaAzulRecord(config = contaAzulPollRow().config) {
  return {
    id: "int-1",
    createdBy: "user-1",
    organizationId: "org-1",
    provider: "conta_azul",
    status: "ACTIVE",
    connection: {
      id: "conn-1",
      config,
      credentialType: "oauth2",
      encryptedSecret: "encrypted",
      secretIv: "iv",
    },
  };
}

describe("Conta Azul scheduler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
  });

  it("creates and fails a scheduled run when advancing the schedule fails", async () => {
    await expect(
      processScheduledContaAzulIntegrationSyncs({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      completedRuns: 0,
      dueRuns: 1,
      failedRuns: 1,
      queuedRuns: 0,
      scannedIntegrations: 1,
    });

    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "insert",
          value: expect.objectContaining({
            integrationId: "int-1",
            organizationId: "org-1",
            status: "PENDING",
            target: "customer",
            trigger: "scheduled",
          }),
        }),
        expect.objectContaining({
          kind: "update",
          value: expect.objectContaining({
            errorSummary: "schedule update failed",
            status: "FAILED",
          }),
        }),
      ]),
    );
  });

  it("queues due scheduled Conta Azul runs instead of executing them inline", async () => {
    mocks.allowScheduleUpdate();
    const dispatch = vi.fn(() => Promise.resolve());

    await expect(
      processScheduledContaAzulIntegrationSyncs({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
        dispatch,
      }),
    ).resolves.toEqual({
      completedRuns: 0,
      dueRuns: 1,
      failedRuns: 0,
      queuedRuns: 1,
      scannedIntegrations: 1,
    });

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "INTEGRATION_SYNC",
        provider: "conta_azul",
        integrationId: "int-1",
        organizationId: "org-1",
        target: "customer",
        trigger: "scheduled",
      }),
    );
  });

  it("skips scheduled Conta Azul syncs when the organization no longer has the entitlement", async () => {
    mocks.allowScheduleUpdate();
    mocks.db.query.subscription.findFirst.mockResolvedValue({
      planId: "STANDARD",
      status: "ACTIVE",
    });
    const dispatch = vi.fn(() => Promise.resolve());

    await expect(
      processScheduledContaAzulIntegrationSyncs({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
        dispatch,
      }),
    ).resolves.toEqual({
      completedRuns: 0,
      dueRuns: 0,
      failedRuns: 0,
      queuedRuns: 0,
      scannedIntegrations: 1,
    });

    expect(dispatch).not.toHaveBeenCalled();
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            event: "sync.skipped.entitlement_revoked",
          }),
        }),
      ]),
    );
  });

  it("preserves earlier target schedule updates while queuing multiple due targets", async () => {
    mocks.allowScheduleUpdate();
    mocks.setRows([
      {
        config: {
          enabledTargets: {
            billingDocuments: true,
            customers: true,
          },
          schedules: {
            customer: {
              frequency: "daily",
              lastScheduledRunAt: null,
              mode: "scheduled",
              nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
            },
            billing_document: {
              frequency: "daily",
              lastScheduledRunAt: null,
              mode: "scheduled",
              nextScheduledRunAt: "2026-05-24T11:59:00.000Z",
            },
          },
        },
        integrationId: "int-1",
        organizationId: "org-1",
      },
    ]);
    const dispatch = vi.fn(() => Promise.resolve());

    await expect(
      processScheduledContaAzulIntegrationSyncs({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
        dispatch,
      }),
    ).resolves.toMatchObject({
      dueRuns: 2,
      queuedRuns: 2,
    });

    const scheduleUpdates = mocks.operations
      .filter((operation) => operation.kind === "update")
      .map((operation) => operation.value.config)
      .filter(Boolean);

    expect(scheduleUpdates.at(-1)).toMatchObject({
      schedules: {
        billing_document: {
          lastScheduledRunAt: "2026-05-24T12:00:00.000Z",
        },
        customer: {
          lastScheduledRunAt: "2026-05-24T12:00:00.000Z",
        },
      },
    });
  });
});

describe("Conta Azul scheduled polling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
    mocks.setRows([contaAzulPollRow()]);
    mocks.setIntegrationRecord(contaAzulRecord());
    mocks.allowScheduleUpdate();
  });

  it("dispatches a due protocol poll and records a scheduled run", async () => {
    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dueIntegrations: 1,
      failedPolls: 0,
      processedCount: 1,
      successfulPolls: 1,
      updatedCount: 1,
    });

    expect(mocks.adapterPollProtocols).toHaveBeenCalledTimes(1);
    expect(consoleInfoSpy).toHaveBeenCalledWith(
      "[IntegrationsCron] Conta Azul poll kind processed",
      expect.objectContaining({
        dueIntegrations: 1,
        pollKind: "protocols",
        scannedIntegrations: 1,
        successfulPolls: 1,
      }),
    );
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "insert",
          value: expect.objectContaining({
            integrationId: "int-1",
            organizationId: "org-1",
            status: "PENDING",
            target: "service_order",
            trigger: "scheduled",
            summary: expect.objectContaining({
              cursorType: "conta_azul_protocols",
              pollKind: "protocols",
            }),
          }),
        }),
        expect.objectContaining({
          kind: "insert",
          value: expect.objectContaining({
            event: "sync.completed",
            details: expect.objectContaining({
              pollKind: "protocols",
            }),
          }),
        }),
      ]),
    );
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "insert",
          value: expect.objectContaining({
            cursorType: "conta_azul_protocols",
            integrationId: "int-1",
            organizationId: "org-1",
          }),
        }),
        expect.objectContaining({
          kind: "update",
          value: expect.objectContaining({
            config: expect.objectContaining({
              polling: expect.objectContaining({
                protocolsLastRemoteUpdatedAt: "2026-05-24T12:00:00.000Z",
              }),
            }),
          }),
        }),
      ]),
    );
  });

  it("does not dispatch a poll when the same kind is not due yet", async () => {
    mocks.setCursor({
      cursorType: "conta_azul_protocols",
      lastRemoteUpdatedAt: new Date("2026-05-24T11:59:00.000Z"),
      lastSuccessfulPollAt: new Date("2026-05-24T11:59:00.000Z"),
      nextPage: null,
      state: {},
    });

    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dueIntegrations: 0,
      successfulPolls: 0,
    });

    expect(mocks.adapterPollProtocols).not.toHaveBeenCalled();
    expect(
      mocks.operations.some(
        (operation) =>
          operation.kind === "insert" &&
          isRecord(operation.value.summary) &&
          operation.value.summary.pollKind === "protocols",
      ),
    ).toBe(false);
  });

  it("skips disabled poll kinds without opening a run", async () => {
    mocks.setRows([
      {
        ...contaAzulPollRow(),
        config: {
          enabledTargets: {
            paymentStatusPolling: false,
            payables: false,
            fiscalDocuments: false,
            protocols: false,
            driftChecks: false,
          },
        },
      },
    ]);

    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dueIntegrations: 0,
      successfulPolls: 0,
    });

    expect(mocks.adapterPollProtocols).not.toHaveBeenCalled();
    expect(
      mocks.operations.some(
        (operation) =>
          operation.kind === "insert" &&
          operation.value.trigger === "scheduled",
      ),
    ).toBe(false);
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            event: "sync.skipped.disabled",
          }),
        }),
      ]),
    );
  });

  it("skips polling when the organization no longer has the entitlement", async () => {
    mocks.db.query.subscription.findFirst.mockResolvedValue({
      planId: "STANDARD",
      status: "ACTIVE",
    });

    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dueIntegrations: 0,
      successfulPolls: 0,
    });

    expect(mocks.adapterPollProtocols).not.toHaveBeenCalled();
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            event: "sync.skipped.entitlement_revoked",
          }),
        }),
      ]),
    );
  });

  it("logs entitlement lookup failures as skipped errors without a run failure", async () => {
    mocks.db.query.subscription.findFirst.mockRejectedValue(
      new Error("subscription unavailable"),
    );

    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      failedPolls: 0,
      successfulPolls: 0,
    });

    expect(mocks.adapterPollProtocols).not.toHaveBeenCalled();
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            event: "sync.skipped.error",
            message: "subscription unavailable",
          }),
        }),
      ]),
    );
    expect(
      mocks.operations.filter(
        (operation) => operation.value.event === "sync.failed",
      ),
    ).toHaveLength(0);
  });

  it("does not dispatch a poll when a same-kind run is already active", async () => {
    mocks.setActivePollRuns([
      {
        createdAt: new Date("2026-05-24T11:59:00.000Z"),
        status: "RUNNING",
        summary: {
          pollKind: "protocols",
        },
      },
    ]);

    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dueIntegrations: 0,
      successfulPolls: 0,
    });

    expect(mocks.adapterPollProtocols).not.toHaveBeenCalled();
    expect(mocks.operations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: expect.objectContaining({
            event: "sync.skipped.locked",
          }),
        }),
      ]),
    );
  });

  it("rejects direct scheduled poll calls when a same-kind run is already active", async () => {
    mocks.setActivePollRuns([
      {
        createdAt: new Date("2026-05-24T11:59:00.000Z"),
        status: "RUNNING",
        summary: {
          pollKind: "protocols",
        },
      },
    ]);

    await expect(
      runContaAzulScheduledPoll({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        integrationId: "int-1",
        kind: "protocols",
        organizationId: "org-1",
      }),
    ).rejects.toThrow("Polling Conta Azul já está em execução");

    expect(mocks.adapterPollProtocols).not.toHaveBeenCalled();
    expect(
      mocks.operations.some(
        (operation) =>
          operation.kind === "insert" &&
          operation.value.trigger === "scheduled",
      ),
    ).toBe(false);
  });

  it("records one failed event and does not advance the cursor when the adapter throws", async () => {
    mocks.adapterPollProtocols.mockRejectedValueOnce(new Error("adapter boom"));

    await expect(
      processScheduledContaAzulPolls({
        env: {
          INTEGRATIONS_MASTER_KEY: "test-master-key",
        },
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      dueIntegrations: 1,
      failedPolls: 1,
      successfulPolls: 0,
    });

    expect(mocks.adapterPollProtocols).toHaveBeenCalledTimes(1);
    expect(
      mocks.operations.filter(
        (operation) => operation.value.event === "sync.failed",
      ),
    ).toHaveLength(1);
    expect(
      mocks.operations.some(
        (operation) =>
          operation.kind === "insert" &&
          operation.value.cursorType === "conta_azul_protocols",
      ),
    ).toBe(false);
    expect(
      mocks.operations.some(
        (operation) =>
          operation.kind === "update" &&
          isRecord(operation.value.config) &&
          isRecord(operation.value.config.polling) &&
          Boolean(operation.value.config.polling.protocolsLastRemoteUpdatedAt),
      ),
    ).toBe(false);
  });
});

describe("Conta Azul schedule state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reset();
    mocks.setIntegrationRecord(contaAzulRecord());
    mocks.setActivePollRuns([]);
    mocks.setErrorEvents([]);
  });

  it("reports awaiting-first-run rows without a next due timestamp", async () => {
    await expect(
      getContaAzulScheduleState({
        integrationId: "int-1",
        organizationId: "org-1",
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      protocols: {
        enabled: true,
        lastSuccessAt: null,
        nextDueAt: null,
      },
    });
  });

  it("reports disabled rows with static interval and no due timestamp", async () => {
    mocks.setIntegrationRecord(
      contaAzulRecord({
        enabledTargets: {
          paymentStatusPolling: false,
          payables: false,
          fiscalDocuments: false,
          protocols: false,
          driftChecks: false,
        },
        polling: {},
      }),
    );

    await expect(
      getContaAzulScheduleState({
        integrationId: "int-1",
        organizationId: "org-1",
        now: new Date("2026-05-24T12:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      protocols: {
        enabled: false,
        intervalMinutes: 15,
        nextDueAt: null,
      },
    });
  });

  it("reports a standalone healthy row from the latest successful run", async () => {
    mocks.setActivePollRuns([
      {
        createdAt: new Date("2026-05-24T12:00:00.000Z"),
        finishedAt: new Date("2026-05-24T12:01:00.000Z"),
        status: "COMPLETED",
        summary: {
          pollKind: "protocols",
        },
        trigger: "scheduled",
      },
    ]);

    await expect(
      getContaAzulScheduleState({
        integrationId: "int-1",
        organizationId: "org-1",
        now: new Date("2026-05-24T12:05:00.000Z"),
      }),
    ).resolves.toMatchObject({
      protocols: {
        enabled: true,
        intervalMinutes: 15,
        lastErrorAt: null,
        lastErrorMessage: null,
        lastSuccessAt: "2026-05-24T12:01:00.000Z",
        nextDueAt: "2026-05-24T12:16:00.000Z",
      },
    });
  });

  it("exposes overdue next-due evidence for stuck schedule rows", async () => {
    mocks.setActivePollRuns([
      {
        createdAt: new Date("2026-05-23T10:00:00.000Z"),
        finishedAt: new Date("2026-05-23T10:01:00.000Z"),
        status: "COMPLETED",
        summary: {
          pollKind: "protocols",
        },
        trigger: "scheduled",
      },
    ]);

    await expect(
      getContaAzulScheduleState({
        integrationId: "int-1",
        organizationId: "org-1",
        now: new Date("2026-05-24T12:30:00.000Z"),
      }),
    ).resolves.toMatchObject({
      protocols: {
        enabled: true,
        lastSuccessAt: "2026-05-23T10:01:00.000Z",
        nextDueAt: "2026-05-23T10:16:00.000Z",
      },
    });
  });

  it("nulls next due evidence when the latest scheduled run failed", async () => {
    mocks.setActivePollRuns([
      {
        createdAt: new Date("2026-05-24T12:00:00.000Z"),
        finishedAt: new Date("2026-05-24T12:01:00.000Z"),
        status: "COMPLETED",
        summary: {
          pollKind: "protocols",
        },
        trigger: "scheduled",
      },
      {
        createdAt: new Date("2026-05-24T12:20:00.000Z"),
        errorSummary: "timeout",
        finishedAt: new Date("2026-05-24T12:21:00.000Z"),
        status: "FAILED",
        summary: {
          pollKind: "protocols",
        },
        trigger: "scheduled",
      },
    ]);

    await expect(
      getContaAzulScheduleState({
        integrationId: "int-1",
        organizationId: "org-1",
        now: new Date("2026-05-24T12:30:00.000Z"),
      }),
    ).resolves.toMatchObject({
      protocols: {
        enabled: true,
        intervalMinutes: 15,
        lastErrorAt: "2026-05-24T12:21:00.000Z",
        lastErrorMessage: "timeout",
        lastSuccessAt: "2026-05-24T12:01:00.000Z",
        nextDueAt: null,
      },
    });
  });

  it("surfaces poll-kind error events after many unrelated errors", async () => {
    mocks.setErrorEvents([
      ...Array.from({ length: 100 }, (_, index) => ({
        createdAt: new Date(
          `2026-05-24T11:${String(index % 60).padStart(2, "0")}:00.000Z`,
        ),
        details: {
          provider: "conta_azul",
        },
        message: `unrelated error ${index}`,
      })),
      {
        createdAt: new Date("2026-05-24T12:21:00.000Z"),
        details: {
          pollKind: "protocols",
          provider: "conta_azul",
        },
        message: "protocol poll failed",
      },
    ]);

    await expect(
      getContaAzulScheduleState({
        integrationId: "int-1",
        organizationId: "org-1",
        now: new Date("2026-05-24T12:30:00.000Z"),
      }),
    ).resolves.toMatchObject({
      protocols: {
        lastErrorAt: "2026-05-24T12:21:00.000Z",
        lastErrorMessage: "protocol poll failed",
      },
    });
  });
});
