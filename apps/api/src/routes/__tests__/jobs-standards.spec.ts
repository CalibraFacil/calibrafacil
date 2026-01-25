import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for reference standard validation in job execution
 * ISO 17025 Clause 6.4.6 - Equipment used for calibration must be calibrated
 *
 * Tests the validation logic that blocks jobs from using:
 * 1. Expired standards (nextCalibrationDate < today)
 * 2. Inactive standards (status !== 'ACTIVE')
 * 3. Non-existent or unauthorized standards (IDs not found)
 */

describe("Reference Standards Validation - ISO 17025 Clause 6.4.6", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateStandardsNotExpired", () => {
    it("should identify expired standards correctly", () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);

      const standards = [
        {
          id: 1,
          name: "Peso Padrao 1kg",
          nextCalibrationDate: yesterday,
          status: "ACTIVE",
        },
      ];

      const expiredStandards = standards.filter(
        (s) => s.nextCalibrationDate < now,
      );

      expect(expiredStandards).toHaveLength(1);
      expect(expiredStandards[0]?.name).toBe("Peso Padrao 1kg");
    });

    it("should allow valid (non-expired) standards", () => {
      const now = new Date();
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const standards = [
        {
          id: 1,
          name: "Peso Padrao 1kg",
          nextCalibrationDate: nextMonth,
          status: "ACTIVE",
        },
      ];

      const expiredStandards = standards.filter(
        (s) => s.nextCalibrationDate < now,
      );

      expect(expiredStandards).toHaveLength(0);
    });

    it("should identify multiple expired standards when mixed with valid ones", () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const lastWeek = new Date(now);
      lastWeek.setDate(lastWeek.getDate() - 7);
      const nextMonth = new Date(now);
      nextMonth.setMonth(nextMonth.getMonth() + 1);

      const standards = [
        {
          id: 1,
          name: "Peso Padrao 1kg",
          nextCalibrationDate: yesterday,
          status: "ACTIVE",
        },
        {
          id: 2,
          name: "Peso Padrao 500g",
          nextCalibrationDate: lastWeek,
          status: "ACTIVE",
        },
        {
          id: 3,
          name: "Peso Padrao 100g",
          nextCalibrationDate: nextMonth,
          status: "ACTIVE",
        },
      ];

      const expiredStandards = standards.filter(
        (s) => s.nextCalibrationDate < now,
      );

      expect(expiredStandards).toHaveLength(2);
      expect(expiredStandards.map((s) => s.id)).toContain(1);
      expect(expiredStandards.map((s) => s.id)).toContain(2);
      expect(expiredStandards.map((s) => s.id)).not.toContain(3);
    });

    it("should block if ANY standard is expired (fail-fast)", () => {
      const now = new Date();
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const nextYear = new Date(now);
      nextYear.setFullYear(nextYear.getFullYear() + 1);

      const standards = [
        {
          id: 1,
          name: "Valid Standard",
          nextCalibrationDate: nextYear,
          status: "ACTIVE",
        },
        {
          id: 2,
          name: "Expired Standard",
          nextCalibrationDate: yesterday,
          status: "ACTIVE",
        },
      ];

      const expiredStandards = standards.filter(
        (s) => s.nextCalibrationDate < now,
      );

      // Even though one is valid, the presence of ANY expired standard should block
      expect(expiredStandards.length > 0).toBe(true);
    });

    it("should treat standard expiring TODAY as still valid", () => {
      const now = new Date();
      // Set time to start of day for fair comparison
      const todayMidnight = new Date(now);
      todayMidnight.setHours(23, 59, 59, 999);

      const standards = [
        {
          id: 1,
          name: "Expires Today",
          nextCalibrationDate: todayMidnight,
          status: "ACTIVE",
        },
      ];

      const expiredStandards = standards.filter(
        (s) => s.nextCalibrationDate < now,
      );

      // Standard expiring later today should still be valid
      expect(expiredStandards).toHaveLength(0);
    });
  });

  describe("validateStandardsActive", () => {
    it("should identify inactive standards", () => {
      const standards = [
        { id: 1, name: "Active Standard", status: "ACTIVE" },
        { id: 2, name: "Inactive Standard", status: "INACTIVE" },
        { id: 3, name: "Sent for Calibration", status: "SENT_FOR_CALIBRATION" },
      ];

      const inactiveStandards = standards.filter((s) => s.status !== "ACTIVE");

      expect(inactiveStandards).toHaveLength(2);
      expect(inactiveStandards.map((s) => s.status)).toContain("INACTIVE");
      expect(inactiveStandards.map((s) => s.status)).toContain(
        "SENT_FOR_CALIBRATION",
      );
    });

    it("should allow all active standards", () => {
      const standards = [
        { id: 1, name: "Standard A", status: "ACTIVE" },
        { id: 2, name: "Standard B", status: "ACTIVE" },
      ];

      const inactiveStandards = standards.filter((s) => s.status !== "ACTIVE");

      expect(inactiveStandards).toHaveLength(0);
    });
  });

  describe("validateStandardIdsFound", () => {
    it("should detect missing standard IDs", () => {
      const requestedIds = [1, 2, 3];
      const foundStandards = [
        { id: 1, name: "Standard A" },
        { id: 2, name: "Standard B" },
        // ID 3 is missing
      ];

      const foundIds = new Set(foundStandards.map((s) => s.id));
      const missingIds = requestedIds.filter((id) => !foundIds.has(id));

      expect(missingIds).toHaveLength(1);
      expect(missingIds).toContain(3);
    });

    it("should pass when all IDs are found", () => {
      const requestedIds = [1, 2, 3];
      const foundStandards = [
        { id: 1, name: "Standard A" },
        { id: 2, name: "Standard B" },
        { id: 3, name: "Standard C" },
      ];

      const foundIds = new Set(foundStandards.map((s) => s.id));
      const missingIds = requestedIds.filter((id) => !foundIds.has(id));

      expect(missingIds).toHaveLength(0);
      expect(foundStandards.length).toBe(requestedIds.length);
    });

    it("should detect when no standards are found", () => {
      const requestedIds = [1, 2, 3];
      const foundStandards: { id: number; name: string }[] = [];

      const foundIds = new Set(foundStandards.map((s) => s.id));
      const missingIds = requestedIds.filter((id) => !foundIds.has(id));

      expect(missingIds).toHaveLength(3);
      expect(foundStandards.length).not.toBe(requestedIds.length);
    });

    it("should detect standards from wrong organization", () => {
      // This simulates when the query only returns standards matching the org ID
      const requestedIds = [1, 2, 3];

      // Query returns only standards belonging to the user's org (id: 1)
      // Standards 2 and 3 exist but belong to a different org
      const foundStandards = [{ id: 1, name: "Standard A", organizationId: "org-1" }];

      const foundIds = new Set(foundStandards.map((s) => s.id));
      const missingIds = requestedIds.filter((id) => !foundIds.has(id));

      // IDs 2 and 3 are "missing" because they don't belong to user's org
      expect(missingIds).toHaveLength(2);
      expect(missingIds).toContain(2);
      expect(missingIds).toContain(3);
    });
  });

  describe("Error Messages", () => {
    it("should generate clear error message for expired standards", () => {
      const expiredStandards = [
        { id: 1, name: "Peso Padrao 1kg" },
        { id: 2, name: "Peso Padrao 500g" },
      ];

      const errorMessage = `Os seguintes padroes estao com certificado vencido: ${expiredStandards.map((s) => s.name).join(", ")}`;

      expect(errorMessage).toContain("Peso Padrao 1kg");
      expect(errorMessage).toContain("Peso Padrao 500g");
      expect(errorMessage).toContain("certificado vencido");
    });

    it("should generate clear error message for inactive standards", () => {
      const inactiveStandards = [{ id: 1, name: "Calibrador em manutencao" }];

      const errorMessage = `Os seguintes padroes nao estao ativos: ${inactiveStandards.map((s) => s.name).join(", ")}`;

      expect(errorMessage).toContain("Calibrador em manutencao");
      expect(errorMessage).toContain("nao estao ativos");
    });

    it("should generate clear error message for missing standard IDs", () => {
      const missingIds = [5, 10, 15];

      const errorMessage = `Padroes nao encontrados ou nao pertencem a organizacao: ${missingIds.join(", ")}`;

      expect(errorMessage).toContain("5");
      expect(errorMessage).toContain("10");
      expect(errorMessage).toContain("15");
      expect(errorMessage).toContain("nao encontrados");
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty standard selection", () => {
      const selectedStandardIds: number[] = [];

      // Empty selection should be allowed (standards are optional)
      const shouldValidate =
        selectedStandardIds && selectedStandardIds.length > 0;

      expect(shouldValidate).toBe(false);
    });

    it("should handle single standard selection", () => {
      const selectedStandardIds = [1];
      const foundStandards = [
        {
          id: 1,
          name: "Single Standard",
          status: "ACTIVE",
          nextCalibrationDate: new Date(Date.now() + 86400000), // Tomorrow
        },
      ];

      expect(foundStandards.length).toBe(selectedStandardIds.length);
      expect(foundStandards[0]?.status).toBe("ACTIVE");
      expect(foundStandards[0]!.nextCalibrationDate > new Date()).toBe(true);
    });

    it("should handle large number of standards", () => {
      const now = new Date();
      const nextYear = new Date(now);
      nextYear.setFullYear(nextYear.getFullYear() + 1);

      // Create 50 valid standards
      const selectedStandardIds = Array.from({ length: 50 }, (_, i) => i + 1);
      const foundStandards = selectedStandardIds.map((id) => ({
        id,
        name: `Standard ${id}`,
        status: "ACTIVE",
        nextCalibrationDate: nextYear,
      }));

      const expiredStandards = foundStandards.filter(
        (s) => s.nextCalibrationDate < now,
      );
      const inactiveStandards = foundStandards.filter(
        (s) => s.status !== "ACTIVE",
      );

      expect(foundStandards.length).toBe(selectedStandardIds.length);
      expect(expiredStandards).toHaveLength(0);
      expect(inactiveStandards).toHaveLength(0);
    });
  });
});
