/**
 * sync-attachments.int.spec.ts: P0-5, the cloud half of the offline attachment
 * upload leg, against real Postgres and the real permission middleware (the
 * Better Auth session, the queue and the notifications are faked; the object store
 * is an in-memory fake that enforces the size and type the presign was bound to).
 *
 *   REQ-ATT-1  init-upload refuses a type or size offline capture cannot produce and
 *              binds the presign to the declared size and type
 *   REQ-ATT-2  complete-upload verifies the stored object (HEAD for size and type,
 *              then the SHA-256) before recording it; a missing or different object
 *              is refused, a different one is removed
 *   REQ-ATT-3  an attachment id or key of another laboratory is refused
 *   REQ-ATT-4  a create_local_attachment event is recorded only for a completed,
 *              unchanged blob; otherwise it is refused with a stable code, and an
 *              older protocol is refused for good
 */
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import { organizationEventLog } from "@calibra-facil/db/schema";
import {
  classifyOutboxRejection,
  syncAttachmentInitUploadResponseSchema,
  syncPushResponseSchema,
} from "@calibra-facil/contracts";
import { loginAs } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg } from "../../test/integration/seed";
import { syncRouter } from "./sync";

// An in-memory object store. Hoisted: the vi.mock factory below runs before imports.
const store = vi.hoisted(() => {
  type Stored = { bytes: Uint8Array; contentType: string; etag: string };
  const objects = new Map<string, Stored>();
  const bindings = new Map<
    string,
    { contentType: string; contentLength: number }
  >();
  let revision = 0;
  return {
    objects,
    bindings,
    /** A PUT through the presigned URL: the store refuses what the signature does not allow. */
    put(key: string, bytes: Uint8Array, contentType: string) {
      const binding = bindings.get(key);
      if (
        binding &&
        (binding.contentLength !== bytes.byteLength ||
          binding.contentType !== contentType)
      ) {
        throw new Error("SignatureDoesNotMatch");
      }
      revision += 1;
      objects.set(key, { bytes, contentType, etag: `etag-${revision}` });
    },
    /** A write that bypasses the binding (an object that is already there). */
    plant(key: string, bytes: Uint8Array, contentType: string) {
      revision += 1;
      objects.set(key, { bytes, contentType, etag: `etag-${revision}` });
    },
    reset() {
      objects.clear();
      bindings.clear();
    },
  };
});

vi.mock("../lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/storage")>()),
  createR2Client: () => ({}),
  generateBoundPresignedUploadUrl: async (
    _client: unknown,
    _bucket: string,
    key: string,
    binding: { contentType: string; contentLength: number },
  ) => {
    store.bindings.set(key, binding);
    return `https://store.test/${encodeURIComponent(key)}`;
  },
  headObject: async (_client: unknown, _bucket: string, key: string) => {
    const object = store.objects.get(key);
    return object
      ? {
          sizeBytes: object.bytes.byteLength,
          contentType: object.contentType,
          etag: object.etag,
        }
      : null;
  },
  downloadFromR2: async (_client: unknown, _bucket: string, key: string) => {
    const object = store.objects.get(key);
    if (!object) throw new Error("not found");
    return object.bytes;
  },
  deleteFromR2: async (_client: unknown, _bucket: string, key: string) => {
    store.objects.delete(key);
  },
}));

vi.mock("../lib/background-jobs", () => ({
  enqueueBackgroundJob: vi.fn().mockResolvedValue({ messageId: "test-noop" }),
}));

vi.mock("@calibra-facil/notifications", () => ({
  notifyJobSubmittedForReview: vi.fn().mockResolvedValue(undefined),
  notifyJobApproved: vi.fn().mockResolvedValue(undefined),
  notifyJobRejected: vi.fn().mockResolvedValue(undefined),
  notifyJobAssigned: vi.fn().mockResolvedValue(undefined),
  notifyCertificateAmended: vi.fn().mockResolvedValue(undefined),
  notifyNCCreated: vi.fn().mockResolvedValue(undefined),
}));

const JSON_HEADERS = { "content-type": "application/json" };
const ENV = {
  R2_ACCOUNT_ID: "account",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET_NAME: "bucket",
  R2_MEDIA_BUCKET_NAME: "media",
};

const BYTES = new Uint8Array(2048).fill(9);
const HASH = createHash("sha256").update(BYTES).digest("hex");

