import type {
  DeleteEnvironmentalLimitResponse,
  EffectiveEnvironmentalLimitsResponse,
  EnvironmentalLimit,
  EnvironmentalLimitRow,
  EnvironmentalLimitsResponse,
  SaveEnvironmentalLimitResponse,
} from "./environmental-limits";
import type {
  MassCompositionProfile,
  MassCompositionProfilesResponse,
  Standard,
  StandardCertificateDocument,
  StandardCertificateDocumentDownloadResponse,
  StandardCertificateDocumentUploadResponse,
  StandardRecord,
  StandardsListResponse,
} from "./standards";

/**
 * Contract-valid example payloads for the reference-standards and
 * environmental-limits endpoints, for tests in any package. Same rules as
 * `jobs.fixtures.ts`: every value mirrors what the handlers return today, and
 * `fixtures.test.ts` parses every builder against its response schema.
 */

export function buildStandardCertificateDocument(
  overrides: Partial<StandardCertificateDocument> = {},
): StandardCertificateDocument {
  return {
    documentId: 11,
    r2Key: "standards/1/certificate.pdf",
    fileName: "certificado.pdf",
    fileSize: 48_000,
    sha256: "a".repeat(64),
    uploadedAt: "2026-01-12T12:00:00.000Z",
    certificateNumber: "CERT-001",
    calibrationDate: "2026-01-10T00:00:00.000Z",
    nextCalibrationDate: "2027-01-10T00:00:00.000Z",
    ...overrides,
  };
}

export function buildStandardRecord(
  overrides: Partial<StandardRecord> = {},
): StandardRecord {
  return {
    id: 1,
    name: "Massa padrão",
    kind: "generic_scalar",
    type: "Peso",
    serialNumber: "SN-STD-1",
    manufacturer: "Fabricante",
    model: "M-1",
    certificateNumber: "CERT-001",
    calibratedBy: "Laboratório RBC",
    calibrationDate: "2026-01-10T00:00:00.000Z",
    nextCalibrationDate: "2027-01-10T00:00:00.000Z",
    referenceValue: 1,
    uncertainty: 0.01,
    uncertaintyUnit: "g",
    coverageFactor: 2,
    distribution: "normal",
    drift: null,
    certifiedValues: [
      {
        nominal: "1",
        value: 1,
        uncertainty: 0.01,
        unit: "g",
        coverageFactor: 2,
      },
    ],
    metrologyData: null,
    status: "ACTIVE",
    createdAt: "2026-01-12T12:00:00.000Z",
    updatedAt: "2026-01-12T12:00:00.000Z",
    ...overrides,
  };
}

export function buildStandard(overrides: Partial<Standard> = {}): Standard {
  return {
    ...buildStandardRecord(),
    certificateDocument: buildStandardCertificateDocument(),
    isExpired: false,
    daysUntilExpiry: 120,
    ...overrides,
  };
}

export function buildStandardsList(
  data: Standard[] = [buildStandard()],
): StandardsListResponse {
  return {
    data,
    pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 },
  };
}

export function buildStandardCertificateDocumentUploadResponse(): StandardCertificateDocumentUploadResponse {
  return {
    message: "Certificado enviado com sucesso",
    document: buildStandardCertificateDocument(),
  };
}

export function buildStandardCertificateDocumentDownloadResponse(): StandardCertificateDocumentDownloadResponse {
  return {
    url: "https://storage.example.test/standards/1/certificate.pdf?sig=1",
    filename: "certificado.pdf",
  };
}

export function buildMassCompositionProfile(
  overrides: Partial<MassCompositionProfile> = {},
): MassCompositionProfile {
  return {
    id: 1,
    profileKey: "M1:1g",
    profileClass: "M1",
    nominal: "1 g",
    nominalG: 1,
    value: 1,
    uncertainty: 0.001,
    unit: "g",
    maxError: null,
    drift: null,
    buoyancy: null,
    coverageFactor: 2,
    quantityAvailable: 1,
    ...overrides,
  };
}

export function buildMassCompositionProfilesResponse(
  data: MassCompositionProfile[] = [buildMassCompositionProfile()],
): MassCompositionProfilesResponse {
  return { data };
}

export function buildEnvironmentalLimitRow(
  overrides: Partial<EnvironmentalLimitRow> = {},
): EnvironmentalLimitRow {
  return {
    id: 5,
    unitId: 1,
    assetTypeId: null,
    temperatureMin: 18,
    temperatureMax: 25,
    humidityMin: 30,
    humidityMax: 70,
    pressureMin: null,
    pressureMax: null,
    createdAt: "2026-01-12T12:00:00.000Z",
    updatedAt: "2026-01-12T12:00:00.000Z",
    ...overrides,
  };
}

export function buildEnvironmentalLimit(
  overrides: Partial<EnvironmentalLimit> = {},
): EnvironmentalLimit {
  return { ...buildEnvironmentalLimitRow(), assetTypeName: null, ...overrides };
}

export function buildEnvironmentalLimitsResponse(
  limits: EnvironmentalLimit[] = [buildEnvironmentalLimit()],
): EnvironmentalLimitsResponse {
  return { limits, unit: { unitId: 1, unitName: "Matriz" } };
}

export function buildEffectiveEnvironmentalLimits(
  overrides: Partial<EffectiveEnvironmentalLimitsResponse> = {},
): EffectiveEnvironmentalLimitsResponse {
  return {
    limits: buildEnvironmentalLimitRow(),
    source: "unit_default",
    ...overrides,
  };
}

export function buildSaveEnvironmentalLimitResponse(): SaveEnvironmentalLimitResponse {
  return {
    message: "Limites ambientais atualizados",
    data: buildEnvironmentalLimitRow(),
    unit: { unitId: 1, unitName: "Matriz" },
  };
}

export function buildDeleteEnvironmentalLimitResponse(): DeleteEnvironmentalLimitResponse {
  return { message: "Limites removidos" };
}
