import { describe, expect, it } from "vitest";
import { appendJobEvent, type JobEvent } from "./job-events.js";
import { jobAuditLog } from "./schema.js";

// REQ-AUD-1 / REQ-AUD-2 — appendJobEvent is the only writer of job_audit_log.
//
// The fixtures below are the row shapes production already stores, one per
// action string (read off the call sites before they were routed through
// appendJobEvent). They fail if a stored action string, a `changes` key or a
// column mapping drifts, because the audit UI, the exports and the auditors'
// queries read those rows by shape.

type Captured = { table: unknown; row: Record<string, unknown> };

/** A transaction handle that records the insert instead of running it. */
function recordingTx() {
  const captured: Captured[] = [];
  const tx = {
    insert(table: typeof jobAuditLog) {
      return {
        values: async (row: Record<string, unknown>) => {
          captured.push({ table, row });
        },
      };
    },
  };
  return { tx, captured };
}

/** What jsonb stores: the JSON round trip drops `undefined` keys. */
function stored(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

async function storedRow(event: JobEvent) {
  const { tx, captured } = recordingTx();
  await appendJobEvent(tx, event);
  expect(captured).toHaveLength(1);
  const [only] = captured;
  expect(only?.table).toBe(jobAuditLog);
  // What the table holds: a column the event left out is NULL.
  return {
    ...only?.row,
    ipAddress: only?.row.ipAddress ?? null,
    reason: only?.row.reason ?? null,
    changes: stored(only?.row.changes),
  };
}

const ORG = "org-1";
const USER = "user-1";
const actor = { kind: "user", userId: USER } as const;
const apiKeyFields = {
  source: "public_api",
  channel: "api_key",
  apiKeyId: "key-1",
  apiKeyName: "ERP",
  apiKeyPrefix: "cf_live_ab",
} as const;

describe("appendJobEvent stored row shapes (REQ-AUD-2)", () => {
  it("REQ-AUD-2: create stores the initial snapshot, leaving unset values out", async () => {
    const row = await storedRow({
      action: "create",
      organizationId: ORG,
      jobId: 7,
      actor,
      ipAddress: "10.0.0.1",
      changes: {
        initial: {
          assetId: 3,
          serviceId: 4,
          technicianId: undefined,
          dueDate: "2026-01-31T00:00:00.000Z",
          methodSnapshot: {
            methodId: 9,
            methodName: "Paquimetro",
            methodVersion: 2,
          },
          sourceRequestId: undefined,
          sourceRequestItemId: undefined,
          sourceServiceOrderId: null,
        },
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "create",
      changes: {
        initial: {
          assetId: 3,
          serviceId: 4,
          dueDate: "2026-01-31T00:00:00.000Z",
          methodSnapshot: {
            methodId: 9,
            methodName: "Paquimetro",
            methodVersion: 2,
          },
          sourceServiceOrderId: null,
        },
      },
      performedBy: USER,
      ipAddress: "10.0.0.1",
      reason: null,
    });
  });

  it("REQ-AUD-2: update stores the technician and due-date changes next to the actor fields", async () => {
    const row = await storedRow({
      action: "update",
      organizationId: ORG,
      jobId: 7,
      actor,
      changes: {
        ...apiKeyFields,
        technicianId: { old: null, new: "tech-1" },
        dueDate: { old: null, new: "2026-02-01T00:00:00.000Z" },
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "update",
      changes: {
        ...apiKeyFields,
        technicianId: { old: null, new: "tech-1" },
        dueDate: { old: null, new: "2026-02-01T00:00:00.000Z" },
      },
      performedBy: USER,
      ipAddress: null,
      reason: null,
    });
  });

  it.each(["submit", "execute"] as const)(
    "REQ-AUD-2: %s stores the before/after of what the command touched",
    async (action) => {
      const row = await storedRow({
        action,
        organizationId: ORG,
        jobId: 7,
        actor,
        ipAddress: "10.0.0.2",
        reason: "Data retroativa",
        changes: {
          status: { old: "IN_PROGRESS", new: "UNDER_REVIEW" },
          data: { old: { a: 1 }, new: { a: 2 } },
          results: { old: null, new: { u: 0.1 } },
          methodSnapshotEngine: undefined,
          methodDeviations: undefined,
          officialExecution: {
            methodFingerprint: "m",
            inputFingerprint: "i",
            calculationFingerprint: "c",
            resultFingerprint: "r",
          },
          desktopSubmittedResults: { u: 0.2 },
          standardsJudgedAt: {
            performedAt: "2026-01-02T00:00:00.000Z",
            standardIds: [1, 2],
            validOnlyBecauseBackdated: ["Padrao A"],
          },
        },
      });
      expect(row).toEqual({
        organizationId: ORG,
        jobId: 7,
        action,
        changes: {
          status: { old: "IN_PROGRESS", new: "UNDER_REVIEW" },
          data: { old: { a: 1 }, new: { a: 2 } },
          results: { old: null, new: { u: 0.1 } },
          officialExecution: {
            methodFingerprint: "m",
            inputFingerprint: "i",
            calculationFingerprint: "c",
            resultFingerprint: "r",
          },
          desktopSubmittedResults: { u: 0.2 },
          standardsJudgedAt: {
            performedAt: "2026-01-02T00:00:00.000Z",
            standardIds: [1, 2],
            validOnlyBecauseBackdated: ["Padrao A"],
          },
        },
        performedBy: USER,
        ipAddress: "10.0.0.2",
        reason: "Data retroativa",
      });
    },
  );

  it("REQ-P111-2: an execute that accepted a stale standard stores the warnings and only the judged-valid ids as judged", async () => {
    const warnings = [
      {
        code: "standard_no_longer_valid",
        reason: "standard_expired",
        standardIds: [2],
        standardNames: ["Massa vencida"],
      },
    ] as const;
    const execution = {
      data: { old: { a: 1 }, new: { a: 2 } },
      results: { old: null, new: { u: 0.1 } },
      officialExecution: {
        methodFingerprint: "m",
        inputFingerprint: "i",
        calculationFingerprint: "c",
        resultFingerprint: "r",
      },
      standardsJudgedAt: {
        performedAt: "2026-01-02T00:00:00.000Z",
        standardIds: [1],
        validOnlyBecauseBackdated: [],
      },
    };

    const row = await storedRow({
      action: "execute",
      organizationId: ORG,
      jobId: 7,
      actor,
      ipAddress: null,
      changes: {
        ...execution,
        standardsWarnings: warnings.map((warning) => ({
          ...warning,
          standardIds: [...warning.standardIds],
          standardNames: [...warning.standardNames],
        })),
      },
    });

    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "execute",
      changes: {
        ...execution,
        standardsWarnings: [
          {
            code: "standard_no_longer_valid",
            reason: "standard_expired",
            standardIds: [2],
            standardNames: ["Massa vencida"],
          },
        ],
      },
      performedBy: USER,
      ipAddress: null,
      reason: null,
    });
  });

  it("REQ-AUD-2: approve stores the status move, the API-key channel and the scope override", async () => {
    const row = await storedRow({
      action: "approve",
      organizationId: ORG,
      jobId: 7,
      actor,
      ipAddress: null,
      reason: "Aprovado - Gerando PDF",
      changes: {
        status: { old: "UNDER_REVIEW", new: "GENERATING_PDF" },
        approvedVia: {
          channel: "api_key",
          apiKeyId: "key-1",
          apiKeyName: "ERP",
          apiKeyPrefix: "cf_live_ab",
        },
        scopeComplianceStatus: { old: null, new: "OUT_OF_SCOPE" },
        scopeOverrideJustification: { old: null, new: "Cliente aceitou" },
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "approve",
      changes: {
        status: { old: "UNDER_REVIEW", new: "GENERATING_PDF" },
        approvedVia: {
          channel: "api_key",
          apiKeyId: "key-1",
          apiKeyName: "ERP",
          apiKeyPrefix: "cf_live_ab",
        },
        scopeComplianceStatus: { old: null, new: "OUT_OF_SCOPE" },
        scopeOverrideJustification: { old: null, new: "Cliente aceitou" },
      },
      performedBy: USER,
      ipAddress: null,
      reason: "Aprovado - Gerando PDF",
    });
  });

  it("REQ-CIN-6: approve stores the sha256 of the frozen certificate input", async () => {
    const sha256 = "a".repeat(64);
    const row = await storedRow({
      action: "approve",
      organizationId: ORG,
      jobId: 7,
      actor,
      ipAddress: null,
      reason: "Aprovado - Gerando PDF",
      changes: {
        status: { old: "REVIEW", new: "GENERATING_PDF" },
        certificateInputSha256: sha256,
      },
    });
    expect(row.changes).toEqual({
      status: { old: "REVIEW", new: "GENERATING_PDF" },
      certificateInputSha256: sha256,
    });
  });

  it("REQ-AUD-2: approve_reverted stores only the status move", async () => {
    const row = await storedRow({
      action: "approve_reverted",
      organizationId: ORG,
      jobId: 7,
      actor,
      ipAddress: "10.0.0.3",
      reason: "Aprovação revertida: falha ao enfileirar",
      changes: { status: { old: "GENERATING_PDF", new: "UNDER_REVIEW" } },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "approve_reverted",
      changes: { status: { old: "GENERATING_PDF", new: "UNDER_REVIEW" } },
      performedBy: USER,
      ipAddress: "10.0.0.3",
      reason: "Aprovação revertida: falha ao enfileirar",
    });
  });

  it.each([
    ["reject", "UNDER_REVIEW", "REJECTED"],
    ["cancel", "DRAFT", "CANCELED"],
  ] as const)(
    "REQ-AUD-2: %s stores the actor fields, the status move and the reason",
    async (action, from, to) => {
      const row = await storedRow({
        action,
        organizationId: ORG,
        jobId: 7,
        actor,
        ipAddress: "10.0.0.4",
        reason: "Motivo",
        changes: { ...apiKeyFields, status: { old: from, new: to } },
      });
      expect(row).toEqual({
        organizationId: ORG,
        jobId: 7,
        action,
        changes: { ...apiKeyFields, status: { old: from, new: to } },
        performedBy: USER,
        ipAddress: "10.0.0.4",
        reason: "Motivo",
      });
    },
  );

  it("REQ-AUD-2: assign stores the technician before and after, and the name", async () => {
    const row = await storedRow({
      action: "assign",
      organizationId: ORG,
      jobId: 7,
      actor,
      changes: {
        technicianId: { old: null, new: "tech-1" },
        technicianName: { old: null, new: "Maria" },
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "assign",
      changes: {
        technicianId: { old: null, new: "tech-1" },
        technicianName: { old: null, new: "Maria" },
      },
      performedBy: USER,
      ipAddress: null,
      reason: null,
    });
  });

  it("REQ-AUD-2: supersede stores the replaced status and the amendment that replaced it", async () => {
    const row = await storedRow({
      action: "supersede",
      organizationId: ORG,
      jobId: 7,
      actor,
      reason: "Certificado retificado. Novo: CAL-2026-0002. Motivo: erro",
      changes: {
        status: { old: "APPROVED", new: "SUPERSEDED" },
        supersededById: 8,
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "supersede",
      changes: {
        status: { old: "APPROVED", new: "SUPERSEDED" },
        supersededById: 8,
      },
      performedBy: USER,
      ipAddress: null,
      reason: "Certificado retificado. Novo: CAL-2026-0002. Motivo: erro",
    });
  });

  it("REQ-AUD-2: create_amendment stores what it supersedes and the written reason", async () => {
    const row = await storedRow({
      action: "create_amendment",
      organizationId: ORG,
      jobId: 8,
      actor,
      reason: "erro",
      changes: { supersedesId: 7, amendmentNumber: 1, reason: "erro" },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 8,
      action: "create_amendment",
      changes: { supersedesId: 7, amendmentNumber: 1, reason: "erro" },
      performedBy: USER,
      ipAddress: null,
      reason: "erro",
    });
  });
});

describe("appendJobEvent certificate lifecycle events (REQ-AUD-2, roadmap 2 B3)", () => {
  it("REQ-AUD-2: amendment_started stores the amendment opened on the original, which stays valid", async () => {
    const row = await storedRow({
      action: "amendment_started",
      organizationId: ORG,
      jobId: 7,
      actor,
      reason: "Retificacao iniciada",
      changes: { amendedJobId: 8, amendmentNumber: 1, reason: "erro" },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "amendment_started",
      changes: { amendedJobId: 8, amendmentNumber: 1, reason: "erro" },
      performedBy: USER,
      ipAddress: null,
      reason: "Retificacao iniciada",
    });
  });

  it("REQ-AUD-2: amendment_canceled stores the cancelled amendment on the original", async () => {
    const row = await storedRow({
      action: "amendment_canceled",
      organizationId: ORG,
      jobId: 7,
      actor,
      changes: {
        amendedJobId: 8,
        amendmentStatus: { old: "DRAFT", new: "CANCELED" },
      },
    });
    expect(row).toMatchObject({
      action: "amendment_canceled",
      changes: {
        amendedJobId: 8,
        amendmentStatus: { old: "DRAFT", new: "CANCELED" },
      },
    });
  });

  it("REQ-AUD-2: certificate_withdrawn stores the lifecycle move and the written reason", async () => {
    const row = await storedRow({
      action: "certificate_withdrawn",
      organizationId: ORG,
      jobId: 7,
      actor,
      ipAddress: "203.0.113.7",
      reason: "Padrao recolhido",
      changes: {
        certificateStatus: { old: "ISSUED", new: "WITHDRAWN" },
        reason: "Padrao recolhido",
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "certificate_withdrawn",
      changes: {
        certificateStatus: { old: "ISSUED", new: "WITHDRAWN" },
        reason: "Padrao recolhido",
      },
      performedBy: USER,
      ipAddress: "203.0.113.7",
      reason: "Padrao recolhido",
    });
  });
});

describe("appendJobEvent worker and backstop events (REQ-AUD-2)", () => {
  const workerActor = {
    kind: "system",
    source: "worker",
    onBehalfOf: USER,
  } as const;
  const at = new Date("2026-03-04T05:06:07.000Z");

  it("REQ-AUD-2: certificate_generated stores the issuance, the URL and the signer", async () => {
    const row = await storedRow({
      action: "certificate_generated",
      organizationId: ORG,
      jobId: 7,
      actor: workerActor,
      performedAt: at,
      changes: {
        status: { old: "GENERATING_PDF", new: "APPROVED" },
        certificateUrl: { old: null, new: "https://s3/cert.pdf" },
        signatureMetadata: { signed: true, signerName: "Fulano" },
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "certificate_generated",
      changes: {
        status: { old: "GENERATING_PDF", new: "APPROVED" },
        certificateUrl: { old: null, new: "https://s3/cert.pdf" },
        signatureMetadata: { signed: true, signerName: "Fulano" },
      },
      performedBy: USER,
      performedAt: at,
      ipAddress: null,
      reason: null,
    });
  });

  it("REQ-AUD-2: certificate_watermarked keeps its status text and an unsigned marker", async () => {
    const row = await storedRow({
      action: "certificate_watermarked",
      organizationId: ORG,
      jobId: 7,
      actor: workerActor,
      performedAt: at,
      changes: {
        status: "SUPERSEDED (watermark added)",
        certificateUrl: { old: null, new: "https://s3/cert.pdf" },
        signatureMetadata: { signed: false },
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "certificate_watermarked",
      changes: {
        status: "SUPERSEDED (watermark added)",
        certificateUrl: { old: null, new: "https://s3/cert.pdf" },
        signatureMetadata: { signed: false },
      },
      performedBy: USER,
      performedAt: at,
      ipAddress: null,
      reason: null,
    });
  });

  it("REQ-AUD-2: certificate_error from the worker stores the status move and the error as reason", async () => {
    const row = await storedRow({
      action: "certificate_error",
      organizationId: ORG,
      jobId: 7,
      actor: workerActor,
      performedAt: at,
      reason: "gotenberg timeout",
      changes: { status: { old: "GENERATING_PDF", new: "REJECTED" } },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "certificate_error",
      changes: { status: { old: "GENERATING_PDF", new: "REJECTED" } },
      performedBy: USER,
      performedAt: at,
      ipAddress: null,
      reason: "gotenberg timeout",
    });
  });

  it("REQ-AUD-2: certificate_error from the queue backstop also stores its source, trigger and queue row", async () => {
    const row = await storedRow({
      action: "certificate_error",
      organizationId: ORG,
      jobId: 7,
      actor: {
        kind: "system",
        source: "queue-backstop",
        onBehalfOf: USER,
      },
      performedAt: at,
      reason: "a fila desistiu do trabalho",
      changes: {
        status: { old: "GENERATING_PDF", new: "REJECTED" },
        source: "queue-backstop",
        reason: "dead-lettered",
        queueJobId: 55,
      },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "certificate_error",
      changes: {
        status: { old: "GENERATING_PDF", new: "REJECTED" },
        source: "queue-backstop",
        reason: "dead-lettered",
        queueJobId: 55,
      },
      performedBy: USER,
      performedAt: at,
      ipAddress: null,
      reason: "a fila desistiu do trabalho",
    });
  });

  it("REQ-AUD-2: label_generated stores the label URL", async () => {
    const row = await storedRow({
      action: "label_generated",
      organizationId: ORG,
      jobId: 7,
      actor: workerActor,
      performedAt: at,
      changes: { labelUrl: { old: null, new: "https://s3/label.png" } },
    });
    expect(row).toEqual({
      organizationId: ORG,
      jobId: 7,
      action: "label_generated",
      changes: { labelUrl: { old: null, new: "https://s3/label.png" } },
      performedBy: USER,
      performedAt: at,
      ipAddress: null,
      reason: null,
    });
  });
});

describe("appendJobEvent contract (REQ-AUD-1)", () => {
  it("REQ-AUD-1: runs on the transaction handle it is given, so the row commits or rolls back with the state change", async () => {
    const failure = new Error("audit insert refused");
    const tx = {
      insert() {
        return {
          values: async () => {
            throw failure;
          },
        };
      },
    };
    await expect(
      appendJobEvent(tx, {
        action: "cancel",
        organizationId: ORG,
        jobId: 7,
        actor,
        reason: "x",
        changes: { status: { old: "DRAFT", new: "CANCELED" } },
      }),
    ).rejects.toBe(failure);
  });

  it("REQ-AUD-1: leaves performed_at to the database default unless the event carries one", async () => {
    const row = await storedRow({
      action: "cancel",
      organizationId: ORG,
      jobId: 7,
      actor,
      reason: "x",
      changes: { status: { old: "DRAFT", new: "CANCELED" } },
    });
    expect("performedAt" in row).toBe(false);
  });

  it("REQ-AUD-2: refuses an event without an organization (the 0118 CHECK would refuse the row anyway)", async () => {
    const { tx } = recordingTx();
    await expect(
      appendJobEvent(tx, {
        action: "cancel",
        organizationId: "",
        jobId: 7,
        actor,
        reason: "x",
        changes: { status: { old: "DRAFT", new: "CANCELED" } },
      }),
    ).rejects.toThrow(/organizationId/);
  });

  it("REQ-AUD-2: a system event is stored against the user it acted for, never an empty actor", async () => {
    const { tx } = recordingTx();
    await expect(
      appendJobEvent(tx, {
        action: "label_generated",
        organizationId: ORG,
        jobId: 7,
        actor: { kind: "system", source: "worker", onBehalfOf: "" },
        changes: { labelUrl: { old: null, new: "u" } },
      }),
    ).rejects.toThrow(/actor/);
  });
});
