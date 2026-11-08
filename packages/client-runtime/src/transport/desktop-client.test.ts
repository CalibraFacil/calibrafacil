import { describe, expect, it } from "vitest";
import { ResponseContractError } from "@calibra-facil/contracts";

import { createDesktopApiClient } from "./desktop-client";

// The desktop client parses what the local server answers with the contract
// schemas (it used to cast it): a field the server stops sending, or sends in
// another shape, fails where it is read instead of rendering wrong values on
// the sync-conflict and attachment screens.

function clientAnswering(body: unknown, status = 200) {
  const fetchMock: typeof fetch = async () => Response.json(body, { status });
  return createDesktopApiClient({
    baseUrl: "http://127.0.0.1:4317",
    fetch: fetchMock,
    responseValidation: "strict",
  });
}

const attachment = {
  id: "att-1",
  entityType: "job",
  entityId: "1",
  localPath: "job/1/a.pdf",
  contentHash: "abc",
  mimeType: "application/pdf",
  sizeBytes: 10,
  remoteKey: null,
  uploadStatus: "pending",
  createdAt: "2026-05-09T12:00:00.000Z",
  fileUrl: "http://127.0.0.1:4317/api/attachments/att-1",
};

const deadEvent = {
  eventId: "evt-1",
  entityType: "job",
  entityId: "1",
  operation: "update",
  errorCode: "STANDARD_EXPIRED",
  errorMessage: "expired",
  attemptCount: 1,
  occurredAt: "2026-05-09T12:00:00.000Z",
  deadAt: null,
  regulated: false,
};

const syncStatus = {
  state: "idle",
  pendingOutboxCount: 0,
  conflictCount: 0,
  lastSyncedAt: null,
};

describe("desktop client local-server responses", () => {
  it("returns a well-formed attachment list", async () => {
    await expect(
      clientAnswering({ data: [attachment] }).attachments.list(),
    ).resolves.toEqual({ data: [attachment] });
  });

  it("refuses an attachment list whose items lost a field", async () => {
    const { fileUrl: _fileUrl, ...stale } = attachment;
    await expect(
      clientAnswering({ data: [stale] }).attachments.list(),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("refuses an upload answer of the wrong shape", async () => {
    await expect(
      clientAnswering({ id: 7 }, 201).attachments.upload({
        entityType: "job",
        entityId: "1",
        file: new Blob(["x"]),
        fileName: "a.txt",
      }),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("refuses dead-event and conflict lists of the wrong shape", async () => {
    await expect(
      clientAnswering({
        data: [{ eventId: 1 }],
        total: 1,
      }).sync.listDeadEvents(),
    ).rejects.toBeInstanceOf(ResponseContractError);
    await expect(
      clientAnswering({ data: "none" }).sync.listConflicts(),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("parses the discard and requeue answers (event and sync status)", async () => {
    await expect(
      clientAnswering({ data: deadEvent, syncStatus }).sync.discardDeadEvent(
        "evt-1",
      ),
    ).resolves.toMatchObject({ data: { eventId: "evt-1" } });
    await expect(
      clientAnswering({
        data: { eventId: "evt-1" },
        syncStatus,
      }).sync.requeueDeadEvent("evt-1"),
    ).resolves.toMatchObject({ syncStatus: { state: "idle" } });
    await expect(
      clientAnswering({ data: deadEvent }).sync.discardDeadEvent("evt-1"),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });

  it("refuses a session snapshot without its user", async () => {
    await expect(
      clientAnswering({ data: { serverTime: "x" } }).sync.getSession(),
    ).rejects.toBeInstanceOf(ResponseContractError);
  });
});