type Org = Awaited<ReturnType<typeof seedOrg>>;

function declaration(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: "device-att",
    eventId: "evt-att-1",
    entityType: "asset",
    entityId: "local-asset-1",
    fileName: "photo.jpg",
    contentHash: HASH,
    mimeType: "image/jpeg",
    sizeBytes: BYTES.byteLength,
    ...overrides,
  };
}

async function post(org: Org, path: string, body: unknown) {
  loginAs({ userId: org.userId, organizationId: org.orgId });
  return syncRouter.request(
    path,
    {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify(body),
    },
    ENV,
  );
}

async function init(org: Org, overrides: Record<string, unknown> = {}) {
  const res = await post(
    org,
    "/attachments/init-upload",
    declaration(overrides),
  );
  return { res, body: await res.json().catch(() => null) };
}

async function complete(
  org: Org,
  upload: { attachmentId: string; objectKey: string },
  overrides: Record<string, unknown> = {},
) {
  const res = await post(org, "/attachments/complete-upload", {
    ...declaration(),
    attachmentId: upload.attachmentId,
    objectKey: upload.objectKey,
    ...overrides,
  });
  return { res, body: await res.json() };
}

/** init + PUT + complete for the default declaration. */
async function uploadAndComplete(org: Org) {
  const { body } = await init(org);
  const upload = syncAttachmentInitUploadResponseSchema.parse(body);
  store.put(upload.objectKey, BYTES, "image/jpeg");
  const completed = await complete(org, upload);
  expect(completed.res.status).toBe(200);
  return upload;
}

function attachmentEvent(org: Org, overrides: Record<string, unknown> = {}) {
  return {
    eventId: "evt-att-1",
    entityType: "attachment",
    entityId: "attachment:local-1",
    operation: "create_local_attachment",
    payload: {
      attachmentId: "attachment:local-1",
      entityType: "asset",
      entityId: "local-asset-1",
      localPath: "attachments/asset/local-asset-1/aaaaaaaaaaaaaaaa-uuid.jpg",
      contentHash: HASH,
      mimeType: "image/jpeg",
      sizeBytes: BYTES.byteLength,
    },
    occurredAt: new Date().toISOString(),
    actorUserId: org.userId,
    organizationId: org.orgId,
    unitId: org.unitId,
    idempotencyKey: "idem-evt-att-1",
    localVersion: 0,
    ...overrides,
  };
}

async function push(
  org: Org,
  event: Record<string, unknown>,
  protocolVersion = 4,
) {
  loginAs({ userId: org.userId, organizationId: org.orgId });
  const res = await syncRouter.request(
    "/push",
    {
      method: "POST",
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
      body: JSON.stringify({
        deviceId: "device-att",
        clientBatchId: "batch-att",
        baseCursor: null,
        protocolVersion,
        events: [event],
      }),
    },
    ENV,
  );
  expect(res.status).toBe(200);
  return syncPushResponseSchema.parse(await res.json());
}

/** The audit rows the pushed attachment event wrote (the local attachment id is their entity). */
async function attachmentAuditRows() {
  return db
    .select({ action: organizationEventLog.action })
    .from(organizationEventLog)
    .where(eq(organizationEventLog.entityId, "attachment:local-1"));
}

