import { describe, expect, it } from "vitest";
import { DrizzleQueryError } from "drizzle-orm";
import {
  TransientWebhookError,
  isTransientWebhookError,
} from "../webhook-errors";

// REQ-REL-ASA-001 (classifier half): the webhook handler returns non-2xx ONLY
// for TRANSIENT processing failures (so ASAAS retries the delivery) — NOT for
// permanent/unprocessable ones. ASAAS's sync queue is SEQUENTIAL and PAUSES
// after 15 consecutive non-2xx responses (docs.asaas.com/docs/about-webhooks),
// so mis-labelling a permanent error as transient would poison the whole queue.
// This suite pins the transient-vs-permanent classification for the real error
// shapes the reconcile path can surface (postgres-js SQLSTATEs, node network
// errno, and the wrapped DrizzleQueryError whose real code lives on `.cause`).
describe("isTransientWebhookError", () => {
  describe("REQ-REL-ASA-001: transient (retryable) errors → true", () => {
    it("REQ-REL-ASA-001 a TransientWebhookError marker is transient", () => {
      expect(
        isTransientWebhookError(new TransientWebhookError("db pool exhausted")),
      ).toBe(true);
    });

    it("REQ-REL-ASA-001 postgres connection-exception SQLSTATE (class 08) is transient", () => {
      for (const code of ["08000", "08003", "08006", "08001", "08004"]) {
        expect(isTransientWebhookError({ code })).toBe(true);
      }
    });

    it("REQ-REL-ASA-001 postgres insufficient-resources / admin-shutdown / cannot-connect are transient", () => {
      for (const code of ["53300", "57P01", "57P02", "57P03", "57014"]) {
        expect(isTransientWebhookError({ code })).toBe(true);
      }
    });

    it("REQ-REL-ASA-001 postgres deadlock / serialization / lock-not-available are transient", () => {
      for (const code of ["40001", "40P01", "55P03"]) {
        expect(isTransientWebhookError({ code })).toBe(true);
      }
    });

    it("REQ-REL-ASA-001 node network errno (ECONNREFUSED/ETIMEDOUT/ECONNRESET/EPIPE/EAI_AGAIN) is transient", () => {
      for (const code of [
        "ECONNREFUSED",
        "ETIMEDOUT",
        "ECONNRESET",
        "EPIPE",
        "EAI_AGAIN",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_SOCKET",
      ]) {
        expect(isTransientWebhookError({ code })).toBe(true);
      }
    });

    it("REQ-REL-ASA-001 a transient code carried on `.cause` (DrizzleQueryError wrapper) is transient", () => {
      // postgres-js wraps the driver error in DrizzleQueryError; the real code is
      // on `.cause` — mirror the unwrap that isUniqueConstraintError already does.
      const cause = Object.assign(new Error("connection terminated"), {
        code: "08006",
      });
      const wrapped = new DrizzleQueryError("insert ...", [], cause);
      expect(isTransientWebhookError(wrapped)).toBe(true);
    });

    it("REQ-REL-ASA-001 an undici/fetch network TypeError is transient", () => {
      const fetchFailure = new TypeError("fetch failed");
      expect(isTransientWebhookError(fetchFailure)).toBe(true);
    });
  });

  describe("REQ-REL-ASA-001: permanent (non-retryable) errors → false", () => {
    it("REQ-REL-ASA-001 a unique-violation (23505) is NOT transient", () => {
      expect(isTransientWebhookError({ code: "23505" })).toBe(false);
      expect(isTransientWebhookError({ cause: { code: "23505" } })).toBe(false);
    });

    it("REQ-REL-ASA-001 not-null / FK / check violations are NOT transient", () => {
      for (const code of ["23502", "23503", "23514"]) {
        expect(isTransientWebhookError({ code })).toBe(false);
      }
    });

    it("REQ-REL-ASA-001 a plain application Error is NOT transient", () => {
      expect(isTransientWebhookError(new Error("oferta não encontrada"))).toBe(
        false,
      );
    });

    it("REQ-REL-ASA-001 null / undefined / primitives are NOT transient", () => {
      expect(isTransientWebhookError(null)).toBe(false);
      expect(isTransientWebhookError(undefined)).toBe(false);
      expect(isTransientWebhookError("08006")).toBe(false);
      expect(isTransientWebhookError(42)).toBe(false);
      expect(isTransientWebhookError({})).toBe(false);
    });
  });
});
