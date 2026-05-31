import { HTTPException } from "hono/http-exception";
import type { MemberData } from "../middleware/permission";
import { isUnitScopedManagementRole } from "./units";

type UnitOperationalMember = Pick<
  MemberData,
  | "role"
  | "unitRole"
  | "activeUnitId"
  | "activeUnitName"
  | "accessibleUnitIds"
  | "accessibleUnits"
  | "selectedUnitScope"
>;

export function canManageUnitOperationalSettings(
  member: Pick<MemberData, "role" | "unitRole">,
) {
  return isUnitScopedManagementRole(member.role, member.unitRole);
}

export function requireUnitOperationalSettingsManager(
  member: Pick<MemberData, "role" | "unitRole">,
) {
  if (!canManageUnitOperationalSettings(member)) {
    throw new HTTPException(403, {
      message:
        "Operational settings management requires unit_admin or admin access",
    });
  }
}

export function resolveAccessibleUnitContext(
  member: UnitOperationalMember,
  requestedUnitId?: number | null,
) {
  if (requestedUnitId != null) {
    if (!Number.isInteger(requestedUnitId) || requestedUnitId <= 0) {
      throw new HTTPException(400, {
        message: "A valid unitId is required",
      });
    }

    if (!member.accessibleUnitIds.includes(requestedUnitId)) {
      throw new HTTPException(403, {
        message: "Unit is outside the current governance scope",
      });
    }

    const selectedUnit =
      member.accessibleUnits.find((unit) => unit.id === requestedUnitId) ??
      null;

    return {
      unitId: requestedUnitId,
      unitName: selectedUnit?.name ?? null,
    };
  }

  if (member.selectedUnitScope !== "unit" || member.activeUnitId == null) {
    throw new HTTPException(400, {
      message: "Select a specific unit to manage operational settings",
    });
  }

  return {
    unitId: member.activeUnitId,
    unitName: member.activeUnitName,
  };
}

export function selectEffectiveEnvironmentalLimits<
  T extends { assetTypeId: number | null },
>(limits: T[]) {
  const specific = limits.find((limit) => limit.assetTypeId !== null) ?? null;

  if (specific) {
    return {
      limits: specific,
      source: "asset_type" as const,
    };
  }

  const unitDefault =
    limits.find((limit) => limit.assetTypeId === null) ?? null;

  if (unitDefault) {
    return {
      limits: unitDefault,
      source: "unit_default" as const,
    };
  }

  return {
    limits: null,
    source: null,
  };
}
