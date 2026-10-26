import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySyncPushResult,
  createLocalAttachment,
  getLocalAttachment,
  listDeadOutboxEvents,
  listPendingOutboxEvents,
  localDbMigrations,
  markAttachmentUploadDead,
  markAttachmentUploaded,
  openLocalDatabase,
  requeueDeadOutboxEvent,
  runLocalMigrations,
  type LocalDatabase,
} from "./index";

/**
 * The local store of the attachment upload leg (REQ-ATT-5): an attachment is
 * `synced` only after the cloud holds its file, a refusal leaves it dead (or
 * pending again), and an install that was told "synced" for a file that never
 * left the laptop gets that file queued again.
 */
const tempDirectories: string[] = [];

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function openDatabase() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "calibra-att-leg-"));
  tempDirectories.push(directory);
  return openLocalDatabase({ filePath: path.join(directory, "local.sqlite") });
}

function capture(database: LocalDatabase) {
  const attachment = createLocalAttachment(database, {
    entityType: "asset",
    entityId: "asset:1",
    localPath: "attachments/asset/asset-1/abc.jpg",
    contentHash: "a".repeat(64),
    mimeType: "image/jpeg",
    sizeBytes: 10,
    actorUserId: "user-1",
    deviceId: "device-1",
  });
  const [event] = listPendingOutboxEvents(database, 10);
  if (!event) throw new Error("no queued event");
  return { attachment, event };
}

function accept(
  database: LocalDatabase,
  eventId: string,
  remoteEntityId?: string,
) {
  applySyncPushResult(database, {
    accepted: [
      {
        eventId,
        remoteVersion: 1,
        cloudEventId: `cloud:${eventId}`,
        ...(remoteEntityId === undefined ? {} : { remoteEntityId }),
      },
    ],
    rejected: [],
    conflicts: [],
  });
}

function reject(database: LocalDatabase, eventId: string, code: string) {
  applySyncPushResult(database, {
    accepted: [],
    rejected: [{ eventId, code, reason: "refused" }],
    conflicts: [],
  });
}

describe("REQ-ATT-5: attachment upload state", () => {
  it("a new attachment is pending with no remote key", () => {
    const database = openDatabase();
    const { attachment } = capture(database);

    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
  });

  it("is synced only after the upload recorded a remote key", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);

    markAttachmentUploaded(database, attachment.id, "org/o/sync-attachments/k");
    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "uploaded",
      remoteKey: "org/o/sync-attachments/k",
    });

    accept(database, event.eventId);
    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: "org/o/sync-attachments/k",
    });
  });

  it("an acknowledgement alone never makes an attachment without a remote key synced", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);

    // An older cloud acknowledged the event without ever having the file.
    accept(database, event.eventId);

    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
  });

  it("takes the remote key from the acknowledgement when the cloud names it", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);

    accept(database, event.eventId, "org/o/sync-attachments/from-cloud");

    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: "org/o/sync-attachments/from-cloud",
    });
  });

  it("a cloud that does not confirm the file sets the attachment back to pending", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);
    markAttachmentUploaded(database, attachment.id, "org/o/sync-attachments/k");

    reject(database, event.eventId, "SYNC_ATTACHMENT_NOT_UPLOADED");

    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
    expect(listDeadOutboxEvents(database)).toEqual([]);
  });

  it("a permanent refusal leaves the attachment and its event dead, and re-queueing starts over", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);
    markAttachmentUploaded(database, attachment.id, "org/o/sync-attachments/k");

    reject(database, event.eventId, "SYNC_ATTACHMENT_INTEGRITY_FAILED");

    expect(getLocalAttachment(database, attachment.id)?.uploadStatus).toBe(
      "dead",
    );
    expect(listDeadOutboxEvents(database)).toEqual([
      expect.objectContaining({
        eventId: event.eventId,
        errorCode: "SYNC_ATTACHMENT_INTEGRITY_FAILED",
      }),
    ]);

    expect(requeueDeadOutboxEvent(database, event.eventId)).toBe(true);
    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
  });

  it("markAttachmentUploadDead parks the attachment and its event with the code", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);

    markAttachmentUploadDead(database, {
      attachmentId: attachment.id,
      eventId: event.eventId,
      code: "ATTACHMENT_FILE_MISSING",
      message: "gone",
    });

    expect(getLocalAttachment(database, attachment.id)?.uploadStatus).toBe(
      "dead",
    );
    expect(listPendingOutboxEvents(database, 10)).toEqual([]);
    expect(listDeadOutboxEvents(database)).toEqual([
      expect.objectContaining({
        errorCode: "ATTACHMENT_FILE_MISSING",
        errorMessage: "gone",
      }),
    ]);
  });

  it("a synced attachment cannot be moved back to dead or uploaded", () => {
    const database = openDatabase();
    const { attachment, event } = capture(database);
    markAttachmentUploaded(database, attachment.id, "org/o/sync-attachments/k");
    accept(database, event.eventId);

    expect(markAttachmentUploaded(database, attachment.id, "other")).toBe(
      false,
    );
    markAttachmentUploadDead(database, {
      attachmentId: attachment.id,
      eventId: event.eventId,
      code: "ATTACHMENT_FILE_MISSING",
      message: "gone",
    });
    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: "org/o/sync-attachments/k",
    });
  });
});

