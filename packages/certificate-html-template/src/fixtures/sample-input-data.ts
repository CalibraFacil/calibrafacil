/**
 * Canonical sample of the certificate render input — the shape of
 * `buildXlsxCertificateData(job)` (apps/worker/src/index.ts), which is what
 * `issued_certificate_snapshot.input_data_snapshot` stores. Hand-mirrored from
 * the builder on 2026-07-06 (fields the wysiwyg engine consumes; the real
 * object carries additional roots like `raw`/`snapshots`).
 *
 * Used by: catalog resolution tests (every entry must resolve here or be
 * `required: false`), compiler snapshot tests (T4), and the API's
 * trial-compile sample data (T7). Values are sanitized/fictitious.
 */

import { SAMPLE_SIGNATURE_DATA_URL } from "../sample-assets.js";

type ResultRow = {
  key: string;
  label: string;
  value: number | string;
  unit: string | null;
  role:
    | "primary_result"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "uncertainty_component"
    | "auxiliary";
  group: "calibration_result" | "uncertainty_budget" | "raw_calculation";
  includeInCertificate: boolean;
};

const resultRows: ResultRow[] = [
  {
    key: "erro_10kg",
    label: "Erro de indicação (10 kg)",
    value: 0.0001,
    unit: "kg",
    role: "primary_result",
    group: "calibration_result",
    includeInCertificate: true,
  },
  {
    key: "incerteza_expandida",
    label: "Incerteza expandida",
    value: 0.0004,
    unit: "kg",
    role: "expanded_uncertainty",
    group: "calibration_result",
    includeInCertificate: true,
  },
  {
    key: "fator_abrangencia",
    label: "Fator de abrangência",
    value: 2,
    unit: null,
    role: "coverage_factor",
    group: "calibration_result",
    includeInCertificate: true,
  },
  {
    key: "margem_conformidade_apos",
    label: "Margem de conformidade (após)",
    value: 62.5,
    unit: "%",
    role: "conformity_margin",
    group: "calibration_result",
    includeInCertificate: true,
  },
  {
    key: "u_padrao",
    label: "Incerteza do padrão",
    value: 0.00015,
    unit: "kg",
    role: "uncertainty_component",
    group: "uncertainty_budget",
    includeInCertificate: false,
  },
];

