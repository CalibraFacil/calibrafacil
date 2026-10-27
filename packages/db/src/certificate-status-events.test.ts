import { describe, expect, it } from "vitest";
import {
  appendCertificateStatusEvent,
  type CertificateStatusEventTransaction,
} from "./certificate-status-events.js";
import { issuedCertificateStatusEvent } from "./schema.js";

// appendCertificateStatusEvent is the only writer of issued_certificate_status_event
// (roadmap 2 B3). The table itself (append-only trigger, CHECKs, grants) is proved
// against a real Postgres in apps/api/src/modules/jobs/certificate-lifecycle.int.spec.ts;
// this is the writer's own contract.

type Row = typeof issuedCertificateStatusEvent.$inferInsert;

function recordingTx() {
  const rows: Row[] = [];
  const tx: CertificateStatusEventTransaction = {
    insert(table) {
      expect(table).toBe(issuedCertificateStatusEvent);
      return {
        values: async (row) => {
          rows.push(row);
        },
      };
    },
  };
  return { tx, rows };
}

const base = {
  organizationId: "org-1",
  certificateId: 5,
  jobId: 7,
  actorUserId: "user-1",
} as const;

describe("appendCertificateStatusEvent", () => {
  it("REQ-B3-E1: ISSUED stores who and from which process, with no reason or replacement", async () => {
    const { tx, rows } = recordingTx();

    await appendCertificateStatusEvent(tx, {
      ...base,
      event: "ISSUED",
      source: "worker",
    });

    expect(rows).toEqual([
      {
        organizationId: "org-1",
        certificateId: 5,
        jobId: 7,
        event: "ISSUED",
        supersededByJobId: null,
        reason: null,
        actorUserId: "user-1",
        source: "worker",
      },
    ]);
  });

  it("REQ-B3-E1: SUPERSEDED names the replacement and keeps the instant the caller recorded", async () => {
    const { tx, rows } = recordingTx();
    const occurredAt = new Date("2026-03-04T05:06:07.000Z");

    await appendCertificateStatusEvent(tx, {
      ...base,
      event: "SUPERSEDED",
      supersededByJobId: 8,
      reason: "erro de digitacao",
      source: "worker",
      occurredAt,
    });

    expect(rows[0]).toMatchObject({
      event: "SUPERSEDED",
      supersededByJobId: 8,
      reason: "erro de digitacao",
      occurredAt,
    });
  });

  it("REQ-B3-E1: WITHDRAWN keeps the trimmed reason", async () => {
    const { tx, rows } = recordingTx();

    await appendCertificateStatusEvent(tx, {
      ...base,
      event: "WITHDRAWN",
      reason: "  Padrao recolhido  ",
      source: "api",
    });

    expect(rows[0]).toMatchObject({
      event: "WITHDRAWN",
      reason: "Padrao recolhido",
      supersededByJobId: null,
    });
  });

  it("REQ-B3-E1: a withdrawal or reinstatement without a written reason, or a row without its laboratory, is refused before any write", async () => {
    const { tx, rows } = recordingTx();

    await expect(
      appendCertificateStatusEvent(tx, {
        ...base,
        event: "WITHDRAWN",
        reason: "   ",
        source: "api",
      }),
    ).rejects.toThrow(/written reason/);
    await expect(
      appendCertificateStatusEvent(tx, {
        ...base,
        event: "REINSTATED",
        reason: "",
        source: "api",
      }),
    ).rejects.toThrow(/written reason/);
    await expect(
      appendCertificateStatusEvent(tx, {
        ...base,
        organizationId: "",
        event: "ISSUED",
        source: "worker",
      }),
    ).rejects.toThrow(/organizationId/);
    expect(rows).toEqual([]);
  });
});