describe("migration 24: files an older build called synced but never uploaded", () => {
  function databaseBefore24() {
    const database = openDatabase();
    // Roll the schema back to what an install of the previous build has.
    database.exec("DELETE FROM local_schema_migrations WHERE id = 24");
    return database;
  }

  it("queues each such attachment again, with the original author and device", () => {
    const database = databaseBefore24();
    const { attachment, event } = capture(database);
    // The old behaviour: the event was acknowledged and the attachment marked synced
    // with no remote key.
    accept(database, event.eventId);
    database
      .prepare(
        "UPDATE attachments SET upload_status = 'synced', remote_key = NULL WHERE id = @id",
      )
      .run({ id: attachment.id });

    runLocalMigrations(database);

    expect(getLocalAttachment(database, attachment.id)).toMatchObject({
      uploadStatus: "pending",
      remoteKey: null,
    });
    const queued = listPendingOutboxEvents(database, 10);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      operation: "create_local_attachment",
      entityType: "attachment",
      entityId: attachment.id,
      actorUserId: "user-1",
      deviceId: "device-1",
      payload: {
        attachmentId: attachment.id,
        entityType: "asset",
        entityId: "asset:1",
        localPath: "attachments/asset/asset-1/abc.jpg",
        contentHash: "a".repeat(64),
        mimeType: "image/jpeg",
        sizeBytes: 10,
      },
    });
    expect(queued[0]?.eventId).not.toBe(event.eventId);
  });

  it("leaves a synced attachment that has a remote key, and one already queued, alone", () => {
    const database = databaseBefore24();
    const uploaded = capture(database);
    markAttachmentUploaded(
      database,
      uploaded.attachment.id,
      "org/o/sync-attachments/k",
    );
    accept(database, uploaded.event.eventId);
    const pending = capture(database);

    runLocalMigrations(database);

    expect(getLocalAttachment(database, uploaded.attachment.id)).toMatchObject({
      uploadStatus: "synced",
      remoteKey: "org/o/sync-attachments/k",
    });
    const queued = listPendingOutboxEvents(database, 10);
    expect(queued.map((queuedEvent) => queuedEvent.eventId)).toEqual([
      pending.event.eventId,
    ]);
  });

  it("is registered under id 24 and runs once", () => {
    expect(localDbMigrations.some((migration) => migration.id === 24)).toBe(
      true,
    );
    const database = openDatabase();
    runLocalMigrations(database);
    expect(
      database
        .prepare<
          [],
          { total: number }
        >("SELECT COUNT(*) AS total FROM local_schema_migrations WHERE id = 24")
        .get()?.total,
    ).toBe(1);
  });
});