describe("REQ-ATT: the offline attachment upload leg (cloud)", () => {
  let org: Org;

  beforeEach(async () => {
    await truncateAll();
    store.reset();
    org = await seedOrg({
      orgId: "org-att",
      userId: "user-att",
      role: "admin",
    });
  });

  describe("REQ-ATT-1: init-upload", () => {
    it("binds the presign to the declared size and content type", async () => {
      const { res, body } = await init(org);

      expect(res.status).toBe(200);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);
      expect(store.bindings.get(upload.objectKey)).toEqual({
        contentType: "image/jpeg",
        contentLength: BYTES.byteLength,
      });
      expect(upload.headers).toEqual({ "content-type": "image/jpeg" });

      // The fake store enforces the signature the way S3 does.
      expect(() =>
        store.put(upload.objectKey, new Uint8Array(10), "image/jpeg"),
      ).toThrow("SignatureDoesNotMatch");
      expect(() => store.put(upload.objectKey, BYTES, "image/png")).toThrow(
        "SignatureDoesNotMatch",
      );
    });

    it.each([
      ["image/svg+xml", 422, "sync_attachment_type_not_allowed"],
      ["text/html", 422, "sync_attachment_type_not_allowed"],
      ["application/octet-stream", 422, "sync_attachment_type_not_allowed"],
    ])("refuses %s", async (mimeType, status, code) => {
      const { res, body } = await init(org, { mimeType });

      expect(res.status).toBe(status);
      expect(body.code).toBe(code);
      expect(store.bindings.size).toBe(0);
    });

    it("refuses a file larger than an offline attachment may be", async () => {
      const { res, body } = await init(org, {
        sizeBytes: 25 * 1024 * 1024 + 1,
      });

      expect(res.status).toBe(422);
      expect(body.code).toBe("sync_attachment_too_large");
    });

    it("is denied to a role that cannot start work on the lab's records", async () => {
      const member = await seedOrg({
        orgId: "org-att-m",
        userId: "user-att-m",
        role: "member",
      });

      const { res } = await init(member);

      expect(res.status).toBe(403);
    });
  });

  describe("REQ-ATT-2: complete-upload verifies the stored object", () => {
    it("records a blob whose size, type and SHA-256 match", async () => {
      await uploadAndComplete(org);

      const rows = await db
        .select({ action: organizationEventLog.action })
        .from(organizationEventLog)
        .where(
          eq(organizationEventLog.action, "sync_attachment.upload_completed"),
        );
      expect(rows).toHaveLength(1);
    });

    it("refuses a completion whose blob was never uploaded", async () => {
      const { body } = await init(org);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);

      const { res, body: answer } = await complete(org, upload);

      expect(res.status).toBe(409);
      expect(answer.code).toBe("sync_attachment_not_uploaded");
      expect(classifyOutboxRejection(answer.code.toUpperCase())).toBe(
        "transient",
      );
      const rows = await db
        .select({ id: organizationEventLog.id })
        .from(organizationEventLog)
        .where(
          eq(organizationEventLog.action, "sync_attachment.upload_completed"),
        );
      expect(rows).toEqual([]);
    });

    it("refuses and removes an object of another size", async () => {
      const { body } = await init(org);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);
      store.plant(upload.objectKey, new Uint8Array(100), "image/jpeg");

      const { res, body: answer } = await complete(org, upload);

      expect(res.status).toBe(422);
      expect(answer.code).toBe("sync_attachment_integrity_failed");
      expect(store.objects.has(upload.objectKey)).toBe(false);
    });

    it("refuses and removes an object of another content type", async () => {
      const { body } = await init(org);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);
      store.plant(upload.objectKey, BYTES, "application/pdf");

      const { res, body: answer } = await complete(org, upload);

      expect(res.status).toBe(422);
      expect(answer.code).toBe("sync_attachment_integrity_failed");
      expect(store.objects.has(upload.objectKey)).toBe(false);
    });

    it("refuses and removes an object whose bytes are not the declared SHA-256", async () => {
      const { body } = await init(org);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);
      // Same size and type, different bytes.
      store.plant(
        upload.objectKey,
        new Uint8Array(BYTES.byteLength).fill(1),
        "image/jpeg",
      );

      const { res, body: answer } = await complete(org, upload);

      expect(res.status).toBe(422);
      expect(answer.code).toBe("sync_attachment_integrity_failed");
      expect(store.objects.has(upload.objectKey)).toBe(false);
      const rows = await db
        .select({ id: organizationEventLog.id })
        .from(organizationEventLog)
        .where(
          eq(organizationEventLog.action, "sync_attachment.upload_completed"),
        );
      expect(rows).toEqual([]);
    });

    it("refuses a completion that vouches for a key built from other facts", async () => {
      const { body } = await init(org);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);
      store.put(upload.objectKey, BYTES, "image/jpeg");

      const { res } = await complete(org, upload, {
        contentHash: "b".repeat(64),
      });

      expect(res.status).toBe(400);
    });
  });

  describe("REQ-ATT-3: another laboratory's attachments", () => {
    it("refuses to complete or download a key of another laboratory", async () => {
      const other = await seedOrg({
        orgId: "org-att-b",
        userId: "user-att-b",
        role: "admin",
      });
      const upload = await uploadAndComplete(other);

      const completion = await complete(org, upload);
      expect(completion.res.status).toBe(400);

      loginAs({ userId: org.userId, organizationId: org.orgId });
      const download = await syncRouter.request(
        `/attachments/${upload.attachmentId}/download`,
        { headers: { "x-active-unit-id": String(org.unitId) } },
        ENV,
      );
      expect(download.status).toBe(400);
    });
  });

  describe("REQ-ATT-4: the create_local_attachment event", () => {
    it("is refused, and nothing is recorded, while the blob was never completed", async () => {
      const answer = await push(org, attachmentEvent(org));

      expect(answer.accepted).toEqual([]);
      expect(answer.rejected).toEqual([
        expect.objectContaining({
          eventId: "evt-att-1",
          code: "SYNC_ATTACHMENT_NOT_UPLOADED",
        }),
      ]);
      expect(await attachmentAuditRows()).toEqual([]);
    });

    it("is refused when the blob was uploaded but its completion never happened", async () => {
      const { body } = await init(org);
      const upload = syncAttachmentInitUploadResponseSchema.parse(body);
      store.put(upload.objectKey, BYTES, "image/jpeg");

      const answer = await push(org, attachmentEvent(org));

      expect(answer.rejected[0]?.code).toBe("SYNC_ATTACHMENT_NOT_UPLOADED");
      expect(answer.accepted).toEqual([]);
    });

    it("is recorded once the blob is completed, and acknowledges the object key", async () => {
      const upload = await uploadAndComplete(org);

      const answer = await push(org, attachmentEvent(org));

      expect(answer.rejected).toEqual([]);
      expect(answer.accepted).toEqual([
        expect.objectContaining({
          eventId: "evt-att-1",
          remoteEntityId: upload.objectKey,
        }),
      ]);
      const audit = await attachmentAuditRows();
      expect(audit.map((row) => row.action)).toEqual([
        "desktop_sync.create_local_attachment",
      ]);
    });

    it("is refused for good when the object was overwritten after its completion", async () => {
      const upload = await uploadAndComplete(org);
      // The presigned URL is still valid: same size and type, other bytes.
      store.put(
        upload.objectKey,
        new Uint8Array(BYTES.byteLength),
        "image/jpeg",
      );

      const answer = await push(org, attachmentEvent(org));

      expect(answer.accepted).toEqual([]);
      expect(answer.rejected[0]?.code).toBe("SYNC_ATTACHMENT_INTEGRITY_FAILED");
      expect(classifyOutboxRejection("SYNC_ATTACHMENT_INTEGRITY_FAILED")).toBe(
        "permanent",
      );
    });

    it("acknowledges a retry of an applied event without looking at the store again", async () => {
      await uploadAndComplete(org);
      await push(org, attachmentEvent(org));
      store.reset();

      const retry = await push(org, attachmentEvent(org));

      expect(retry.rejected).toEqual([]);
      expect(retry.accepted).toHaveLength(1);
    });

    it("is refused for good for a type or size offline capture cannot produce", async () => {
      const svg = await push(
        org,
        attachmentEvent(org, {
          eventId: "evt-att-svg",
          idempotencyKey: "idem-svg",
          payload: {
            ...attachmentEvent(org).payload,
            mimeType: "image/svg+xml",
          },
        }),
      );
      expect(svg.rejected[0]?.code).toBe("SYNC_ATTACHMENT_TYPE_NOT_ALLOWED");

      const huge = await push(
        org,
        attachmentEvent(org, {
          eventId: "evt-att-huge",
          idempotencyKey: "idem-huge",
          payload: {
            ...attachmentEvent(org).payload,
            sizeBytes: 26 * 1024 * 1024,
          },
        }),
      );
      expect(huge.rejected[0]?.code).toBe("SYNC_ATTACHMENT_TOO_LARGE");
      expect(classifyOutboxRejection("SYNC_ATTACHMENT_TYPE_NOT_ALLOWED")).toBe(
        "permanent",
      );
    });

    it("from a desktop that predates the upload leg is refused for good, whatever the store holds", async () => {
      await uploadAndComplete(org);

      const answer = await push(org, attachmentEvent(org), 3);

      expect(answer.accepted).toEqual([]);
      expect(answer.rejected[0]?.code).toBe(
        "SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED",
      );
      expect(
        classifyOutboxRejection("SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED"),
      ).toBe("permanent");
    });
  });
});
