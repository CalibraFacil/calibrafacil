import { describe, expect, it } from "vitest";

import {
  IMPORT_PREVIEW_ROWS,
  validateImportRows,
  type ImportEntity,
} from "./imports";

const ASSETS: ImportEntity = "assets";

function assetRow(overrides: Record<string, string> = {}) {
  return {
    tag: "BAL-001",
    name: "Balança analítica",
    serialNumber: "SN-123",
    manufacturer: "Mettler",
    model: "XPE205",
    ...overrides,
  };
}

describe("validateImportRows", () => {
  it("accepts a fully valid row set", () => {
    const result = validateImportRows(ASSETS, [
      assetRow(),
      assetRow({ tag: "BAL-002", serialNumber: "SN-456" }),
    ]);
    expect(result.totalRows).toBe(2);
    expect(result.validRows).toBe(2);
    expect(result.errorRows).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.preview).toHaveLength(2);
  });

  it("flags missing required fields with the 1-based row number", () => {
    const result = validateImportRows(ASSETS, [
      assetRow({ name: "" }),
      assetRow({ tag: "BAL-002", serialNumber: "" }),
    ]);
    expect(result.validRows).toBe(0);
    expect(result.errorRows).toBe(2);
    expect(result.errors).toContainEqual({
      row: 1,
      field: "name",
      message: "Nome / descrição: obrigatório",
    });
    expect(
      result.errors.some((e) => e.row === 2 && e.field === "serialNumber"),
    ).toBe(true);
  });

  it("treats whitespace-only required cells as empty", () => {
    const result = validateImportRows(ASSETS, [assetRow({ tag: "   " })]);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]?.field).toBe("tag");
  });

  it("detects duplicate unique tags within the file (case-insensitive)", () => {
    const result = validateImportRows(ASSETS, [
      assetRow({ tag: "BAL-001", serialNumber: "SN-1" }),
      assetRow({ tag: "bal-001", serialNumber: "SN-2" }),
    ]);
    expect(result.validRows).toBe(1);
    expect(result.errorRows).toBe(1);
    expect(result.errors).toContainEqual({
      row: 2,
      field: "tag",
      message: "Tag / ID interno: duplicado no arquivo (linha 1)",
    });
  });

  it("enforces max length", () => {
    const result = validateImportRows(ASSETS, [
      assetRow({ name: "x".repeat(201) }),
    ]);
    expect(result.errorRows).toBe(1);
    expect(result.errors[0]?.message).toContain("máximo de 200");
  });

  it("caps the preview to IMPORT_PREVIEW_ROWS", () => {
    const rows = Array.from({ length: IMPORT_PREVIEW_ROWS + 3 }, (_, i) =>
      assetRow({ tag: `BAL-${i}`, serialNumber: `SN-${i}` }),
    );
    const result = validateImportRows(ASSETS, rows);
    expect(result.validRows).toBe(rows.length);
    expect(result.preview).toHaveLength(IMPORT_PREVIEW_ROWS);
  });

  it("ignores unmapped/extra columns and keeps only known fields in preview", () => {
    const result = validateImportRows(ASSETS, [
      { ...assetRow(), junk: "ignore me" },
    ]);
    expect(result.validRows).toBe(1);
    expect(result.preview[0]).not.toHaveProperty("junk");
    expect(Object.keys(result.preview[0] ?? {})).toEqual([
      "tag",
      "name",
      "serialNumber",
      "manufacturer",
      "model",
    ]);
  });
});
