import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selectResult: [] as unknown[],
  insertResult: [] as unknown[],
  insertCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@calibra-facil/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => mocks.selectResult,
          orderBy: async () => mocks.selectResult,
        }),
      }),
    }),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: async () => {
          mocks.insertCalls.push(values);
          return mocks.insertResult;
        },
      }),
    }),
  },
}));

import {
  findOrCreateSupplierByName,
  reconcileSupplierWithPersonLink,
} from "../supplier";

beforeEach(() => {
  mocks.selectResult = [];
  mocks.insertResult = [];
  mocks.insertCalls = [];
});

describe("findOrCreateSupplierByName", () => {
  it("returns the existing supplier when one matches by name", async () => {
    mocks.selectResult = [
      {
        id: 1,
        organizationId: "org-1",
        name: "Lab Externo",
        taxId: null,
        email: null,
        phone: null,
        kind: "other",
        notes: null,
      },
    ];

    const result = await findOrCreateSupplierByName({
      organizationId: "org-1",
      name: "  lab externo ",
    });

    expect(result?.id).toBe(1);
    expect(mocks.insertCalls).toHaveLength(0);
  });

  it("creates a supplier when none matches", async () => {
    mocks.selectResult = [];
    mocks.insertResult = [
      {
        id: 99,
        organizationId: "org-1",
        name: "Transportadora X",
        taxId: null,
        email: null,
        phone: null,
        kind: "transporter",
        notes: null,
      },
    ];

    const result = await findOrCreateSupplierByName({
      organizationId: "org-1",
      name: "Transportadora X",
      defaultKind: "transporter",
    });

    expect(result?.id).toBe(99);
    expect(mocks.insertCalls).toHaveLength(1);
    expect(mocks.insertCalls[0]?.organizationId).toBe("org-1");
    expect(mocks.insertCalls[0]?.kind).toBe("transporter");
  });

  it("returns null when the name is empty after trim", async () => {
    const result = await findOrCreateSupplierByName({
      organizationId: "org-1",
      name: "   ",
    });
    expect(result).toBeNull();
    expect(mocks.insertCalls).toHaveLength(0);
  });
});

describe("reconcileSupplierWithPersonLink", () => {
  it("matches by tax_id when available", async () => {
    mocks.selectResult = [
      {
        id: 1,
        organizationId: "org-1",
        name: "Old Name",
        taxId: "12345678900",
        email: null,
        phone: null,
        kind: "other",
        notes: null,
      },
    ];

    const result = await reconcileSupplierWithPersonLink({
      organizationId: "org-1",
      remoteName: "Different Name",
      remoteTaxId: "12345678900",
    });

    expect(result?.id).toBe(1);
  });

  it("falls back to name match when tax_id is missing", async () => {
    mocks.selectResult = [
      {
        id: 2,
        organizationId: "org-1",
        name: "Transportadora X",
        taxId: null,
        email: null,
        phone: null,
        kind: "transporter",
        notes: null,
      },
    ];

    const result = await reconcileSupplierWithPersonLink({
      organizationId: "org-1",
      remoteName: "transportadora x",
      remoteTaxId: null,
    });

    expect(result?.id).toBe(2);
  });

  it("returns null when neither tax_id nor name resolves", async () => {
    mocks.selectResult = [];

    const result = await reconcileSupplierWithPersonLink({
      organizationId: "org-1",
      remoteName: "Unknown",
      remoteTaxId: null,
    });

    expect(result).toBeNull();
  });
});
