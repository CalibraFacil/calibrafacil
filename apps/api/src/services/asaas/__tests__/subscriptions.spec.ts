import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  formatAsaasDate,
  calculateNextBillingDate,
  calculatePeriodEnd,
} from "../subscriptions";

describe("Asaas Subscriptions Helpers", () => {
  describe("formatAsaasDate", () => {
    it("should format date as YYYY-MM-DD", () => {
      // Use a date with explicit UTC time to get consistent toISOString() output
      const date = new Date(Date.UTC(2024, 0, 15, 10, 30, 0));
      const result = formatAsaasDate(date);
      expect(result).toBe("2024-01-15");
    });

    it("should handle single digit months and days", () => {
      const date = new Date(Date.UTC(2024, 4, 3, 0, 0, 0));
      const result = formatAsaasDate(date);
      expect(result).toBe("2024-05-03");
    });

    it("should handle year boundaries", () => {
      const date = new Date(Date.UTC(2024, 11, 31, 23, 59, 59));
      const result = formatAsaasDate(date);
      expect(result).toBe("2024-12-31");
    });

    it("should handle leap year dates", () => {
      const date = new Date(Date.UTC(2024, 1, 29, 12, 0, 0));
      const result = formatAsaasDate(date);
      expect(result).toBe("2024-02-29");
    });
  });

  describe("calculateNextBillingDate", () => {
    it("should add one month for MONTHLY cycle", () => {
      // Use local dates since the function uses local timezone methods
      const startDate = new Date(2024, 0, 15); // Jan 15, 2024
      const result = calculateNextBillingDate(startDate, "MONTHLY");

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(1); // February (0-indexed)
      expect(result.getDate()).toBe(15);
    });

    it("should add one year for YEARLY cycle", () => {
      const startDate = new Date(2024, 0, 15); // Jan 15, 2024
      const result = calculateNextBillingDate(startDate, "YEARLY");

      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(15);
    });

    it("should handle month-end edge case for MONTHLY", () => {
      // January 31 + 1 month = February 28/29, which overflows to March
      const startDate = new Date(2024, 0, 31); // Jan 31, 2024
      const result = calculateNextBillingDate(startDate, "MONTHLY");

      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(2); // March (JS wraps 31 Feb to Mar 2)
    });

    it("should handle year boundary for MONTHLY", () => {
      const startDate = new Date(2024, 11, 15); // Dec 15, 2024
      const result = calculateNextBillingDate(startDate, "MONTHLY");

      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(15);
    });

    it("should handle leap year for YEARLY", () => {
      const startDate = new Date(2024, 1, 29); // Feb 29, 2024
      const result = calculateNextBillingDate(startDate, "YEARLY");

      expect(result.getFullYear()).toBe(2025);
      // Feb 29 2024 + 1 year = Mar 1 2025 (no Feb 29 in 2025)
      expect(result.getMonth()).toBe(2); // March
      expect(result.getDate()).toBe(1);
    });

    it("should not modify original date", () => {
      const startDate = new Date(2024, 0, 15);
      const originalTime = startDate.getTime();

      calculateNextBillingDate(startDate, "MONTHLY");

      expect(startDate.getTime()).toBe(originalTime);
    });
  });

  describe("calculatePeriodEnd", () => {
    it("should calculate period end for MONTHLY cycle", () => {
      const startDate = new Date(2024, 0, 15); // Jan 15, 2024
      const result = calculatePeriodEnd(startDate, "MONTHLY");

      // Should be Feb 14 (one month minus one day)
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(1); // February
      expect(result.getDate()).toBe(14);
    });

    it("should calculate period end for YEARLY cycle", () => {
      const startDate = new Date(2024, 0, 15); // Jan 15, 2024
      const result = calculatePeriodEnd(startDate, "YEARLY");

      // Should be Jan 14, 2025 (one year minus one day)
      expect(result.getFullYear()).toBe(2025);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(14);
    });

    it("should handle first of month for MONTHLY", () => {
      const startDate = new Date(2024, 0, 1); // Jan 1, 2024
      const result = calculatePeriodEnd(startDate, "MONTHLY");

      // Jan 1 + 1 month = Feb 1, then -1 day = Jan 31
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0); // January
      expect(result.getDate()).toBe(31);
    });

    it("should handle last day of month for MONTHLY", () => {
      const startDate = new Date(2024, 0, 31); // Jan 31, 2024
      const result = calculatePeriodEnd(startDate, "MONTHLY");

      // Jan 31 + 1 month = Mar 2 (Feb overflow), then -1 day = Mar 1
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(2); // March
      expect(result.getDate()).toBe(1);
    });

    it("should not modify original date", () => {
      const startDate = new Date(2024, 0, 15);
      const originalTime = startDate.getTime();

      calculatePeriodEnd(startDate, "MONTHLY");

      expect(startDate.getTime()).toBe(originalTime);
    });
  });
});

// Note: Service function tests that call the API client would require
// mocking getAsaasClient(). These are better tested as integration tests
// or with the actual mock setup in the checkout tests.
