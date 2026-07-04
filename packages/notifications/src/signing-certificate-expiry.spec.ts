import { describe, it, expect } from "vitest";

import {
  SIGNING_CERTIFICATE_EXPIRY_LEAD_DAYS,
  daysUntilCalendar,
  decideSigningCertificateExpiryAlert,
} from "./signing-certificate-expiry";

// CMP-02 (issue #645). Pure decider for the ICP-Brasil A1 signing-certificate
// expiry alert — exercised directly (no DB / no mock), with fixed dates under
// TZ=UTC. Reads `validUntil` only; never touches signing crypto.
const NOW = new Date("2026-07-03T08:00:00.000Z");

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("decideSigningCertificateExpiryAlert (CMP-02)", () => {
  describe("REQ-CMP-EXP-001 — within ≤30 days of validUntil → alert", () => {
    it("alerts for a certificate 25 days out (30-day window)", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(25),
        now: NOW,
        alreadyAlertedLeadDays: [],
      });

      expect(decision.shouldAlert).toBe(true);
      expect(decision.leadTimeDays).toBe(30);
      expect(decision.daysUntilExpiry).toBe(25);
    });

    it("alerts at exactly the 30-day boundary", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(30),
        now: NOW,
        alreadyAlertedLeadDays: [],
      });

      expect(decision.shouldAlert).toBe(true);
      expect(decision.leadTimeDays).toBe(30);
    });

    it("escalates into the 15-day window", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(12),
        now: NOW,
        // Already warned at the 30-day window; the 15-day window is fresh.
        alreadyAlertedLeadDays: [30],
      });

      expect(decision.shouldAlert).toBe(true);
      expect(decision.leadTimeDays).toBe(15);
    });

    it("escalates into the 7-day window", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(5),
        now: NOW,
        alreadyAlertedLeadDays: [30, 15],
      });

      expect(decision.shouldAlert).toBe(true);
      expect(decision.leadTimeDays).toBe(7);
    });

    it("still alerts on the last valid day (expires today)", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: NOW,
        now: NOW,
        alreadyAlertedLeadDays: [],
      });

      expect(decision.shouldAlert).toBe(true);
      expect(decision.leadTimeDays).toBe(7);
      expect(decision.daysUntilExpiry).toBe(0);
    });
  });

  describe("REQ-CMP-EXP-003 — outside the window → no notification", () => {
    it("does not alert for a certificate 31 days out (just beyond widest lead)", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(31),
        now: NOW,
        alreadyAlertedLeadDays: [],
      });

      expect(decision.shouldAlert).toBe(false);
      expect(decision.leadTimeDays).toBeNull();
    });

    it("does not alert for a certificate a year out", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(365),
        now: NOW,
        alreadyAlertedLeadDays: [],
      });

      expect(decision.shouldAlert).toBe(false);
    });

    it("does not emit an expiry-warning for an already-expired certificate (CMP-01 territory)", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(-3),
        now: NOW,
        alreadyAlertedLeadDays: [],
      });

      expect(decision.shouldAlert).toBe(false);
      expect(decision.leadTimeDays).toBeNull();
      expect(decision.daysUntilExpiry).toBe(-3);
    });
  });

  describe("REQ-CMP-EXP-002 — idempotent per window (no duplicate on re-run)", () => {
    it("does not re-alert when the current window was already alerted", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(24),
        now: NOW,
        // The 30-day window already fired on a previous cron run.
        alreadyAlertedLeadDays: [30],
      });

      expect(decision.shouldAlert).toBe(false);
      expect(decision.leadTimeDays).toBe(30);
    });

    it("does not re-alert within the 7-day window once fired", () => {
      const decision = decideSigningCertificateExpiryAlert({
        validUntil: daysFromNow(3),
        now: NOW,
        alreadyAlertedLeadDays: [30, 15, 7],
      });

      expect(decision.shouldAlert).toBe(false);
      expect(decision.leadTimeDays).toBe(7);
    });
  });

  describe("daysUntilCalendar — UTC calendar-day stability", () => {
    it("counts whole calendar days regardless of intra-day time", () => {
      const from = new Date("2026-07-03T23:59:00.000Z");
      const target = new Date("2026-07-13T00:01:00.000Z");
      expect(daysUntilCalendar(from, target)).toBe(10);
    });

    it("exposes the escalating lead windows widest-first", () => {
      expect(SIGNING_CERTIFICATE_EXPIRY_LEAD_DAYS).toEqual([30, 15, 7]);
    });
  });
});
