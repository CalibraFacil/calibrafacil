import { describe, expect, it } from "vitest";
import {
  LOCAL_OUTBOX_FAILURE_CLASSES,
  PERMANENT_OUTBOX_REJECTION_CODES,
  SYNC_ATTACHMENT_ALLOWED_MIME_TYPES,
  SYNC_ATTACHMENT_MAX_BYTES,
  SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION,
  SYNC_PROTOCOL_VERSION,
  classifyOutboxRejection,
  normalizeSyncAttachmentMimeType,
} from "./index";

describe("REQ-ATT-1: what an offline attachment may be", () => {
  it.each(SYNC_ATTACHMENT_ALLOWED_MIME_TYPES)("accepts %s", (mimeType) => {
    expect(normalizeSyncAttachmentMimeType(mimeType)).toBe(mimeType);
  });

  it("normalizes case and surrounding space, as the presign signs it", () => {
    expect(normalizeSyncAttachmentMimeType(" Image/JPEG ")).toBe("image/jpeg");
  });

  it.each([
    "image/svg+xml",
    "text/html",
    "application/octet-stream",
    "application/javascript",
    "image/jpeg; charset=binary",
    "",
  ])("refuses %j", (mimeType) => {
    expect(normalizeSyncAttachmentMimeType(mimeType)).toBeNull();
  });

  it("caps a file at 25 MiB", () => {
    expect(SYNC_ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("REQ-ATT-4: the codes of the upload leg", () => {
  it.each([
    "SYNC_ATTACHMENT_TYPE_NOT_ALLOWED",
    "SYNC_ATTACHMENT_TOO_LARGE",
    "SYNC_ATTACHMENT_INTEGRITY_FAILED",
    "SYNC_ATTACHMENT_UPLOAD_UNSUPPORTED",
    "SYNC_PERMISSION_DENIED",
  ])("%s is permanent: the desktop dead-letters it", (code) => {
    expect(classifyOutboxRejection(code)).toBe("permanent");
    expect(PERMANENT_OUTBOX_REJECTION_CODES).toContain(code);
  });

  it("a blob the cloud does not confirm is transient: the desktop uploads again", () => {
    expect(classifyOutboxRejection("SYNC_ATTACHMENT_NOT_UPLOADED")).toBe(
      "transient",
    );
  });

  it("the failures the desktop records itself are permanent", () => {
    for (const code of Object.keys(LOCAL_OUTBOX_FAILURE_CLASSES)) {
      expect(classifyOutboxRejection(code), code).toBe("permanent");
      expect(PERMANENT_OUTBOX_REJECTION_CODES, code).toContain(code);
    }
  });

  it("the upload leg is the protocol this build speaks", () => {
    expect(SYNC_PROTOCOL_VERSION).toBe(SYNC_ATTACHMENT_UPLOAD_PROTOCOL_VERSION);
  });
});
