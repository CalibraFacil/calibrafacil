import { describe, expect, it } from "vitest";
import { HTTPException } from "hono/http-exception";
import {
  canManageUnitOperationalSettings,
  resolveAccessibleUnitContext,
  selectEffectiveEnvironmentalLimits,
} from "../unit-operational-settings";

describe("unit operational settings helpers", () => {
  const unitScopedManager = {
    role: "member" as const,
    unitRole: "unit_admin" as const,
    activeUnitId: 11,
    activeUnitName: "Matriz",
    accessibleUnitIds: [11, 12],
    accessibleUnits: [
      { id: 11, name: "Matriz", slug: "matriz", role: "unit_admin" as const },
      { id: 12, name: "Filial Sul", slug: "filial-sul", role: "unit_admin" as const },
    ],
    selectedUnitScope: "unit" as const,
  };

  it("allows owners, admins, and unit admins to manage unit operational settings", () => {
    expect(
      canManageUnitOperationalSettings({ role: "owner", unitRole: null }),
    ).toBe(true);
    expect(
      canManageUnitOperationalSettings({ role: "admin", unitRole: null }),
    ).toBe(true);
    expect(
      canManageUnitOperationalSettings({
        role: "member",
        unitRole: "unit_admin",
      }),
    ).toBe(true);
    expect(
      canManageUnitOperationalSettings({
        role: "technician",
        unitRole: "technician",
      }),
    ).toBe(false);
  });

  it("uses the active unit when the dashboard scope is already concrete", () => {
    expect(resolveAccessibleUnitContext(unitScopedManager)).toEqual({
      unitId: 11,
      unitName: "Matriz",
    });
  });

  it("accepts an explicit accessible unit when resolving effective settings", () => {
    expect(resolveAccessibleUnitContext(unitScopedManager, 12)).toEqual({
      unitId: 12,
      unitName: "Filial Sul",
    });
  });

  it("rejects consolidated scope without an explicit unit", () => {
    expect(() =>
      resolveAccessibleUnitContext({
        ...unitScopedManager,
        selectedUnitScope: "all",
        activeUnitId: null,
        activeUnitName: null,
      }),
    ).toThrowError(HTTPException);
  });

  it("rejects explicit units outside the accessible scope", () => {
    expect(() => resolveAccessibleUnitContext(unitScopedManager, 99)).toThrowError(
      HTTPException,
    );
  });

  it("prioritizes asset-type limits over the unit default", () => {
    const result = selectEffectiveEnvironmentalLimits([
      { assetTypeId: 3, temperatureMin: 19 },
      { assetTypeId: null, temperatureMin: 18 },
    ]);

    expect(result.source).toBe("asset_type");
    expect(result.limits).toEqual({ assetTypeId: 3, temperatureMin: 19 });
  });

  it("falls back to the unit default when no asset override exists", () => {
    const result = selectEffectiveEnvironmentalLimits([
      { assetTypeId: null, humidityMax: 70 },
    ]);

    expect(result.source).toBe("unit_default");
    expect(result.limits).toEqual({ assetTypeId: null, humidityMax: 70 });
  });
});