export const sampleCertificateInputData: Record<string, unknown> = {
  lab: {
    name: "Laboratório Exemplo de Calibração Ltda",
    cnpj: "12345678000190",
    accreditationNumber: "9999",
    accreditationNumberFormatted: "CAL 9999",
    accreditationBody: "Cgcre",
    accreditationActive: true,
    accreditationSealPng: null,
    address: "Rua das Medições, 100 — Canoas/RS — CEP 92000-000",
    city: "Canoas",
    state: "RS",
    cep: "92000-000",
    phone: "(51) 3000-0000",
    email: "lab@exemplo.com.br",
    website: "https://lab.exemplo.com.br",
    logo: "https://example.com/logo.png",
    // Worker-resolved letterhead logo (data URL) — null in the canonical
    // sample; the editor substitutes a placeholder for its preview.
    logoDataUrl: null,
    technicalManagerName: "Maria da Silva",
    technicalManagerTitle: "Responsável Técnica",
  },
  accreditation: {
    accredited: true,
    labActive: true,
    methodAccreditedScope: true,
    number: "9999",
    numberFormatted: "CAL 9999",
    body: "Cgcre",
  },
  customer: {
    name: "Indústria Cliente Exemplo S.A.",
    taxId: "98765432000110",
    address: "Av. Industrial, 2000 — Esteio/RS",
    phone: "(51) 3111-1111",
    email: "qualidade@clienteexemplo.com.br",
  },
  asset: {
    kind: "Balança eletrônica",
    serialNumber: "SER-2024-777",
    tag: "BAL-017",
    model: "MX-15",
    manufacturer: "Fabricante Exemplo",
    measurementUnit: "kg",
    baseMeasurementUnit: "kg",
    capacityText: "15 kg",
    divisionText: "0,5 g",
    inmetroRegistration: "Portaria Inmetro nº 157/2022",
  },
  certificate: {
    number: "CAL-2026-0042",
    name: null,
    verificationUrl: "https://verify.calibrafacil.com/v/00000000-0000-4000-8000-000000000042",
    issuedAt: "2026-07-01T12:00:00.000Z",
    issuedAtText: "01/07/2026",
    supersedesId: null,
    supersededById: null,
    amendmentNumber: null,
    amendmentReason: null,
    originalJobId: null,
    originalApprovedAt: null,
  },
  job: {
    id: "CAL-2026-0042",
    performedAt: "2026-06-28T09:00:00.000Z",
    performedAtText: "28/06/2026",
    location: "Laboratório permanente",
    locationType: "laboratory",
  },
  method: {
    id: 6,
    name: "Calibração de balanças — método comparativo",
    version: 3,
    procedureCode: "PC-BAL-001",
    referenceStandards: ["OIML R 76", "NBR ISO/IEC 17025"],
    referenceStandardsText: "OIML R 76 e NBR ISO/IEC 17025",
  },
  environment: {
    temperature: 20.3,
    temperatureText: "20,3 ºC",
    relativeHumidity: 54,
    relativeHumidityText: "54 %",
    pressure: 1013,
    pressureText: "1013 hPa",
    recordedAt: "2026-06-28T09:05:00.000Z",
    recordedBy: "Matheus Técnico",
    withinLimits: true,
    outOfLimitsJustification: null,
  },
  standards: [
    {
      name: "Conjunto de massas padrão M1",
      certificate: "RBC CAL-0100/2026",
      validUntil: "2027-05-30",
      traceability: "Inmetro / RBC",
    },
  ],
  traceability: [
    {
      name: "Conjunto de massas padrão M1",
      certificate: "RBC CAL-0100/2026",
      validUntil: "2027-05-30",
      traceability: "Inmetro / RBC",
    },
  ],
  // Multi-point calibration table (reframe T22): the method defines a table
  // dataField + table_row formulas; frozen job data/results carry the rows.
  methodSnapshot: {
    dataFields: [
      {
        key: "pontos",
        label: "Pontos de calibração — indicação de massa",
        type: "table",
        columns: [
          { key: "nominal", label: "Carga nominal", type: "number", unit: "kg", phase: "always" },
          { key: "leitura_antes", label: "Indicação como recebido", type: "number", unit: "kg", phase: "before" },
          { key: "leitura_apos", label: "Indicação como deixado", type: "number", unit: "kg", phase: "after" },
        ],
      },
    ],
    formulas: [
      {
        outputKey: "erro_ponto",
        expression: "leitura_apos - nominal",
        label: "Erro de indicação",
        unit: "kg",
        scope: { kind: "table_row", tableKey: "pontos" },
        reporting: { role: "primary_result", group: "calibration_result", includeInCertificate: true },
      },
      {
        outputKey: "u_ponto",
        expression: "u_c * k",
        label: "Incerteza expandida",
        unit: "kg",
        scope: { kind: "table_row", tableKey: "pontos" },
        reporting: { role: "expanded_uncertainty", group: "calibration_result", includeInCertificate: true },
      },
      {
        outputKey: "ema_ponto",
        expression: "ema(nominal)",
        label: "EMA",
        unit: "kg",
        scope: { kind: "table_row", tableKey: "pontos" },
        reporting: { role: "auxiliary", group: "calibration_result", includeInCertificate: true },
      },
      {
        outputKey: "debug_interno",
        expression: "x",
        label: "Interno",
        scope: { kind: "table_row", tableKey: "pontos" },
        reporting: { includeInCertificate: false },
      },
    ],
  },
  data: {
    pontos: [
      { nominal: 500, leitura_antes: 500, leitura_apos: 500 },
      { nominal: 1000, leitura_antes: 999, leitura_apos: 1000 },
      { nominal: 1500, leitura_antes: 1498.5, leitura_apos: 1499.5 },
      { nominal: 2000, leitura_antes: 1998, leitura_apos: 2000 },
    ],
  },
  results: {
    erro_ponto: [0, 0, -0.5, 0],
    u_ponto: [0.29, 0.3, 0.31, 0.54],
    ema_ponto: [0.5, 0.5, 0.75, 0.75],
    debug_interno: [1, 2, 3, 4],
  },
  resultRows,
  calibrationResults: resultRows.filter((row) => row.group === "calibration_result"),
  uncertainty: {
    expanded: resultRows[1],
    coverageFactor: resultRows[2],
    budget: resultRows.filter((row) => row.group === "uncertainty_budget"),
  },
  uncertaintyBudget: resultRows.filter((row) => row.group === "uncertainty_budget"),
  approval: {
    approvedBy: { name: "Maria da Silva" },
    // Data URL: remote sample URLs render as broken images in Gotenberg
    // previews (real issuance resolves the approver's signature from R2 to a
    // data URL in fetchJobData).
    signatureUrl: SAMPLE_SIGNATURE_DATA_URL,
  },
  serviceOrder: {
    inmetroRepairMarkNumber: "MR-2026-0099",
  },
  environmentalSnapshot: {
    temperature: 20.3,
    humidity: 54,
    pressure: 1013,
    recordedAt: "2026-06-28T09:05:00.000Z",
    recordedBy: "Matheus Técnico",
    withinLimits: true,
    outOfLimitsJustification: null,
  },
};
