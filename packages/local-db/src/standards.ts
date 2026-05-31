import type { LocalDatabase } from "./database";
import { stableLocalNumericId } from "./ids";

export type LocalStandardStatus =
  | "ACTIVE"
  | "INACTIVE"
  | "OUT_OF_TOLERANCE"
  | "SENT_FOR_CALIBRATION";

export type LocalStandardsListInput = {
  page: number;
  limit: number;
  query?: string;
  status?: LocalStandardStatus;
};

export type LocalCertifiedValue = {
  nominal: string;
  authentication?: string | null;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
  compositionProfile?: boolean;
  profileKey?: string | null;
  profileClass?: string | null;
  profileQuantityAvailable?: number | null;
};

export type LocalStandard = {
  id: number;
  name: string;
  kind: string;
  type: string | null;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  certificateNumber: string;
  calibratedBy: string | null;
  calibrationDate: string;
  nextCalibrationDate: string;
  referenceValue: number | null;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  distribution: "normal" | "rectangular";
  drift: number | null;
  certifiedValues: LocalCertifiedValue[] | null;
  metrologyData: unknown;
  certificateDocument?: unknown;
  status: LocalStandardStatus;
  isExpired: boolean;
  daysUntilExpiry: number;
  createdAt: string;
  updatedAt: string;
};

