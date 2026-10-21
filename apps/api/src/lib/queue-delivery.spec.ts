import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_BACKGROUND_JOB_DELIVERIES,
  readMaxBackgroundJobDeliveries,
  vercelDeliveryAttempt,
  vercelRetryDirective,
} from "./queue-delivery";

describe("Vercel Queue delivery attempt", () => {
  it("maps deliveryCount to the worker's attempt, with the default ceiling", () => {
    expect(vercelDeliveryAttempt(1, 3)).toEqual({ attempt: 1, maxAttempts: 3 });
    expect(vercelDeliveryAttempt(3, 3)).toEqual({ attempt: 3, maxAttempts: 3 });
  });

  // Changed from "treats a missing or invalid deliveryCount as the first
  // delivery": that guess could leave a failed certificate in GENERATING_PDF
  // forever, because no delivery was ever recognised as the last. Fail closed.
  it("treats a missing or invalid deliveryCount as the FINAL delivery (fail closed)", () => {
    for (const bad of [0, -1, 1.5, Number.NaN, undefined]) {
      expect(vercelDeliveryAttempt(bad, 3)).toEqual({
        attempt: 3,
        maxAttempts: 3,
      });
    }
  });

  it("reads the ceiling from BACKGROUND_JOBS_MAX_DELIVERIES and falls back to the default", () => {
    expect(readMaxBackgroundJobDeliveries("5")).toBe(5);
    expect(readMaxBackgroundJobDeliveries(undefined)).toBe(
      DEFAULT_MAX_BACKGROUND_JOB_DELIVERIES,
    );
    expect(readMaxBackgroundJobDeliveries("0")).toBe(
      DEFAULT_MAX_BACKGROUND_JOB_DELIVERIES,
    );
    expect(readMaxBackgroundJobDeliveries("abc")).toBe(
      DEFAULT_MAX_BACKGROUND_JOB_DELIVERIES,
    );
  });
});

describe("Vercel Queue retry directive (the ceiling the platform lacks)", () => {
  it("redelivers with exponential backoff before the ceiling", () => {
    expect(vercelRetryDirective({ deliveryCount: 1 }, 3)).toEqual({
      afterSeconds: 30,
    });
    expect(vercelRetryDirective({ deliveryCount: 2 }, 3)).toEqual({
      afterSeconds: 60,
    });
  });

  it("acknowledges the message after the final delivery, so the platform stops redelivering", () => {
    expect(vercelRetryDirective({ deliveryCount: 3 }, 3)).toEqual({
      acknowledge: true,
    });
    expect(vercelRetryDirective({ deliveryCount: 7 }, 3)).toEqual({
      acknowledge: true,
    });
  });

  it("acknowledges when deliveryCount is missing or invalid (fail closed)", () => {
    expect(vercelRetryDirective({ deliveryCount: undefined }, 3)).toEqual({
      acknowledge: true,
    });
    expect(vercelRetryDirective({ deliveryCount: Number.NaN }, 3)).toEqual({
      acknowledge: true,
    });
  });

  it("agrees with the worker's view of which delivery is the last", () => {
    for (const count of [1, 2, 3, 4]) {
      const { attempt, maxAttempts } = vercelDeliveryAttempt(count, 3);
      const final = attempt >= maxAttempts;
      expect(
        "acknowledge" in vercelRetryDirective({ deliveryCount: count }, 3),
      ).toBe(final);
    }
  });

  it("never consumes the ceiling for a held receipt lease: retries later even past the ceiling", () => {
    expect(
      vercelRetryDirective({ deliveryCount: 3, leaseHeld: true }, 3),
    ).toEqual({ afterSeconds: 60 });
  });
});