export type LocalStandardsListData = {
  data: LocalStandard[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type LocalStandardRow = {
  id: string;
  remote_id: number | null;
  name: string;
  serial_number: string | null;
  certificate_number: string | null;
  next_calibration_date: string | null;
  status: string;
  snapshot_json: string;
  pulled_at: string;
};

export function listLocalStandards(
  database: LocalDatabase,
  input: LocalStandardsListInput,
): LocalStandardsListData {
  const page = Math.max(1, input.page);
  const limit = Math.max(1, Math.min(input.limit, 100));
  const offset = (page - 1) * limit;
  const conditions = ["sync_state != 'deleted'"];
  const params: Record<string, string | number> = {};

  if (input.status) {
    conditions.push("status = @status");
    params.status = input.status;
  }

  if (input.query) {
    conditions.push(
      "(name LIKE @query OR serial_number LIKE @query OR certificate_number LIKE @query)",
    );
    params.query = `%${input.query}%`;
  }

  const whereClause = conditions.join(" AND ");
  const totalRow = database
    .prepare<typeof params, { total: number }>(
      `
SELECT COUNT(*) AS total
FROM reference_standards
WHERE ${whereClause}
`,
    )
    .get(params);

  const pageParams = { ...params, limit, offset };
  const rows = database
    .prepare<typeof pageParams, LocalStandardRow>(
      `
SELECT
  id,
  remote_id,
  name,
  serial_number,
  certificate_number,
  next_calibration_date,
  status,
  snapshot_json,
  pulled_at
FROM reference_standards
WHERE ${whereClause}
ORDER BY name ASC
LIMIT @limit OFFSET @offset
`,
    )
    .all(pageParams);

  return {
    data: rows.map(toLocalStandard),
    pagination: {
      page,
      limit,
      total: totalRow?.total ?? 0,
      totalPages: Math.ceil((totalRow?.total ?? 0) / limit),
    },
  };
}

export function getLocalStandardDetail(
  database: LocalDatabase,
  identifier: string,
): LocalStandard | null {
  const row = resolveLocalStandardRow(database, identifier);
  return row ? toLocalStandard(row) : null;
}

function resolveLocalStandardRow(
  database: LocalDatabase,
  identifier: string,
): LocalStandardRow | null {
  const numericIdentifier =
    parseNumericIdentifier(identifier) ??
    parseTrailingNumericIdentifier(identifier);
  const params: Record<string, string | number> = { identifier };
  const directConditions = [
    "id = @identifier",
    "name = @identifier",
    "serial_number = @identifier",
    "certificate_number = @identifier",
  ];

  if (numericIdentifier !== null) {
    directConditions.push("remote_id = @numericIdentifier");
    params.numericIdentifier = numericIdentifier;
  }

  const directMatch = database
    .prepare<typeof params, LocalStandardRow>(
      `
SELECT
  id,
  remote_id,
  name,
  serial_number,
  certificate_number,
  next_calibration_date,
  status,
  snapshot_json,
  pulled_at
FROM reference_standards
WHERE sync_state != 'deleted'
  AND (${directConditions.join(" OR ")})
LIMIT 1
`,
    )
    .get(params);

  if (directMatch) return directMatch;

  const rows = database
    .prepare<[], LocalStandardRow>(
      `
SELECT
  id,
  remote_id,
  name,
  serial_number,
  certificate_number,
  next_calibration_date,
  status,
  snapshot_json,
  pulled_at
FROM reference_standards
WHERE sync_state != 'deleted'
`,
    )
    .all();

  if (numericIdentifier !== null) {
    const stableMatch = rows.find(
      (row) => stableLocalNumericId(row.id) === numericIdentifier,
    );
    if (stableMatch) return stableMatch;
  }

  const normalizedIdentifier = slugifyRouteIdentifier(identifier);
  return (
    rows.find((row) => {
      return (
        slugifyRouteIdentifier(row.serial_number ?? "") ===
          normalizedIdentifier ||
        slugifyRouteIdentifier(row.certificate_number ?? "") ===
          normalizedIdentifier ||
        slugifyRouteIdentifier(row.name) === normalizedIdentifier
      );
    }) ?? null
  );
}

function parseNumericIdentifier(identifier: string): number | null {
  if (!/^\d+$/.test(identifier)) return null;
  const value = Number(identifier);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function parseTrailingNumericIdentifier(identifier: string): number | null {
  const match = /-(\d+)$/.exec(identifier);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function toLocalStandard(row: LocalStandardRow): LocalStandard {
  const snapshot = safeParseRecord(row.snapshot_json);
  const nextCalibrationDate =
    getString(snapshot, "nextCalibrationDate") ??
    row.next_calibration_date ??
    row.pulled_at;
  const calibrationDate =
    getString(snapshot, "calibrationDate") ?? row.pulled_at;
  const expiry = computeExpiry(nextCalibrationDate);

  return {
    id: row.remote_id ?? stableLocalNumericId(row.id),
    name: getString(snapshot, "name") ?? row.name,
    kind: getString(snapshot, "kind") ?? "generic_scalar",
    type: getNullableString(snapshot, "type"),
    serialNumber:
      getString(snapshot, "serialNumber") ?? row.serial_number ?? "",
    manufacturer: getNullableString(snapshot, "manufacturer"),
    model: getNullableString(snapshot, "model"),
    certificateNumber:
      getString(snapshot, "certificateNumber") ?? row.certificate_number ?? "",
    calibratedBy: getNullableString(snapshot, "calibratedBy"),
    calibrationDate,
    nextCalibrationDate,
    referenceValue: getNullableNumber(snapshot, "referenceValue"),
    uncertainty: getNullableNumber(snapshot, "uncertainty"),
    uncertaintyUnit: getNullableString(snapshot, "uncertaintyUnit"),
    coverageFactor: getNumber(snapshot, "coverageFactor") ?? 2,
    distribution:
      getString(snapshot, "distribution") === "rectangular"
        ? "rectangular"
        : "normal",
    drift: getNullableNumber(snapshot, "drift"),
    certifiedValues: parseCertifiedValues(snapshot.certifiedValues),
    metrologyData: snapshot.metrologyData ?? null,
    certificateDocument: snapshot.certificateDocument ?? null,
    status: parseStatus(row.status),
    isExpired: expiry.isExpired,
    daysUntilExpiry: expiry.daysUntilExpiry,
    createdAt: getString(snapshot, "createdAt") ?? row.pulled_at,
    updatedAt: getString(snapshot, "updatedAt") ?? row.pulled_at,
  };
}

function computeExpiry(nextCalibrationDate: string) {
  const expiryTime = new Date(nextCalibrationDate).getTime();
  if (!Number.isFinite(expiryTime)) {
    return { isExpired: false, daysUntilExpiry: 0 };
  }

  const now = Date.now();
  return {
    isExpired: expiryTime < now,
    daysUntilExpiry: Math.ceil((expiryTime - now) / (1000 * 60 * 60 * 24)),
  };
}

function parseCertifiedValues(value: unknown): LocalCertifiedValue[] | null {
  if (!Array.isArray(value)) return null;
  const values: LocalCertifiedValue[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = recordFromUnknown(item);
    const nominal = getString(record, "nominal");
    const certifiedValue = getNumber(record, "value");
    const uncertainty = getNumber(record, "uncertainty");
    const unit = getString(record, "unit");

    if (!nominal || certifiedValue === null || uncertainty === null || !unit) {
      continue;
    }

    values.push({
      nominal,
      authentication: getNullableString(record, "authentication"),
      value: certifiedValue,
      uncertainty,
      unit,
      maxError: getNullableNumber(record, "maxError"),
      drift: getNullableNumber(record, "drift"),
      buoyancy: getNullableNumber(record, "buoyancy"),
      coverageFactor: getNullableNumber(record, "coverageFactor"),
      compositionProfile:
        typeof record.compositionProfile === "boolean"
          ? record.compositionProfile
          : undefined,
      profileKey: getNullableString(record, "profileKey"),
      profileClass: getNullableString(record, "profileClass"),
      profileQuantityAvailable: getNullableNumber(
        record,
        "profileQuantityAvailable",
      ),
    });
  }

  return values.length > 0 ? values : null;
}

function parseStatus(status: string): LocalStandardStatus {
  if (
    status === "ACTIVE" ||
    status === "INACTIVE" ||
    status === "OUT_OF_TOLERANCE" ||
    status === "SENT_FOR_CALIBRATION"
  ) {
    return status;
  }

  return "ACTIVE";
}

function safeParseRecord(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return recordFromUnknown(parsed);
  } catch {
    return {};
  }
}

function recordFromUnknown(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

function getString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getNullableString(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function getNumber(record: Record<string, unknown>, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getNullableNumber(record: Record<string, unknown>, key: string) {
  return getNumber(record, key);
}

function slugifyRouteIdentifier(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}
