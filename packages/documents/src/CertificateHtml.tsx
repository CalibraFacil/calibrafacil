/** @jsxImportSource react */
import { formatCalibrationValue } from "@calibra-facil/shared/calibration-format";
import { type CertificateTemplateSnapshot } from "@calibra-facil/shared/certificate-templates";
import {
  convertMassValue,
  isMassMeasurementUnit,
  resolveMassDisplayUnit,
  type MassUnit,
} from "@calibra-facil/shared/mass-units";

// Types for certificate generation (standalone, does not depend on @calibra-facil/db)

const ECCENTRICITY_INDICATOR_SPEC_KEY = "eccentricityIndicatorPosition";
const ECCENTRICITY_INDICATOR_OPTIONS = [
  { value: "top", label: "Superior", className: "box-top" },
  { value: "right", label: "Lateral Direito", className: "box-right" },
  { value: "bottom", label: "Inferior", className: "box-bottom" },
  { value: "left", label: "Lateral Esquerdo", className: "box-left" },
] as const;
const ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS = [
  { value: "1", label: "Seção 1", className: "road-point-1" },
  { value: "2", label: "Seção 2", className: "road-point-2" },
  { value: "3", label: "Seção 3", className: "road-point-3" },
  { value: "4", label: "Seção 4", className: "road-point-4" },
] as const;
const CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES = {
  A: "eccentricity-load-a",
  B: "eccentricity-load-b",
  C: "eccentricity-load-c",
  D: "eccentricity-load-d",
  E: "eccentricity-load-e",
} as const;
const MAX_PRINT_TABLE_COLUMNS = 8;
const MAX_CALIBRATION_RESULT_COLUMNS = 6;

const BALANCE_INFORMATION_SECTION: MethodCertificateContentSection = {
  kind: "bullets",
  title: "INFORMAÇÕES",
  items: [
    "A incerteza expandida de medição relatada é declarada como a incerteza padrão de medição multiplicada pelo fator de abrangência k, o qual para uma distribuição t-Student, com Veff graus de liberdade efetivos corresponde a uma probabilidade de abrangência de aproximadamente 95%. A incerteza padrão de medição foi determinada de acordo com a publicação EA-4/02. Os valores de k e Veff são apresentados na tabela de resultados.",
    "Os resultados deste certificado referem-se exclusivamente ao instrumento submetido à calibração específica, não sendo extensivo a quaisquer lotes.",
    "Este certificado não tem valor para fins de metrologia legal.",
    "Os resultados são válidos somente para o estado do instrumento no momento da calibração.",
  ],
};

const BALANCE_FALLBACK_CERTIFICATE_SECTIONS: MethodCertificateContentSection[] =
  [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por meio de comparação direta entre os valores dos pesos padrão e a indicação da balança.",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        {
          term: "VC",
          definition:
            "Valor Convencional, valor correspondente ao padrão utilizado.",
        },
        {
          term: "EI",
          definition: "Erro de Indicação, (VI - VC).",
        },
        {
          term: "U",
          definition: "Incerteza expandida.",
        },
      ],
    },
    BALANCE_INFORMATION_SECTION,
  ];

type EccentricityIndicatorVariant = "circular_platform" | "road_scale";

type EccentricityIndicatorPosition =
  | (typeof ECCENTRICITY_INDICATOR_OPTIONS)[number]["value"]
  | (typeof ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS)[number]["value"];

export type CustomerAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
};

// Method input field definition (from method builder)
export type MethodInputField = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "table";
  unit?: string;
  required?: boolean;
  options?: string[];
  defaultValue?: string | number;
  source?: "manual" | "asset_spec";
  assetSpecKey?: string;
  allowOverride?: boolean;
  phaseBlockKey?: string;
  phaseBlockLabel?: string;
  eccentricityIndicator?: {
    enabled?: boolean;
    variant?: "circular_platform" | "road_scale";
  };
  weighingRangeResolver?: {
    enabled?: boolean;
    assetSpecKey?: string;
    pointColumn?: string;
    pointUnit?: "mg" | "g" | "kg";
    targetColumns?: {
      rangeLabel?: string;
      rangeMin?: string;
      rangeMax?: string;
      rangeUnit?: string;
      resolution?: string;
      resolutionUnit?: string;
    };
  };
  columns?: Array<{
    key: string;
    label: string;
    type: "text" | "number";
    unit?: string;
    role?: "standard_value" | "mass_standard_composition";
    phase?: "before" | "after" | "always";
    massComposition?: {
      targetUnit?: "mg" | "g" | "kg";
      optionSource?: "certified_values" | "composition_profiles";
      targetColumns?: {
        certifiedValue?: string;
        compositionLabel?: string;
        expandedUncertainty?: string;
        maxError?: string;
        drift?: string;
        buoyancy?: string;
      };
    };
  }>;
};

export type MethodFormulaReporting = {
  includeInCertificate?: boolean;
  role?:
    | "primary_result"
    | "expanded_uncertainty"
    | "coverage_factor"
    | "conformity_margin"
    | "uncertainty_component"
    | "auxiliary";
  group?: "calibration_result" | "uncertainty_budget" | "raw_calculation";
};

// Method formula definition (for labeling results)
export type MethodFormula = {
  outputKey: string;
  expression: string;
  label?: string;
  unit?: string;
  reporting?: MethodFormulaReporting;
};

type MethodCertificateContentSection =
  | {
      kind: "paragraphs";
      title: string;
      paragraphs: string[];
    }
  | {
      kind: "definition_list";
      title: string;
      items: Array<{ term: string; definition: string }>;
    }
  | {
      kind: "bullets";
      title?: string;
      items: string[];
    };

type MethodCertificateContent = {
  procedureCode?: string;
  referenceStandards?: string[];
  certifiedValuesDisplay?: "full" | "hidden";
  massCompositionDisplay?: "full" | "hidden";
  uncertaintyBudgetDisplay?: "full" | "hidden";
  sections?: MethodCertificateContentSection[];
};

type MethodTableColumn = NonNullable<MethodInputField["columns"]>[number];

export type MethodSnapshot = {
  methodId: number;
  methodName: string;
  methodVersion: number;
  dataFields?: MethodInputField[];
  formulas?: MethodFormula[];
  certificateContent?: MethodCertificateContent | null;
};

type CalibrationPhaseMode =
  | "before_and_after"
  | "before_only"
  | "after_only"
  | "not_performed";

type CalibrationPhaseSnapshot = {
  blocks: Record<
    string,
    {
      mode: CalibrationPhaseMode;
      reason?: string | null;
    }
  >;
  recordedAt?: string;
  recordedBy?: string;
};

export type CertifiedValue = {
  nominal: string;
  value: number;
  uncertainty: number;
  unit: string;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  coverageFactor?: number | null;
};

export type StandardSnapshot = {
  id: number;
  name: string;
  type?: string | null;
  certificateNumber: string;
  calibratedBy?: string | null;
  calibrationDate: Date | string;
  nextCalibrationDate?: Date | string | null;
  uncertainty: number | null;
  uncertaintyUnit: string | null;
  coverageFactor: number;
  certifiedValues?: CertifiedValue[] | null;
};

export type EnvironmentalSnapshot = {
  temperature: number | null;
  humidity: number | null;
  pressure: number | null;
  recordedAt: string;
  recordedBy: string;
  limits: {
    temperature?: { min: number; max: number };
    humidity?: { min: number; max: number };
    pressure?: { min: number; max: number };
  } | null;
  withinLimits: boolean;
  outOfLimitsJustification: string | null;
};

export type CalibrationLocationSnapshot = {
  type: "customer_site" | "lab" | "other";
  addressText: string;
  notes?: string | null;
  recordedAt?: string;
  recordedBy?: string;
};

type MassCompositionItem = {
  standardId: number;
  standardIds?: number[];
  standardName: string;
  certificateNumber: string;
  certifiedValueIndex: number;
  nominal: string;
  quantity: number;
  value: number;
  uncertainty: number;
  unit: string;
  coverageFactor: number;
  maxError?: number | null;
  drift?: number | null;
  buoyancy?: number | null;
  compositionProfile?: boolean;
  profileKey?: string | null;
  profileClass?: string | null;
};

type MassCompositionValue = {
  kind: "mass_standard_composition";
  targetUnit: "mg" | "g" | "kg";
  label: string;
  items: MassCompositionItem[];
  totals: {
    certifiedValue: number;
    expandedUncertainty: number | null;
    maxError: number | null;
    drift: number | null;
    buoyancy: number | null;
  };
  warnings: string[];
};

type MassCompositionCertificateRow = {
  point: string;
  composition: string;
  item: MassCompositionItem;
};

export type AssetSnapshot = {
  assetId: number;
  assetTypeId: number;
  assetTypeName: string;
  assetTypeSlug: string;
  baseMeasurementUnit?: MassUnit | null;
  name: string;
  tag: string;
  serialNumber: string;
  manufacturer: string | null;
  model: string | null;
  specifications: Record<string, unknown> | null;
  capturedAt: string;
};

export type JobData = {
  jobId: string;
  certificateName?: string | null;
  organizationId?: string | null;
  unitId?: number | null;
  performedAt: Date | null;
  approvedAt: Date | null;
  environmentalSnapshot?: EnvironmentalSnapshot | null;
  calibrationLocationSnapshot?: CalibrationLocationSnapshot | null;
  calibrationPhaseSnapshot?: CalibrationPhaseSnapshot | null;
  lab: {
    name: string;
    cnpj?: string | null;
    accreditationNumber?: string | null;
    accreditationBody?: string | null;
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    neighbourhood?: string | null;
    city?: string | null;
    state?: string | null;
    cep?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    logo?: string | null;
    technicalManagerName?: string | null;
    technicalManagerTitle?: string | null;
  };
  customer: {
    name: string;
    taxId?: string | null;
    phone?: string | null;
    email?: string | null;
    address: CustomerAddress | null;
  };
  asset: {
    name: string;
    serialNumber: string;
    tag: string;
    model: string | null;
    manufacturer: string | null;
  };
  methodSnapshot: MethodSnapshot;
  assetSnapshot?: AssetSnapshot | null;
  standardsSnapshot: StandardSnapshot[] | null;
  serviceOrder?: {
    inmetroRepairSealNumber?: string | null;
  } | null;
  data: Record<string, unknown> | null;
  results: Record<string, unknown> | null;
  approverName: string | null;
  certificateTemplateSnapshot?: CertificateTemplateSnapshot | null;
  // Visual signature image URL (presigned URL) - ISO 17025 Clause 7.8.2.1(q)
  approverSignatureUrl?: string | null;
  // Amendment fields - ISO 17025 Clause 7.8.4.1
  supersedesId?: number | null;
  supersededById?: number | null;
  amendmentNumber?: number | null;
  amendmentReason?: string | null;
  originalJobId?: string | null; // Human-readable ID of the superseded job
  originalApprovedAt?: Date | null;
};

const styles = `
  @page {
    size: A4;
    margin: 15mm;
  }
  * {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }
  body {
    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
    font-size: 10pt;
    line-height: 1.4;
    color: #1a1a1a;
  }
  @media screen {
    body {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 15mm;
      background: white;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.12);
    }
    .certificate {
      max-width: none;
      width: 100%;
    }
  }
  .certificate {
    max-width: 210mm;
    margin: 0 auto;
  }
  .certificate.density-compact {
    font-size: 9pt;
    line-height: 1.32;
  }
  .certificate.density-compact .section {
    margin-bottom: 12px;
  }
  .certificate.density-compact .header {
    padding-bottom: 10px;
    margin-bottom: 14px;
  }
  .certificate.density-compact th,
  .certificate.density-compact td {
    padding: 4px 6px;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    border-bottom: 2px solid var(--template-primary);
    padding-bottom: 12px;
    margin-bottom: 16px;
  }
  .logo-section {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .header-style-minimal .header {
    display: block;
  }
  .header-style-minimal .logo-section {
    margin-bottom: 10px;
  }
  .header-style-minimal .cert-number {
    text-align: left;
  }
  .header-style-split .header {
    align-items: stretch;
    gap: 18px;
  }
  .header-style-split .cert-number {
    min-width: 220px;
    padding: 12px;
    border-radius: 10px;
    background: color-mix(in srgb, var(--template-accent) 65%, white);
    border: 1px solid color-mix(in srgb, var(--template-primary) 20%, white);
  }
  .logo-placeholder {
    width: 60px;
    height: 60px;
    background: var(--template-primary);
    border-radius: 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: white;
    font-weight: bold;
    font-size: 14pt;
  }
  .lab-info h1 {
    font-size: 16pt;
    color: var(--template-primary);
    margin-bottom: 2px;
  }
  .lab-info p {
    font-size: 8pt;
    color: #666;
  }
  .cert-number {
    text-align: right;
  }
  .cert-number h2 {
    font-size: 11pt;
    color: #333;
    margin-bottom: 4px;
  }
  .cert-number .number {
    font-size: 14pt;
    font-weight: bold;
    color: var(--template-primary);
  }
  .emphasis-formal .section-title,
  .emphasis-formal .lab-info h1,
  .emphasis-formal .cert-number .number {
    color: #223047;
  }
  .emphasis-formal .header {
    border-bottom-color: #223047;
  }
  .emphasis-neutral .section-title,
  .emphasis-neutral .lab-info h1,
  .emphasis-neutral .cert-number .number {
    color: #374151;
  }
  .emphasis-neutral .header {
    border-bottom-color: #d1d5db;
  }
  .section {
    margin-bottom: 16px;
  }
  .section-title {
    font-size: 11pt;
    font-weight: 600;
    color: var(--template-primary);
    border-bottom: 1px solid #ccc;
    padding-bottom: 4px;
    margin-bottom: 8px;
    break-after: avoid;
    page-break-after: avoid;
  }
  .info-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px 24px;
  }
  .info-row {
    display: flex;
    gap: 8px;
  }
  .info-label {
    font-weight: 600;
    color: #555;
    min-width: 100px;
  }
  .info-value {
    color: #1a1a1a;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 9pt;
    table-layout: fixed;
  }
  th, td {
    border: 1px solid #ddd;
    padding: 6px 8px;
    text-align: left;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    vertical-align: top;
  }
  th {
    background: var(--template-accent);
    font-weight: 600;
    color: #333;
  }
  tr:nth-child(even) {
    background: #fafafa;
  }
  .footer {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid #ccc;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #666;
  }
  .signature-section {
    margin-top: 16px;
    display: flex;
    justify-content: flex-end;
  }
  .signature-box {
    text-align: center;
    width: 200px;
  }
  .signature-line {
    border-top: 1px solid #333;
    margin-bottom: 4px;
    padding-top: 4px;
  }
  .end-marker {
    text-align: center;
    font-size: 9pt;
    font-style: italic;
    color: #666;
    margin-top: 10px;
  }
  .closing-block {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .data-table {
    margin-top: 8px;
    break-inside: auto;
    page-break-inside: auto;
  }
  .data-table-title {
    font-weight: 600;
    color: #333;
    margin-bottom: 4px;
    font-size: 10pt;
    break-after: avoid;
    page-break-after: avoid;
  }
  .table-chunk + .table-chunk {
    margin-top: 8px;
  }
  .data-table-subtitle {
    font-size: 8pt;
    font-weight: 600;
    color: #666;
    margin: 4px 0;
  }
  .wide-table {
    font-size: 7pt;
    line-height: 1.18;
  }
  .wide-table th,
  .wide-table td {
    padding: 3px 4px;
  }
  .result-table {
    font-variant-numeric: tabular-nums;
  }
  .method-content {
    font-size: 9pt;
  }
  .method-content-section {
    margin-top: 8px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .method-content-section h4 {
    font-size: 9pt;
    font-weight: 700;
    color: #333;
    margin-bottom: 3px;
  }
  .method-content-section p {
    margin-bottom: 4px;
    text-align: justify;
  }
  .method-content-section ul {
    margin: 0;
    padding-left: 16px;
  }
  .method-content-section li {
    margin-bottom: 3px;
  }
  .definition-list {
    margin: 0;
  }
  .definition-list div {
    margin-bottom: 3px;
  }
  .definition-list dt {
    display: inline;
    font-weight: 700;
  }
  .definition-list dd {
    display: inline;
    margin: 0;
  }
  .eccentricity-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 190px;
    gap: 12px;
    align-items: start;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .eccentricity-certificate {
    border: 1px solid #ddd;
    padding: 10px;
    min-height: 170px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .eccentricity-title {
    font-size: 8pt;
    font-weight: 600;
    color: #555;
    margin-bottom: 8px;
  }
  .eccentricity-diagram {
    position: relative;
    width: 150px;
    height: 150px;
    margin: 8px auto 6px;
  }
  .eccentricity-circle {
    position: absolute;
    left: 38px;
    top: 38px;
    width: 74px;
    height: 74px;
    border: 1.5px solid #111;
    border-radius: 999px;
  }
  .eccentricity-line-v {
    position: absolute;
    top: 10px;
    height: 130px;
    left: 50%;
    width: 1px;
    background: #111;
  }
  .eccentricity-line-h {
    position: absolute;
    left: 10px;
    width: 130px;
    top: 50%;
    height: 1px;
    background: #111;
  }
  .eccentricity-point {
    position: absolute;
    color: #111;
    font-size: 12pt;
    font-weight: 700;
    text-align: center;
    z-index: 2;
  }
  .eccentricity-load-a {
    left: 50%;
    top: 50%;
    transform: translate(-50%, -52%);
    background: #fff;
    padding: 0 4px;
    line-height: 1.05;
  }
  .eccentricity-load-b {
    left: 54px;
    top: 50px;
  }
  .eccentricity-load-c {
    right: 54px;
    top: 50px;
  }
  .eccentricity-load-d {
    right: 54px;
    bottom: 45px;
  }
  .eccentricity-load-e {
    left: 54px;
    bottom: 45px;
  }
  .eccentricity-toggle {
    position: absolute;
    width: 16px;
    height: 16px;
    border: 1.3px solid #111;
    background: #fff;
  }
  .eccentricity-toggle.selected {
    border-color: var(--template-primary);
    background: var(--template-primary);
  }
  .eccentricity-toggle.box-top {
    left: 50%;
    top: 0;
    transform: translateX(-50%);
  }
  .eccentricity-toggle.box-right {
    right: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .eccentricity-toggle.box-bottom {
    left: 50%;
    bottom: 0;
    transform: translateX(-50%);
  }
  .eccentricity-toggle.box-left {
    left: 0;
    top: 50%;
    transform: translateY(-50%);
  }
  .eccentricity-status {
    font-size: 8pt;
    text-align: center;
    font-weight: 600;
    border: 0;
    padding: 0;
  }
  .road-eccentricity-diagram {
    margin: 12px auto 10px;
    text-align: center;
  }
  .road-eccentricity-platform {
    width: 165px;
    height: 42px;
    border: 1.5px solid #555;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    align-items: center;
    margin: 0 auto 16px;
  }
  .road-eccentricity-point {
    font-size: 10pt;
    font-weight: 700;
    color: #111;
    line-height: 24px;
    text-align: center;
  }
  .road-eccentricity-point.selected {
    background: var(--template-primary);
    color: #fff;
  }
  .road-eccentricity-indicator {
    width: 34px;
    height: 18px;
    border: 1.5px solid #555;
    margin: 0 auto 4px;
  }
  .road-eccentricity-label {
    font-size: 8pt;
    font-weight: 600;
  }
  .calibration-data-section {
    break-inside: avoid;
    page-break-inside: avoid;
  }
  /* Amendment notice styles - ISO 17025 Clause 7.8.4.1 */
  .amendment-notice {
    border: 2px solid #f97316;
    background: #fff7ed;
    padding: 12px;
    margin-bottom: 16px;
    border-radius: 4px;
  }
  .amendment-notice h3 {
    color: #c2410c;
    font-size: 11pt;
    margin-bottom: 8px;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .amendment-notice p {
    color: #9a3412;
    font-size: 9pt;
    margin-bottom: 4px;
  }
  .amendment-notice strong {
    color: #7c2d12;
  }
  /* Watermark container - covers entire page on every page */
  .superseded-watermark {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    z-index: 9999;
  }
  .superseded-watermark-text {
    font-size: 72pt;
    font-weight: bold;
    color: rgba(239, 68, 68, 0.18);
    transform: rotate(-45deg);
    white-space: nowrap;
    letter-spacing: 8px;
  }
  @media print {
    .superseded-watermark {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
    }
  }
`;

const EXEMPLO_ORG_ID = "Kq3VvX9mZ2LdP8tN4rB7cY1wH6jF5sGe";
const EXEMPLO_FOR51_REVISION = "04";
const EXEMPLO_FOR51_REVISION_DATE = "15/01/2024";
const EXEMPLO_LEGAL_NAME = "Laboratório Exemplo de Metrologia Ltda";
const EXEMPLO_STATE_REGISTRATION = "024/0141636";

const exemploFor51Styles = `
  @page {
    size: A4;
    margin: 0;
  }
  * {
    box-sizing: border-box;
  }
  body {
    --for51-rule: 0.35mm solid #000;
    --for51-frame-rule: 0.55mm solid #000;
    margin: 0;
    background: #fff;
    color: #000;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.7pt;
    line-height: 1.1;
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .for51-page {
    width: 210mm;
    height: 297mm;
    padding: 10mm 14mm 9mm;
    page-break-after: always;
    break-after: page;
    overflow: hidden;
    background: #fff;
    position: relative;
  }
  .for51-page:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .for51-frame {
    width: 100%;
  }
  .for51-table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  .for51-table th,
  .for51-table td {
    border: var(--for51-rule);
    padding: 0.8mm 1.1mm;
    vertical-align: middle;
    overflow-wrap: normal;
    word-break: normal;
  }
  .for51-outer {
    border: var(--for51-frame-rule);
  }
  .for51-header {
    display: grid;
    grid-template-columns: 39mm 1fr 31mm;
    border: var(--for51-frame-rule);
    margin-bottom: 4mm;
    min-height: 17mm;
  }
  .for51-header > div {
    border-right: var(--for51-rule);
    display: flex;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 1.5mm;
  }
  .for51-header > div:last-child {
    border-right: 0;
  }
  .for51-logo {
    max-width: 33mm;
    max-height: 13mm;
    object-fit: contain;
  }
  .for51-logo-text {
    font-size: 13pt;
    font-weight: 800;
    letter-spacing: 0.4mm;
    color: #0b315f;
    line-height: 0.9;
  }
  .for51-logo-text small {
    display: block;
    font-size: 8pt;
    letter-spacing: 0.65mm;
    margin-top: 1mm;
  }
  .for51-title h1,
  .for51-page2-title h1 {
    font-size: 14pt;
    letter-spacing: 0.6mm;
    margin: 0 0 1.5mm;
  }
  .for51-title .number {
    font-size: 12pt;
    font-weight: 800;
  }
  .for51-form-id {
    flex-direction: column;
    gap: 1.7mm;
    font-weight: 800;
    font-size: 9.5pt;
  }
  .for51-lab {
    margin-bottom: 4mm;
  }
  .for51-lab td {
    font-size: 8.7pt;
    padding: 0.9mm;
  }
  .for51-section-title {
    text-align: center;
    font-weight: 800;
    font-size: 9pt;
    padding: 0.75mm;
    border: var(--for51-rule);
    border-bottom: 0;
  }
  .for51-field-label {
    width: 33mm;
    min-width: 33mm;
    font-weight: 400;
    white-space: nowrap;
  }
  .for51-field-label-compact {
    width: 28mm;
    min-width: 28mm;
    font-weight: 400;
    white-space: nowrap;
  }
  .for51-section {
    margin-bottom: 0;
  }
  .for51-section + .for51-section {
    margin-top: -0.35mm;
  }
  .for51-method,
  .for51-conventions,
  .for51-info {
    border: var(--for51-rule);
    border-top: 0;
    padding: 1mm;
  }
  .for51-method p,
  .for51-conventions p,
  .for51-info p {
    margin: 0 0 1mm;
    text-align: justify;
  }
  .for51-info p::before {
    content: "- ";
  }
  .for51-footer-page {
    position: absolute;
    right: 20mm;
    bottom: 5mm;
    font-size: 9pt;
  }
  .for51-page2-shell {
    border: var(--for51-frame-rule);
    height: 272mm;
    position: relative;
    padding: 0 8mm 8mm;
  }
  .for51-page2-heading {
    display: grid;
    grid-template-columns: 1fr 42mm;
    align-items: center;
    margin: 0 -8mm 2mm;
    padding: 1.2mm 2mm 0;
  }
  .for51-page2-title {
    text-align: center;
  }
  .for51-page2-number {
    font-size: 10pt;
    display: flex;
    justify-content: space-between;
    gap: 3mm;
  }
  .for51-results-label {
    font-weight: 800;
    font-size: 10.5pt;
    margin: 0 0 1mm;
  }
  .for51-result-block {
    margin-bottom: 4.5mm;
  }
  .for51-result-block .for51-section-title {
    border-bottom: 0;
  }
  .for51-result-table th,
  .for51-result-table td {
    text-align: center;
    font-size: 8.8pt;
    padding: 1mm 1.1mm;
  }
  .for51-result-table th {
    font-weight: 800;
  }
  .for51-repeat td,
  .for51-repeat th,
  .for51-ecc td,
  .for51-ecc th {
    text-align: center;
    font-size: 8.8pt;
    padding: 1mm 1.1mm;
  }
  .for51-repeat .row-label {
    text-align: left;
    font-weight: 800;
  }
  .for51-ecc-wrap {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 50mm;
    align-items: stretch;
    border: var(--for51-frame-rule);
  }
  .for51-ecc-wrap .for51-ecc {
    border: 0;
    height: 100%;
  }
  .for51-ecc-wrap .for51-ecc th,
  .for51-ecc-wrap .for51-ecc td {
    border-left: 0;
  }
  .for51-diagram-cell {
    border-left: var(--for51-frame-rule);
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 0;
  }
  .for51-diagram {
    position: relative;
    width: 42mm;
    height: 32mm;
    font-size: 9pt;
  }
  .for51-diagram svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .for51-observations {
    margin-top: 4mm;
    border: var(--for51-frame-rule);
    height: 21mm;
  }
  .for51-observations .for51-section-title {
    border: 0;
    border-bottom: var(--for51-rule);
  }
  .for51-signature {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 6mm;
    text-align: center;
    font-size: 9pt;
  }
  .for51-signature img {
    max-width: 55mm;
    max-height: 14mm;
    object-fit: contain;
    display: block;
    margin: 0 auto -1mm;
  }
  .for51-signature-line {
    width: 55mm;
    border-top: var(--for51-rule);
    margin: 0 auto 1mm;
    padding-top: 1mm;
  }
`;

function formatDate(date: Date | null | string): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("pt-BR");
}

function formatNumber(value: number, minDecimals = 4): string {
  let decimals = minDecimals;

  // Auto-expand precision for small numbers (ISO 17025 compliance)
  const abs = Math.abs(value);
  if (abs > 0) {
    if (abs < 0.0001) decimals = 5;
    if (abs < 0.00001) decimals = 6;
    if (abs < 0.000001) decimals = 7;
  }

  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (isMassCompositionValue(value)) return formatMassCompositionCell(value);
  return formatCalibrationValue(value, { decimalSeparator: "," });
}

function formatPlainNumber(value: number, decimals = 1): string {
  return value.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatAddress(address: CustomerAddress | null): string {
  if (!address) return "-";
  const parts = [
    address.street,
    address.number,
    address.complement,
    address.neighbourhood,
    address.city,
    address.state,
    address.cep,
  ].filter(Boolean);
  return parts.join(", ") || "-";
}

function formatLabAddress(lab: JobData["lab"]): string | null {
  const parts = [
    lab.street,
    lab.number,
    lab.complement,
    lab.neighbourhood,
    lab.city,
    lab.state,
    lab.cep,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function calibrationLocationText(job: JobData): string {
  const snapshot = job.calibrationLocationSnapshot;
  if (snapshot?.addressText) return snapshot.addressText;
  return asString(job.data?.local_calibracao) || "";
}

function calibrationLocationChecked(
  job: JobData,
  type: CalibrationLocationSnapshot["type"],
): string {
  return job.calibrationLocationSnapshot?.type === type ? "☒" : "☐";
}

function formatTaxId(taxId: string | null | undefined): string {
  if (!taxId) return "-";
  // Format CNPJ: XX.XXX.XXX/XXXX-XX
  if (taxId.length === 14) {
    return `${taxId.slice(0, 2)}.${taxId.slice(2, 5)}.${taxId.slice(5, 8)}/${taxId.slice(8, 12)}-${taxId.slice(12)}`;
  }
  // Format CPF: XXX.XXX.XXX-XX
  if (taxId.length === 11) {
    return `${taxId.slice(0, 3)}.${taxId.slice(3, 6)}.${taxId.slice(6, 9)}-${taxId.slice(9)}`;
  }
  return taxId;
}

function getArrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0;
}

function getIndexedValue(value: unknown, index: number): unknown {
  return Array.isArray(value) ? value[index] : value;
}

function formatValueWithUnit(value: unknown, unit?: string): string {
  const formatted = formatValue(value);
  return unit ? `${formatted} ${unit}` : formatted;
}

function resolveDocumentDisplayUnit(
  assetBaseMeasurementUnit: MassUnit | null | undefined,
  literalUnit: string | null | undefined,
) {
  return (
    resolveMassDisplayUnit(assetBaseMeasurementUnit, literalUnit) ??
    literalUnit ??
    undefined
  );
}

function convertCanonicalValueForDisplay(
  value: unknown,
  literalUnit: string | null | undefined,
  assetBaseMeasurementUnit: MassUnit | null | undefined,
) {
  if (
    typeof value !== "number" ||
    !assetBaseMeasurementUnit ||
    !isMassMeasurementUnit(literalUnit)
  ) {
    return value;
  }

  return convertMassValue(value, "g", assetBaseMeasurementUnit) ?? value;
}

function convertOriginalUnitValueForDisplay(
  value: unknown,
  originalUnit: string | null | undefined,
  assetBaseMeasurementUnit: MassUnit | null | undefined,
) {
  if (
    typeof value !== "number" ||
    !assetBaseMeasurementUnit ||
    !isMassMeasurementUnit(originalUnit)
  ) {
    return value;
  }

  return (
    convertMassValue(value, originalUnit, assetBaseMeasurementUnit) ?? value
  );
}

function formatCanonicalValueWithResolvedUnit(
  value: unknown,
  literalUnit: string | null | undefined,
  assetBaseMeasurementUnit: MassUnit | null | undefined,
): string {
  return formatValueWithUnit(
    convertCanonicalValueForDisplay(
      value,
      literalUnit,
      assetBaseMeasurementUnit,
    ),
    resolveDocumentDisplayUnit(assetBaseMeasurementUnit, literalUnit),
  );
}

function formatOriginalUnitValueWithResolvedUnit(
  value: unknown,
  originalUnit: string | null | undefined,
  assetBaseMeasurementUnit: MassUnit | null | undefined,
): string {
  return formatValueWithUnit(
    convertOriginalUnitValueForDisplay(
      value,
      originalUnit,
      assetBaseMeasurementUnit,
    ),
    resolveDocumentDisplayUnit(assetBaseMeasurementUnit, originalUnit),
  );
}

function hasCertifiedValues(std: StandardSnapshot): boolean {
  return !!std.certifiedValues?.length;
}

function formatStandardUncertainty(
  std: StandardSnapshot,
  showCertifiedValuesTable: boolean,
  assetBaseMeasurementUnit: MassUnit | null | undefined,
): string {
  if (hasCertifiedValues(std)) {
    return showCertifiedValuesTable
      ? "Vários (ver tabela)"
      : "Conforme certificado";
  }

  return std.uncertainty !== null
    ? `±${formatCalibrationValue(
        convertOriginalUnitValueForDisplay(
          std.uncertainty,
          std.uncertaintyUnit,
          assetBaseMeasurementUnit,
        ),
      )} ${
        resolveDocumentDisplayUnit(
          assetBaseMeasurementUnit,
          std.uncertaintyUnit,
        ) || ""
      }`
    : "-";
}

function isMassCompositionValue(value: unknown): value is MassCompositionValue {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "mass_standard_composition" &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function formatMassCompositionCell(value: MassCompositionValue): string {
  return value.label || "-";
}

function getCompositionPointLabel(
  field: MethodInputField,
  row: Record<string, unknown>,
  index: number,
): string {
  const preferredKeys = [
    "ponto",
    "point",
    "valor_padrao",
    "valor_nominal",
    "nominal",
  ];

  for (const key of preferredKeys) {
    const value = row[key];
    if (value !== null && value !== undefined && value !== "") {
      return formatValue(value);
    }
  }

  return `${field.label} ${index + 1}`;
}

function collectMassCompositions(
  dataFields: MethodInputField[],
  data: Record<string, unknown> | null | undefined,
): MassCompositionCertificateRow[] {
  if (!data) return [];

  const rows: MassCompositionCertificateRow[] = [];
  for (const field of dataFields) {
    if (field.type !== "table") continue;
    const tableData = data[field.key];
    if (!Array.isArray(tableData)) continue;

    tableData.forEach((rowValue, rowIndex) => {
      if (typeof rowValue !== "object" || rowValue === null) return;
      const row = rowValue as Record<string, unknown>;
      const point = getCompositionPointLabel(field, row, rowIndex);

      for (const value of Object.values(row)) {
        if (!isMassCompositionValue(value)) continue;
        for (const item of value.items) {
          rows.push({
            point,
            composition: value.label,
            item,
          });
        }
      }
    });
  }

  return rows;
}

function formatReportedValue(
  entry: { formula?: MethodFormula },
  value: unknown,
  assetBaseMeasurementUnit: MassUnit | null | undefined,
): string {
  const formatted = formatValue(
    convertCanonicalValueForDisplay(
      value,
      entry.formula?.unit,
      assetBaseMeasurementUnit,
    ),
  );
  const role = entry.formula?.reporting?.role;
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : NaN;

  if (role === "expanded_uncertainty" && formatted !== "-") {
    return `±${formatted.replace(/^[+-]/, "")}`;
  }

  if (role === "primary_result" && Number.isFinite(numeric) && numeric > 0) {
    return `+${formatted}`;
  }

  return formatted;
}

function getPointLabels(
  dataFields: MethodInputField[],
  data: Record<string, unknown> | null,
) {
  const tableField = dataFields.find((field) => field.type === "table");
  const rows = tableField && data ? data[tableField.key] : null;
  if (!Array.isArray(rows)) {
    return [] as string[];
  }

  return rows.map((row, index) => {
    const record = row as Record<string, unknown>;
    const point =
      record.ponto ?? record.point ?? record.nominal ?? record.valor_nominal;
    return point != null && point !== "" ? String(point) : String(index + 1);
  });
}

function normalizeText(value: string | null | undefined) {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function getCircularEccentricityLoadPositions(
  field: MethodInputField,
  data: unknown[],
) {
  const positionColumn = field.columns?.find((column) => {
    const text = normalizeText(`${column.key} ${column.label}`);
    return text.includes("posicao") || text.includes("ponto");
  });

  if (!positionColumn) {
    return Object.keys(CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES);
  }

  const positions: string[] = [];
  for (const row of data) {
    if (!row || typeof row !== "object") continue;

    const rawValue = (row as Record<string, unknown>)[positionColumn.key];
    const value = formatValue(rawValue).trim().toUpperCase();
    if (
      value in CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES &&
      !positions.includes(value)
    ) {
      positions.push(value);
    }
  }

  return positions.length > 0
    ? positions
    : Object.keys(CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES);
}

function isInformationBulletSection(items: string[]) {
  const text = normalizeText(items.join(" "));
  return (
    text.includes("metrologia legal") ||
    text.includes("ea-4/02") ||
    text.includes("estado do instrumento")
  );
}

function isBalanceLikeMethod(methodSnapshot: MethodSnapshot | undefined) {
  const methodText = normalizeText(
    `${methodSnapshot?.methodName ?? ""} ${methodSnapshot?.dataFields
      ?.map((field) => `${field.key} ${field.label}`)
      .join(" ")}`,
  );

  return (
    methodText.includes("balanca") ||
    methodText.includes("balance") ||
    methodText.includes("pesagem")
  );
}

function hasCertificateInformationSection(
  sections: MethodCertificateContentSection[],
) {
  const text = normalizeText(
    sections
      .map((section) => {
        if (section.kind === "definition_list") {
          return section.items
            .map((item) => `${item.term} ${item.definition}`)
            .join(" ");
        }
        if (section.kind === "bullets") {
          return `${section.title ?? ""} ${section.items.join(" ")}`;
        }
        return `${section.title} ${section.paragraphs.join(" ")}`;
      })
      .join(" "),
  );

  return (
    text.includes("informacoes") ||
    text.includes("ea-4/02") ||
    text.includes("metrologia legal")
  );
}

function getEffectiveMethodCertificateSections(
  content: MethodCertificateContent | null | undefined,
  methodSnapshot: MethodSnapshot | undefined,
) {
  const sections = content?.sections ?? [];
  const hasConfiguredSections = hasMethodCertificateSections(content);
  const isBalanceMethod = isBalanceLikeMethod(methodSnapshot);

  if (hasConfiguredSections) {
    return isBalanceMethod && !hasCertificateInformationSection(sections)
      ? [...sections, BALANCE_INFORMATION_SECTION]
      : sections;
  }

  return isBalanceMethod ? BALANCE_FALLBACK_CERTIFICATE_SECTIONS : sections;
}

function getPrintableColumnChunks(columns: MethodTableColumn[]) {
  if (columns.length <= MAX_PRINT_TABLE_COLUMNS) {
    return [columns];
  }

  const anchorColumns = columns.slice(0, 1);
  const remainingColumns = columns.slice(1);
  const columnsPerChunk = Math.max(
    1,
    MAX_PRINT_TABLE_COLUMNS - anchorColumns.length,
  );
  const chunks: MethodTableColumn[][] = [];

  for (
    let index = 0;
    index < remainingColumns.length;
    index += columnsPerChunk
  ) {
    chunks.push([
      ...anchorColumns,
      ...remainingColumns.slice(index, index + columnsPerChunk),
    ]);
  }

  return chunks;
}

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isEccentricityIndicatorPosition(
  value: unknown,
  variant: EccentricityIndicatorVariant = "circular_platform",
): value is EccentricityIndicatorPosition {
  const options =
    variant === "road_scale"
      ? ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS
      : ECCENTRICITY_INDICATOR_OPTIONS;

  return (
    typeof value === "string" &&
    options.some((option) => option.value === value)
  );
}

function getEccentricityIndicatorVariant(
  field: MethodInputField | undefined,
): EccentricityIndicatorVariant | null {
  if (!field?.eccentricityIndicator?.enabled) return null;
  return field.eccentricityIndicator.variant ?? "circular_platform";
}

function getEccentricityIndicatorPosition(
  job: JobData,
  variant: EccentricityIndicatorVariant,
) {
  const assetValue =
    job.assetSnapshot?.specifications?.[ECCENTRICITY_INDICATOR_SPEC_KEY];
  if (isEccentricityIndicatorPosition(assetValue, variant)) {
    return assetValue;
  }

  const savedValue = job.data?.[ECCENTRICITY_INDICATOR_SPEC_KEY];
  if (isEccentricityIndicatorPosition(savedValue, variant)) {
    return savedValue;
  }

  return null;
}

function isEccentricityCalibrationField(field: MethodInputField) {
  if (field.eccentricityIndicator?.enabled) {
    return true;
  }

  const fieldText = normalizeText(`${field.key} ${field.label}`);
  if (fieldText.includes("excentric") || fieldText.includes("eccentric")) {
    return true;
  }

  const columnText = normalizeText(
    field.columns?.map((column) => `${column.key} ${column.label}`).join(" "),
  );

  return (
    field.type === "table" &&
    (columnText.includes("ponto") || columnText.includes("point")) &&
    (columnText.includes("indicacao") ||
      columnText.includes("leitura") ||
      columnText.includes("erro") ||
      columnText.includes("reading") ||
      columnText.includes("error"))
  );
}

function CertificateEccentricityDiagram({
  selectedPosition,
  variant,
  loadPositions,
}: {
  selectedPosition: EccentricityIndicatorPosition | null;
  variant: EccentricityIndicatorVariant;
  loadPositions?: string[];
}) {
  const options =
    variant === "road_scale"
      ? ROAD_SCALE_ECCENTRICITY_INDICATOR_OPTIONS
      : ECCENTRICITY_INDICATOR_OPTIONS;
  const selectedOption = options.find(
    (option) => option.value === selectedPosition,
  );
  const circularLoadPositions = (
    loadPositions ?? Object.keys(CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES)
  ).filter((position) => position in CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES);

  return (
    <div className="eccentricity-certificate">
      <div className="eccentricity-title">Posição do indicador da balança</div>
      {variant === "road_scale" ? (
        <div className="road-eccentricity-diagram" aria-hidden="true">
          <div className="road-eccentricity-platform">
            {options.map((option) => (
              <div
                key={option.value}
                className={`road-eccentricity-point ${
                  selectedPosition === option.value ? "selected" : ""
                }`}
              >
                {option.value}
              </div>
            ))}
          </div>
          <div className="road-eccentricity-indicator" />
          <div className="road-eccentricity-label">Posição do indicador</div>
        </div>
      ) : (
        <div className="eccentricity-diagram" aria-hidden="true">
          <div className="eccentricity-circle" />
          <div className="eccentricity-line-v" />
          <div className="eccentricity-line-h" />
          {circularLoadPositions.map((position) => (
            <div
              key={position}
              className={`eccentricity-point ${
                CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES[
                  position as keyof typeof CIRCULAR_ECCENTRICITY_LOAD_POINT_CLASSES
                ]
              }`}
            >
              {position}
            </div>
          ))}
          {options.map((option) => (
            <div
              key={option.value}
              className={`eccentricity-toggle ${option.className} ${
                selectedPosition === option.value ? "selected" : ""
              }`}
            />
          ))}
        </div>
      )}
      <div className="eccentricity-status">
        {selectedOption
          ? `Posição do indicador: ${selectedOption.label}`
          : "Posição do indicador"}
      </div>
    </div>
  );
}

// Render a data table based on method dataField definition
function DataTable({
  field,
  data,
  assetBaseMeasurementUnit,
}: {
  field: MethodInputField;
  data: unknown[];
  assetBaseMeasurementUnit?: MassUnit | null;
}) {
  if (!field.columns || !Array.isArray(data) || data.length === 0) {
    return null;
  }

  const columnChunks = getPrintableColumnChunks(field.columns);
  const isWideTable = field.columns.length > MAX_PRINT_TABLE_COLUMNS;

  return (
    <div className="data-table">
      <div className="data-table-title">{field.label}</div>
      {columnChunks.map((columns, chunkIndex) => (
        <div className="table-chunk" key={chunkIndex}>
          {columnChunks.length > 1 && (
            <div className="data-table-subtitle">
              {chunkIndex === 0
                ? "Colunas principais"
                : `Continuação ${chunkIndex + 1}`}
            </div>
          )}
          <table className={isWideTable ? "wide-table result-table" : ""}>
            <thead>
              <tr>
                {columns.map((col) => (
                  <th key={col.key}>
                    {col.label}
                    {resolveDocumentDisplayUnit(
                      assetBaseMeasurementUnit,
                      col.unit,
                    )
                      ? ` (${resolveDocumentDisplayUnit(
                          assetBaseMeasurementUnit,
                          col.unit,
                        )})`
                      : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((row, i) => (
                <tr key={i}>
                  {columns.map((col) => (
                    <td key={col.key}>
                      {formatCanonicalValueWithResolvedUnit(
                        (row as Record<string, unknown>)[col.key],
                        col.unit,
                        assetBaseMeasurementUnit,
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

function hasMethodCertificateSections(
  content: MethodCertificateContent | null | undefined,
) {
  return (content?.sections ?? []).some((section) => {
    if (section.kind === "definition_list") {
      return section.items.some(
        (item) => item.term.trim() || item.definition.trim(),
      );
    }
    if (section.kind === "bullets") {
      return section.items.some((item) => item.trim());
    }
    return section.paragraphs.some((paragraph) => paragraph.trim());
  });
}

function renderMethodCertificateSection(
  section: MethodCertificateContentSection,
  index: number,
) {
  if (section.kind === "definition_list") {
    const items = section.items.filter(
      (item) => item.term.trim() || item.definition.trim(),
    );
    if (items.length === 0) return null;

    return (
      <div className="method-content-section" key={index}>
        <h4>{section.title}</h4>
        <dl className="definition-list">
          {items.map((item, itemIndex) => (
            <div key={itemIndex}>
              <dt>{item.term}:</dt> <dd>{item.definition}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  }

  if (section.kind === "bullets") {
    const items = section.items.filter((item) => item.trim());
    if (items.length === 0) return null;
    const title =
      section.title?.trim() ||
      (isInformationBulletSection(items) ? "INFORMAÇÕES" : null);

    return (
      <div className="method-content-section" key={index}>
        {title && <h4>{title}</h4>}
        <ul>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{item}</li>
          ))}
        </ul>
      </div>
    );
  }

  const paragraphs = section.paragraphs.filter((paragraph) => paragraph.trim());
  if (paragraphs.length === 0) return null;

  return (
    <div className="method-content-section" key={index}>
      <h4>{section.title}</h4>
      {paragraphs.map((paragraph, paragraphIndex) => (
        <p key={paragraphIndex}>{paragraph}</p>
      ))}
    </div>
  );
}

function shouldRenderExemploFor51(job: JobData) {
  const slug = job.certificateTemplateSnapshot?.slug ?? "";
  return (
    job.organizationId === EXEMPLO_ORG_ID &&
    isBalanceLikeMethod(job.methodSnapshot) &&
    (slug.includes("certificado-rastreavel-de-balancas") ||
      job.methodSnapshot?.methodName?.includes("FOR 50/51"))
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asString(value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  return String(value);
}

function formatFor51Number(value: number | null, decimals = 1) {
  if (value === null || !Number.isFinite(value)) return "";
  return value.toLocaleString("pt-BR", {
    useGrouping: false,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatFor51MassFromG(value: unknown, decimals = 1) {
  const numeric = asNumber(value);
  return formatFor51Number(numeric === null ? null : numeric / 1000, decimals);
}

function convertFor51MassToKg(value: unknown, unit: unknown = "g") {
  const numeric = asNumber(value);
  if (numeric === null) return null;

  if (isMassMeasurementUnit(unit)) {
    return convertMassValue(numeric, unit, "kg") ?? null;
  }

  return numeric / 1000;
}

function getDecimalPlacesForIncrement(value: number | null) {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;

  for (let decimals = 0; decimals <= 6; decimals += 1) {
    const factor = 10 ** decimals;
    if (Math.abs(Math.round(value * factor) / factor - value) < 1e-12) {
      return decimals;
    }
  }

  return 6;
}

function formatFor51IntegerMassFromG(value: unknown) {
  const numeric = asNumber(value);
  if (numeric === null) return "";
  const kg = numeric / 1000;
  return Number.isInteger(kg)
    ? String(kg)
    : formatFor51Number(kg, Math.abs(kg) < 10 ? 3 : 1);
}

function formatFor51Date(date: Date | null | string) {
  const formatted = formatDate(date);
  return formatted === "-" ? "" : formatted;
}

function getFor51DecimalPlaces(job: JobData) {
  const spec = job.assetSnapshot?.specifications ?? {};
  const resolutionDecimals = getDecimalPlacesForIncrement(
    convertFor51MassToKg(spec.resolution, spec.resolutionUnit),
  );

  if (resolutionDecimals !== null) {
    return resolutionDecimals;
  }

  const ranges = Array.isArray(spec.weighingRanges) ? spec.weighingRanges : [];
  const rangeDecimals = ranges
    .map((range) => {
      const item = asRecord(range);
      return getDecimalPlacesForIncrement(
        convertFor51MassToKg(item.resolution, item.resolutionUnit),
      );
    })
    .filter((value): value is number => value !== null);

  return rangeDecimals.length > 0 ? Math.max(...rangeDecimals) : 1;
}

function getFor51Rows(job: JobData, key: string) {
  const value = job.data?.[key];
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function getFor51ResultValue(job: JobData, key: string, index: number) {
  const value = job.results?.[key];
  return Array.isArray(value) ? value[index] : value;
}

function getFor51RowDecimalPlaces(
  row: Record<string, unknown>,
  fallbackDecimals: number,
) {
  return (
    getDecimalPlacesForIncrement(convertFor51MassToKg(row.divisao, "g")) ??
    getDecimalPlacesForIncrement(
      convertFor51MassToKg(row.resolution, row.resolutionUnit),
    ) ??
    fallbackDecimals
  );
}

function getFor51AssetSpec(job: JobData, key: string) {
  return job.assetSnapshot?.specifications?.[key];
}

function formatFor51Capacity(job: JobData) {
  return `${formatFor51IntegerMassFromG(getFor51AssetSpec(job, "capacity"))}kg`;
}

function formatFor51Resolution(job: JobData) {
  const spec = job.assetSnapshot?.specifications ?? {};
  const resolutionKg = convertFor51MassToKg(
    spec.resolution,
    spec.resolutionUnit,
  );
  return `${formatFor51Number(resolutionKg, getFor51DecimalPlaces(job))}kg`;
}

function getFor51Portaria(job: JobData) {
  return (
    asString(getFor51AssetSpec(job, "portaria")) ||
    asString(getFor51AssetSpec(job, "ordinance"))
  );
}

function getFor51ModelPortaria(job: JobData) {
  const model = job.asset.model || "";
  const portaria = getFor51Portaria(job);
  return [model, portaria].filter(Boolean).join(" / ");
}

function getFor51InmetroRepairSeal(job: JobData) {
  return (
    job.serviceOrder?.inmetroRepairSealNumber ||
    asString(getFor51AssetSpec(job, "inmetroRepairSealNumber")) ||
    asString(getFor51AssetSpec(job, "seloReparadoInmetro")) ||
    "-"
  );
}

function getFor51InstrumentName(job: JobData) {
  const name = normalizeText(
    job.assetSnapshot?.assetTypeName ?? job.asset.name,
  );
  return name.includes("balanca") ? "Balança" : job.asset.name;
}

function getFor51Website(job: JobData) {
  return (job.lab.website || "www.laboratorio.example").replace(
    /^https?:\/\//,
    "",
  );
}

function formatFor51LabAddress(job: JobData) {
  const street = job.lab.street?.replace(/^Avenida\b/i, "Av.") || "";
  return [
    [street, job.lab.number].filter(Boolean).join(", "),
    job.lab.neighbourhood ? `Bairro ${job.lab.neighbourhood}` : "",
    job.lab.city,
    job.lab.state,
  ]
    .filter(Boolean)
    .join(" - ");
}

function getFor51StandardIssuer(standard: StandardSnapshot) {
  return (
    standard.calibratedBy ||
    standard.certificateNumber.split("-")[0] ||
    "Conforme certificado"
  );
}

function getFor51ReferenceStandards(job: JobData) {
  const standards = job.methodSnapshot?.certificateContent?.referenceStandards;
  return standards?.filter((item) => item.trim()).join(" e ") || "";
}

function getFor51RepeatabilityValues(
  rows: Record<string, unknown>[],
  kind: "antes" | "apos",
  fallbackRows: Record<string, unknown>[],
) {
  const row = rows[0] ?? {};
  const prefix = kind === "apos" ? "apos_" : "";
  const explicit = [1, 2, 3, 4, 5].map((index) =>
    asNumber(row[`${prefix}leitura_${index}`]),
  );
  if (explicit.every((value) => value !== null)) {
    return explicit as number[];
  }

  if (kind === "antes") {
    return [1, 2, 3, 4, 5]
      .map((index) => asNumber(row[`leitura_${index}`]))
      .filter((value): value is number => value !== null);
  }

  const middle = fallbackRows[Math.floor(fallbackRows.length / 2)] ?? {};
  return [1, 2, 3, 4, 5]
    .map(
      (index) =>
        asNumber(row[`apos_leitura_${index}`]) ??
        asNumber(middle[`apos_leitura_${Math.min(index, 3)}`]),
    )
    .filter((value): value is number => value !== null);
}

function sampleStandardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (values.length - 1);
  return Math.sqrt(variance);
}

function formatFor51Veff(value: unknown) {
  const raw = asString(value);
  if (raw === "Infinity" || raw === "infinito") return "infinito";
  const numeric = asNumber(value);
  if (numeric === null) return raw;
  return numeric >= 1_000_000_000 ? "infinito" : formatFor51Number(numeric, 0);
}

function formatFor51K(value: unknown) {
  const numeric = asNumber(value);
  return numeric === null ? asString(value) : formatFor51Number(numeric, 2);
}

function isFor51PhaseActive(
  job: JobData,
  blockKey: "indication" | "repeatability" | "eccentricity",
  phase: "before" | "after",
) {
  const mode =
    job.calibrationPhaseSnapshot?.blocks?.[blockKey]?.mode ??
    "before_and_after";
  if (mode === "before_and_after") return true;
  if (mode === "before_only") return phase === "before";
  if (mode === "after_only") return phase === "after";
  if (mode === "not_performed") return false;
  return true;
}

function for51PhaseText(
  active: boolean,
  value: unknown,
  decimals: number,
): string {
  return active ? formatFor51MassFromG(value, decimals) : "x";
}

function for51PhaseK(active: boolean, value: unknown): string {
  return active ? formatFor51K(value) : "x";
}

function for51PhaseVeff(active: boolean, value: unknown): string {
  return active ? formatFor51Veff(value) : "x";
}

function renderFor51ResultRows(
  job: JobData,
  kind: "antes" | "apos",
  decimals: number,
) {
  const phase = kind === "antes" ? "before" : "after";
  const phaseActive = isFor51PhaseActive(job, "indication", phase);
  const pointRows = getFor51Rows(job, "pontos_indicacao");
  const mediaKey =
    kind === "antes" ? "media_indicacao_antes" : "media_indicacao_apos";
  const errorKey =
    kind === "antes" ? "erro_indicacao_antes" : "erro_indicacao_apos";
  const uncertaintyKey =
    kind === "antes" ? "incerteza_expandida_antes" : "incerteza_expandida_apos";
  const kKey = kind === "antes" ? "fator_k_antes" : "fator_k_apos";
  const veffKey = kind === "antes" ? "veff_antes" : "veff_apos";
  const readingPrefix = kind === "antes" ? "antes" : "apos";

  return (
    <>
      {pointRows.map((row, index) => {
        const rowDecimals = getFor51RowDecimalPlaces(row, decimals);

        return (
          <tr key={`${kind}-${index}`}>
            <td>{formatFor51IntegerMassFromG(row.valor_padrao)}</td>
            <td>kg</td>
            <td>
              {for51PhaseText(
                phaseActive,
                row[`${readingPrefix}_leitura_1`],
                rowDecimals,
              )}
            </td>
            <td>
              {for51PhaseText(
                phaseActive,
                row[`${readingPrefix}_leitura_2`],
                rowDecimals,
              )}
            </td>
            <td>
              {for51PhaseText(
                phaseActive,
                row[`${readingPrefix}_leitura_3`],
                rowDecimals,
              )}
            </td>
            <td>
              {for51PhaseText(
                phaseActive,
                getFor51ResultValue(job, mediaKey, index),
                rowDecimals,
              )}
            </td>
            <td>
              {for51PhaseText(
                phaseActive,
                getFor51ResultValue(job, errorKey, index),
                rowDecimals,
              )}
            </td>
            <td>
              {for51PhaseText(
                phaseActive,
                getFor51ResultValue(job, uncertaintyKey, index),
                rowDecimals,
              )}
            </td>
            <td>
              {for51PhaseK(phaseActive, getFor51ResultValue(job, kKey, index))}
            </td>
            <td>
              {for51PhaseVeff(
                phaseActive,
                getFor51ResultValue(job, veffKey, index),
              )}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function ExemploFor51CertificateHtml({ job }: { job: JobData }) {
  const decimals = getFor51DecimalPlaces(job);
  const pointRows = getFor51Rows(job, "pontos_indicacao");
  const repeatabilityRows = getFor51Rows(job, "repetibilidade");
  const eccentricityRows = getFor51Rows(job, "excentricidade");
  const repeatBefore = getFor51RepeatabilityValues(
    repeatabilityRows,
    "antes",
    pointRows,
  );
  const repeatAfter = getFor51RepeatabilityValues(
    repeatabilityRows,
    "apos",
    pointRows,
  );
  const observation = asString(job.data?.observacao);
  const renderBeforeIndication =
    pointRows.length > 0 && isFor51PhaseActive(job, "indication", "before");
  const renderAfterIndication =
    pointRows.length > 0 && isFor51PhaseActive(job, "indication", "after");

  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <title>{job.certificateName || job.jobId}</title>
        <style
          dangerouslySetInnerHTML={{
            __html: exemploFor51Styles,
          }}
        />
      </head>
      <body data-pdf-layout="full-page">
        <section className="for51-page">
          <div className="for51-frame">
            <div className="for51-header">
              <div>
                {job.lab.logo ? (
                  <img
                    src={job.lab.logo}
                    alt={job.lab.name}
                    className="for51-logo"
                  />
                ) : (
                  <div className="for51-logo-text">
                    EXEMPLO
                    <small>BALANÇAS</small>
                  </div>
                )}
              </div>
              <div className="for51-title">
                <div>
                  <h1>CERTIFICADO DE CALIBRAÇÃO</h1>
                  <div className="number">Nº.: {job.jobId}</div>
                </div>
              </div>
              <div className="for51-form-id">
                <div>FOR 51</div>
                <div>REVISÃO: {EXEMPLO_FOR51_REVISION}</div>
                <div>{EXEMPLO_FOR51_REVISION_DATE}</div>
              </div>
            </div>

            <table className="for51-table for51-lab for51-outer">
              <tbody>
                <tr>
                  <td>
                    <div>{EXEMPLO_LEGAL_NAME}</div>
                    <div>{formatFor51LabAddress(job)}</div>
                    <div>
                      CNPJ: {formatTaxId(job.lab.cnpj)} &nbsp;&nbsp;&nbsp;&nbsp;
                      IE {EXEMPLO_STATE_REGISTRATION}
                    </div>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <div>Fone: {job.lab.phone || "(51) 3000-0000"}</div>
                    <div>
                      Email: {job.lab.email || "contato@laboratorio.example"}
                    </div>
                    <div>Website: {getFor51Website(job)}</div>
                  </td>
                </tr>
              </tbody>
            </table>

            <div className="for51-section">
              <div className="for51-section-title">DADOS DO CLIENTE</div>
              <table className="for51-table for51-outer">
                <tbody>
                  <tr>
                    <td className="for51-field-label">Cliente:</td>
                    <td>{job.customer.name}</td>
                    <td className="for51-field-label-compact">CNPJ:</td>
                    <td>{formatTaxId(job.customer.taxId)}</td>
                  </tr>
                  <tr>
                    <td className="for51-field-label">Endereço:</td>
                    <td colSpan={3}>{formatAddress(job.customer.address)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">
                CARACTERÍSTICA DO EQUIPAMENTO
              </div>
              <table className="for51-table for51-outer">
                <tbody>
                  <tr>
                    <td className="for51-field-label">Instrumento:</td>
                    <td>{getFor51InstrumentName(job)}</td>
                    <td className="for51-field-label-compact">Capacidade:</td>
                    <td>{formatFor51Capacity(job)}</td>
                  </tr>
                  <tr>
                    <td className="for51-field-label">Fabricante:</td>
                    <td>{job.asset.manufacturer || ""}</td>
                    <td className="for51-field-label-compact">Divisão:</td>
                    <td>{formatFor51Resolution(job)}</td>
                  </tr>
                  <tr>
                    <td className="for51-field-label">Modelo/Port.:</td>
                    <td>{getFor51ModelPortaria(job)}</td>
                    <td className="for51-field-label-compact">Código:</td>
                    <td>{job.asset.tag || ""}</td>
                  </tr>
                  <tr>
                    <td className="for51-field-label">Série:</td>
                    <td>{job.asset.serialNumber}</td>
                    <td className="for51-field-label-compact">Rep. INMETRO:</td>
                    <td>{getFor51InmetroRepairSeal(job)}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">DADOS GERAIS</div>
              <table className="for51-table for51-outer">
                <tbody>
                  <tr>
                    <td className="for51-field-label">Data de Calibração:</td>
                    <td>{formatFor51Date(job.performedAt)}</td>
                    <td className="for51-field-label">Data de Emissão:</td>
                    <td>{formatFor51Date(job.approvedAt)}</td>
                  </tr>
                  <tr>
                    <td className="for51-field-label">Procedimento:</td>
                    <td>
                      {job.methodSnapshot?.certificateContent?.procedureCode ||
                        ""}
                    </td>
                    <td className="for51-field-label">Norma de Ref.:</td>
                    <td>{getFor51ReferenceStandards(job)}</td>
                  </tr>
                  <tr>
                    <td className="for51-field-label">Local da Calibração:</td>
                    <td colSpan={3}>
                      {calibrationLocationChecked(job, "customer_site")} Cliente{" "}
                      {calibrationLocationChecked(job, "lab")} Laboratório{" "}
                      {calibrationLocationChecked(job, "other")} Outro
                      <br />
                      {calibrationLocationText(job)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">CONDIÇÕES AMBIENTAIS</div>
              <table className="for51-table for51-outer">
                <tbody>
                  <tr>
                    <td>Temperatura:</td>
                    <td style={{ textAlign: "center" }}>
                      {job.environmentalSnapshot?.temperature == null
                        ? "x"
                        : `${formatFor51Number(
                            job.environmentalSnapshot.temperature,
                            1,
                          )} ºC`}
                    </td>
                    <td>Umidade Relativa:</td>
                    <td style={{ textAlign: "center" }}>
                      {job.environmentalSnapshot?.humidity == null
                        ? "x"
                        : `${formatFor51Number(
                            job.environmentalSnapshot.humidity,
                            1,
                          )} %`}
                    </td>
                    <td>Pressão atm:</td>
                    <td style={{ textAlign: "center" }}>
                      {job.environmentalSnapshot?.pressure == null
                        ? "x"
                        : `${formatFor51Number(
                            job.environmentalSnapshot.pressure,
                            1,
                          )} hPa`}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">RASTREABILIDADE</div>
              <table className="for51-table for51-outer">
                <thead>
                  <tr>
                    <th>Identificação</th>
                    <th>Número do Certificado</th>
                    <th>Emitente</th>
                    <th>Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {(job.standardsSnapshot ?? []).map((standard) => (
                    <tr key={standard.id}>
                      <td style={{ textAlign: "center" }}>{standard.name}</td>
                      <td style={{ textAlign: "center" }}>
                        {standard.certificateNumber}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {getFor51StandardIssuer(standard)}
                      </td>
                      <td style={{ textAlign: "center" }}>
                        {formatFor51Date(
                          standard.nextCalibrationDate ??
                            standard.calibrationDate,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">MÉTODO</div>
              <div className="for51-method">
                <p>
                  A calibração é realizada por meio de comparação direta entre
                  os valores dos pesos padrão e a indicação da balança.
                </p>
              </div>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">CONVENÇÕES</div>
              <div className="for51-conventions">
                <p>
                  <strong>VC:</strong> Valor Convencional, valor correspondente
                  ao padrão utilizado.
                </p>
                <p>
                  <strong>EI:</strong> Erro de Indicação, (VI - VC) .
                </p>
                <p>
                  <strong>U:</strong> Incerteza expandida.
                </p>
              </div>
            </div>

            <div className="for51-section">
              <div className="for51-section-title">INFORMAÇÕES</div>
              <div className="for51-info">
                <p>
                  A Incerteza expandida de medição relatada é declarada como a
                  incerteza padrão de medição multiplicada pelo fator de
                  abrangência k, o qual para uma distribuição t-Student, com
                  Veff graus de liberdade efetivos corresponde a uma
                  probabilidade de abrangência de aproximadamente 95%. A
                  incerteza padrão de medição foi determinada de acordo com a
                  publicação EA-4/02. Os valores de k e Veff são apresentados na
                  tabela de resultados.
                </p>
                <p>
                  Os resultados deste certificado referem-se exclusivamente ao
                  instrumento submetido à calibração específica, não sendo
                  extensivo a quaisquer lotes.
                </p>
                <p>
                  Este certificado não tem valor para fins de metrologia legal.
                </p>
                <p>
                  Os resultados são válidos somente para o estado do instrumento
                  no momento da calibração.
                </p>
              </div>
            </div>
          </div>
          <div className="for51-footer-page">Página 1/2</div>
        </section>

        <section className="for51-page">
          <div className="for51-page2-shell">
            <div className="for51-page2-heading">
              <div className="for51-page2-title">
                <h1>CERTIFICADO DE CALIBRAÇÃO</h1>
              </div>
              <div className="for51-page2-number">
                <strong>Nº:</strong>
                <span>{job.jobId}</span>
              </div>
            </div>
            <div className="for51-results-label">RESULTADOS:</div>

            {renderBeforeIndication ? (
              <div className="for51-result-block">
                <div className="for51-section-title">
                  CALIBRAÇÃO ANTES DO AJUSTE
                </div>
                <table className="for51-table for51-result-table for51-outer">
                  <thead>
                    <tr>
                      <th>V C</th>
                      <th>Unid</th>
                      <th>Leitura 1</th>
                      <th>Leitura 2</th>
                      <th>Leitura 3</th>
                      <th>Média</th>
                      <th>EI</th>
                      <th>U</th>
                      <th>K</th>
                      <th>Veff</th>
                    </tr>
                  </thead>
                  <tbody>{renderFor51ResultRows(job, "antes", decimals)}</tbody>
                </table>
              </div>
            ) : null}

            {renderAfterIndication ? (
              <div className="for51-result-block">
                <div className="for51-section-title">
                  CALIBRAÇÃO APÓS O AJUSTE
                </div>
                <table className="for51-table for51-result-table for51-outer">
                  <thead>
                    <tr>
                      <th>V C</th>
                      <th>Unid</th>
                      <th>Leitura 1</th>
                      <th>Leitura 2</th>
                      <th>Leitura 3</th>
                      <th>Média</th>
                      <th>EI</th>
                      <th>U</th>
                      <th>K</th>
                      <th>Veff</th>
                    </tr>
                  </thead>
                  <tbody>{renderFor51ResultRows(job, "apos", decimals)}</tbody>
                </table>
              </div>
            ) : null}

            <div className="for51-result-block">
              <div className="for51-section-title">REPETIBILIDADE</div>
              <table className="for51-table for51-repeat for51-outer">
                <colgroup>
                  <col style={{ width: "29mm" }} />
                  {Array.from({ length: 5 }).map((_, index) => (
                    <col key={index} style={{ width: "18mm" }} />
                  ))}
                  <col style={{ width: "31mm" }} />
                  <col style={{ width: "14mm" }} />
                </colgroup>
                <thead>
                  <tr>
                    <th />
                    <th>Leitura 1</th>
                    <th>Leitura 2</th>
                    <th>Leitura 3</th>
                    <th>Leitura 4</th>
                    <th>Leitura 5</th>
                    <th>Repetibilidade</th>
                    <th>Unid</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["Antes do ajuste", "before", repeatBefore],
                    ["Depois do ajuste", "after", repeatAfter],
                  ].map(([label, phase, values]) => {
                    const readings = values as number[];
                    const phaseActive = isFor51PhaseActive(
                      job,
                      "repeatability",
                      phase as "before" | "after",
                    );
                    return (
                      <tr key={label as string}>
                        <td className="row-label">{label as string}</td>
                        {Array.from({ length: 5 }).map((_, index) => (
                          <td key={index}>
                            {for51PhaseText(
                              phaseActive,
                              readings[index],
                              decimals,
                            )}
                          </td>
                        ))}
                        <td>
                          {phaseActive
                            ? formatFor51Number(
                                sampleStandardDeviation(readings) / 1000,
                                decimals,
                              )
                            : "x"}
                        </td>
                        <td>kg</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="for51-result-block">
              <div className="for51-section-title">EXCENTRICIDADE</div>
              <div className="for51-ecc-wrap">
                <table className="for51-table for51-ecc">
                  <thead>
                    <tr>
                      <th>Posição</th>
                      <th>Antes do ajuste</th>
                      <th>Depois do ajuste</th>
                      <th>Unid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {eccentricityRows.map((row, index) => (
                      <tr key={index}>
                        <td>{asString(row.posicao)}</td>
                        <td>
                          {for51PhaseText(
                            isFor51PhaseActive(job, "eccentricity", "before"),
                            row.antes,
                            decimals,
                          )}
                        </td>
                        <td>
                          {for51PhaseText(
                            isFor51PhaseActive(job, "eccentricity", "after"),
                            row.apos,
                            decimals,
                          )}
                        </td>
                        <td>kg</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="for51-diagram-cell">
                  <div className="for51-diagram" aria-hidden="true">
                    <svg viewBox="0 0 180 175" role="img">
                      <g
                        fill="none"
                        stroke="#000"
                        strokeLinecap="butt"
                        strokeWidth="2"
                      >
                        <line
                          strokeDasharray="5 4"
                          x1="38"
                          x2="80"
                          y1="75"
                          y2="75"
                        />
                        <line
                          strokeDasharray="5 4"
                          transform="rotate(90 90 75)"
                          x1="38"
                          x2="80"
                          y1="75"
                          y2="75"
                        />
                        <line
                          strokeDasharray="5 4"
                          transform="rotate(90 90 75)"
                          x1="142"
                          x2="100"
                          y1="75"
                          y2="75"
                        />
                        <line
                          strokeDasharray="5 4"
                          x1="142"
                          x2="100"
                          y1="75"
                          y2="75"
                        />
                        <circle cx="90" cy="75" r="36" />
                      </g>
                      {[
                        ["82", "1", "X"],
                        ["150", "67", ""],
                        ["82", "133", ""],
                        ["14", "67", ""],
                      ].map(([x, y, label], index) => (
                        <g key={index}>
                          <rect
                            fill="#fff"
                            height="16"
                            stroke="#777"
                            strokeWidth="2"
                            width="16"
                            x={x}
                            y={y}
                          />
                          {label ? (
                            <text
                              dominantBaseline="middle"
                              fill="#000"
                              fontSize="15"
                              fontWeight="700"
                              textAnchor="middle"
                              x={Number(x) + 8}
                              y={Number(y) + 8}
                            >
                              {label}
                            </text>
                          ) : null}
                        </g>
                      ))}
                      {[
                        ["A", 90, 75],
                        ["B", 70, 60],
                        ["C", 110, 60],
                        ["D", 110, 94],
                        ["E", 70, 94],
                      ].map(([label, x, y]) => (
                        <text
                          dominantBaseline="middle"
                          fill="#000"
                          fontSize="15"
                          fontWeight="700"
                          key={label}
                          textAnchor="middle"
                          x={x}
                          y={y}
                        >
                          {label}
                        </text>
                      ))}
                      <text
                        fill="#000"
                        fontSize="14"
                        textAnchor="middle"
                        x="90"
                        y="170"
                      >
                        Posição do indicador
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <div className="for51-observations">
              <div className="for51-section-title">OBSERVAÇÕES:</div>
              <div style={{ padding: "2mm" }}>{observation}</div>
            </div>

            <div className="for51-signature">
              {job.approverSignatureUrl && (
                <img src={job.approverSignatureUrl} alt="Assinatura" />
              )}
              <div className="for51-signature-line">
                {job.lab.technicalManagerName || job.approverName || ""}
              </div>
              <div>Signatário Autorizado</div>
            </div>
          </div>
          <div className="for51-footer-page">Página 2/2</div>
        </section>
      </body>
    </html>
  );
}

export function CertificateHtml({ job }: { job: JobData }) {
  if (shouldRenderExemploFor51(job)) {
    return <ExemploFor51CertificateHtml job={job} />;
  }

  const dataFields = job.methodSnapshot?.dataFields || [];
  const formulas = job.methodSnapshot?.formulas || [];
  const methodCertificateContent =
    job.methodSnapshot?.certificateContent ?? null;
  const effectiveMethodCertificateSections =
    getEffectiveMethodCertificateSections(
      methodCertificateContent,
      job.methodSnapshot,
    );
  const shouldRenderMethodCertificateSections =
    effectiveMethodCertificateSections.length > 0;

  const assetSpecFields = dataFields.filter((f) => f.source === "asset_spec");
  const tableFields = dataFields.filter(
    (f) => f.type === "table" && f.source !== "asset_spec",
  );
  const eccentricityIndicatorFields = tableFields.filter(
    (field) => field.eccentricityIndicator?.enabled,
  );
  const shouldRenderEccentricityDiagram =
    eccentricityIndicatorFields.length > 0;
  const assetBaseMeasurementUnit =
    job.assetSnapshot?.baseMeasurementUnit ?? null;

  // Get environment data from structured snapshot
  const envTemperature = job.environmentalSnapshot?.temperature ?? null;
  const envHumidity = job.environmentalSnapshot?.humidity ?? null;
  const envPressure = job.environmentalSnapshot?.pressure ?? null;

  // Build results with labels from formulas
  const resultEntries: Array<{
    key: string;
    label: string;
    value: unknown;
    unit?: string;
    formula?: MethodFormula;
  }> = [];
  if (job.results) {
    const seenResultKeys = new Set<string>();
    for (const formula of formulas) {
      if (formula.outputKey.startsWith("__")) continue;
      if (!(formula.outputKey in job.results)) continue;
      seenResultKeys.add(formula.outputKey);
      resultEntries.push({
        key: formula.outputKey,
        label: formula.label || formula.outputKey,
        value: job.results[formula.outputKey],
        unit: formula.unit,
        formula,
      });
    }
    for (const [key, value] of Object.entries(job.results)) {
      if (key.startsWith("__")) continue;
      if (seenResultKeys.has(key)) continue;
      const formula = formulas.find((f) => f.outputKey === key);
      resultEntries.push({
        key,
        label: formula?.label || key,
        value,
        unit: formula?.unit,
        formula,
      });
    }
  }
  const calibrationResultRoleOrder = new Map<string, number>([
    ["primary_result", 0],
    ["expanded_uncertainty", 1],
    ["coverage_factor", 2],
    ["conformity_margin", 3],
    ["auxiliary", 4],
  ]);
  const calibrationResultEntries = resultEntries
    .filter(
      (entry) =>
        entry.formula?.reporting?.group === "calibration_result" &&
        entry.formula.reporting.includeInCertificate !== false,
    )
    .sort((a, b) => {
      const aOrder = calibrationResultRoleOrder.get(
        a.formula?.reporting?.role ?? "",
      );
      const bOrder = calibrationResultRoleOrder.get(
        b.formula?.reporting?.role ?? "",
      );
      return (aOrder ?? 99) - (bOrder ?? 99);
    });
  const uncertaintyBudgetEntries = resultEntries.filter(
    (entry) =>
      entry.formula?.reporting?.group === "uncertainty_budget" &&
      entry.formula.reporting.includeInCertificate !== false,
  );
  const hasStructuredResults =
    calibrationResultEntries.length > 0 || uncertaintyBudgetEntries.length > 0;
  const genericResultEntries = resultEntries.filter((entry) => {
    if (entry.formula?.reporting?.includeInCertificate === false) {
      return false;
    }
    if (entry.formula?.reporting?.group === "raw_calculation") {
      return true;
    }
    return !hasStructuredResults && !entry.formula?.reporting?.group;
  });
  const pointLabels = getPointLabels(dataFields, job.data);
  const calibrationResultRowCount = Math.max(
    pointLabels.length,
    ...calibrationResultEntries.map((entry) => getArrayLength(entry.value)),
  );
  const calibrationResultChunks = chunkArray(
    calibrationResultEntries,
    MAX_CALIBRATION_RESULT_COLUMNS,
  );
  const conformityEntry = calibrationResultEntries.find(
    (entry) => entry.formula?.reporting?.role === "conformity_margin",
  );
  const assetSpecEntries = assetSpecFields
    .map((field) => ({
      field,
      value: field.assetSpecKey
        ? job.assetSnapshot?.specifications?.[field.assetSpecKey]
        : undefined,
    }))
    .filter(
      ({ value }) => value !== null && value !== undefined && value !== "",
    );
  const massCompositionRows = collectMassCompositions(dataFields, job.data);
  const certifiedValuesDisplay =
    methodCertificateContent?.certifiedValuesDisplay ??
    (massCompositionRows.length > 0 ? "hidden" : "full");
  const showCertifiedValuesTable = certifiedValuesDisplay === "full";
  const massCompositionDisplay =
    methodCertificateContent?.massCompositionDisplay ??
    (certifiedValuesDisplay === "hidden" ? "hidden" : "full");
  const showMassCompositionTraceability =
    massCompositionRows.length > 0 && massCompositionDisplay === "full";
  const uncertaintyBudgetDisplay =
    methodCertificateContent?.uncertaintyBudgetDisplay ??
    (certifiedValuesDisplay === "hidden" &&
    isBalanceLikeMethod(job.methodSnapshot)
      ? "hidden"
      : "full");
  const showUncertaintyBudget =
    uncertaintyBudgetEntries.length > 0 && uncertaintyBudgetDisplay === "full";

  const dynamicStyles = `
      :root {
        --template-primary: #111827;
        --template-accent: #f3f4f6;
      }
      .logo-image {
        max-width: 72px;
        max-height: 72px;
        object-fit: contain;
      }
      .intro {
        margin-bottom: 16px;
        padding: 12px;
        background: color-mix(in srgb, var(--template-accent) 75%, white);
        border-left: 4px solid var(--template-primary);
        font-size: 9pt;
      }
    `;

  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="UTF-8" />
        <title>
          {job.certificateName || `Certificado de Calibração - ${job.jobId}`}
        </title>
        <style
          dangerouslySetInnerHTML={{
            __html: `${dynamicStyles}\n${styles}`,
          }}
        />
      </head>
      <body>
        <div className="certificate density-comfortable header-style-classic emphasis-neutral">
          {/* Header */}
          <div className="header">
            <div className="logo-section">
              {job.lab.logo ? (
                <img
                  src={job.lab.logo}
                  alt={job.lab.name}
                  className="logo-image"
                />
              ) : (
                <div className="logo-placeholder">LAB</div>
              )}
              <div className="lab-info">
                <h1>{job.lab.name}</h1>
                {job.lab.cnpj && <p>CNPJ: {formatTaxId(job.lab.cnpj)}</p>}
                {job.lab.accreditationNumber && (
                  <p>
                    {job.lab.accreditationNumber}
                    {job.lab.accreditationBody &&
                      ` - ${job.lab.accreditationBody}`}
                  </p>
                )}
                {formatLabAddress(job.lab) && (
                  <p>{formatLabAddress(job.lab)}</p>
                )}
                {(job.lab.phone || job.lab.email) && (
                  <p>
                    {job.lab.phone}
                    {job.lab.phone && job.lab.email && " | "}
                    {job.lab.email}
                  </p>
                )}
              </div>
            </div>
            <div className="cert-number">
              <h2>CERTIFICADO DE CALIBRAÇÃO</h2>
              <div className="number">{job.jobId}</div>
            </div>
          </div>

          {/* Amendment Notice - ISO 17025 Clause 7.8.4.1 */}
          {job.supersedesId && (
            <div className="amendment-notice">
              <h3>CERTIFICADO RETIFICADO</h3>
              <p>
                Este certificado <strong>substitui e cancela</strong> o
                certificado nº{" "}
                <strong>{job.originalJobId || `#${job.supersedesId}`}</strong>
              </p>
              <p>
                <strong>Retificação nº {job.amendmentNumber || 1}</strong>
              </p>
              {job.amendmentReason && (
                <p>
                  <strong>Motivo da retificação:</strong> {job.amendmentReason}
                </p>
              )}
              {job.originalApprovedAt && (
                <p>
                  Certificado original emitido em:{" "}
                  {formatDate(job.originalApprovedAt)}
                </p>
              )}
            </div>
          )}

          {/* Superseded Watermark - appears on all pages */}
          {job.supersededById && (
            <div className="superseded-watermark">
              <span className="superseded-watermark-text">CANCELADO</span>
            </div>
          )}

          {/* Customer Section */}
          <div className="section">
            <div className="section-title">Cliente</div>
            <div className="info-grid">
              <div className="info-row">
                <span className="info-label">Nome:</span>
                <span className="info-value">{job.customer.name}</span>
              </div>
              <div className="info-row">
                <span className="info-label">CNPJ/CPF:</span>
                <span className="info-value">
                  {formatTaxId(job.customer.taxId)}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Endereço:</span>
                <span className="info-value">
                  {formatAddress(job.customer.address)}
                </span>
              </div>
              {job.customer.phone && (
                <div className="info-row">
                  <span className="info-label">Telefone:</span>
                  <span className="info-value">{job.customer.phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Asset Section */}
          <div className="section">
            <div className="section-title">Instrumento Calibrado</div>
            <div className="info-grid">
              <div className="info-row">
                <span className="info-label">Descrição:</span>
                <span className="info-value">{job.asset.name}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Fabricante:</span>
                <span className="info-value">
                  {job.asset.manufacturer || "-"}
                </span>
              </div>
              <div className="info-row">
                <span className="info-label">Modelo:</span>
                <span className="info-value">{job.asset.model || "-"}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Nº Série:</span>
                <span className="info-value">{job.asset.serialNumber}</span>
              </div>
              <div className="info-row">
                <span className="info-label">Tag:</span>
                <span className="info-value">{job.asset.tag}</span>
              </div>
            </div>
          </div>

          {assetSpecEntries.length > 0 && (
            <div className="section">
              <div className="section-title">
                Características do Instrumento Consideradas
              </div>
              <div className="info-grid">
                {assetSpecEntries.map(({ field, value }) => (
                  <div className="info-row" key={field.key}>
                    <span className="info-label">{field.label}:</span>
                    <span className="info-value">
                      {formatCanonicalValueWithResolvedUnit(
                        value,
                        field.unit,
                        assetBaseMeasurementUnit,
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Method */}
          <div className="section">
            <div className="section-title">Método de Calibração</div>
            <div className="info-grid">
              <div className="info-row">
                <span className="info-label">
                  {methodCertificateContent?.procedureCode
                    ? "Procedimento:"
                    : "Método:"}
                </span>
                <span className="info-value">
                  {methodCertificateContent?.procedureCode ||
                    `${job.methodSnapshot.methodName} (v${job.methodSnapshot.methodVersion})`}
                </span>
              </div>
              {methodCertificateContent?.procedureCode && (
                <div className="info-row">
                  <span className="info-label">Método:</span>
                  <span className="info-value">
                    {job.methodSnapshot.methodName} (v
                    {job.methodSnapshot.methodVersion})
                  </span>
                </div>
              )}
              {(methodCertificateContent?.referenceStandards ?? []).some(
                (item) => item.trim(),
              ) && (
                <div className="info-row">
                  <span className="info-label">Norma de Ref.:</span>
                  <span className="info-value">
                    {methodCertificateContent?.referenceStandards
                      ?.filter((item) => item.trim())
                      .join(" e ")}
                  </span>
                </div>
              )}
              <div className="info-row">
                <span className="info-label">Data:</span>
                <span className="info-value">
                  {formatDate(job.performedAt)}
                </span>
              </div>
            </div>
          </div>

          {shouldRenderMethodCertificateSections && (
            <div className="section method-content">
              {effectiveMethodCertificateSections.map((section, index) =>
                renderMethodCertificateSection(section, index),
              )}
            </div>
          )}

          {/* Environment */}
          {(envTemperature != null ||
            envHumidity != null ||
            envPressure != null) && (
            <div className="section">
              <div className="section-title">Condições Ambientais</div>
              <div className="info-grid">
                {envTemperature != null && (
                  <div className="info-row">
                    <span className="info-label">Temperatura:</span>
                    <span className="info-value">
                      {formatNumber(envTemperature, 1)} °C
                    </span>
                  </div>
                )}
                {envHumidity != null && (
                  <div className="info-row">
                    <span className="info-label">Umidade:</span>
                    <span className="info-value">
                      {formatNumber(envHumidity, 1)} %RH
                    </span>
                  </div>
                )}
                {envPressure != null && (
                  <div className="info-row">
                    <span className="info-label">Pressão:</span>
                    <span className="info-value">
                      {formatPlainNumber(envPressure, 1)} hPa
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Standards Used */}
          {job.standardsSnapshot && job.standardsSnapshot.length > 0 && (
            <div className="section">
              <div className="section-title">Padrões Utilizados</div>
              <table>
                <thead>
                  <tr>
                    <th>Padrão</th>
                    <th>Certificado</th>
                    <th>Incerteza</th>
                    <th>Validade</th>
                  </tr>
                </thead>
                <tbody>
                  {job.standardsSnapshot.map((std, i) => (
                    <tr key={i}>
                      <td>{std.name}</td>
                      <td>{std.certificateNumber}</td>
                      <td>
                        {formatStandardUncertainty(
                          std,
                          showCertifiedValuesTable,
                          assetBaseMeasurementUnit,
                        )}
                      </td>
                      <td>
                        {formatDate(
                          std.nextCalibrationDate ?? std.calibrationDate,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Certified Values for Weight Sets */}
              {showCertifiedValuesTable &&
                job.standardsSnapshot.some(hasCertifiedValues) && (
                  <div className="data-table">
                    <div className="data-table-title">
                      Valores Certificados dos Padrões
                    </div>
                    <table>
                      <thead>
                        <tr>
                          <th>Padrão</th>
                          <th>Valor Nominal</th>
                          <th>Valor Certificado</th>
                          <th>Incerteza</th>
                        </tr>
                      </thead>
                      <tbody>
                        {job.standardsSnapshot.flatMap(
                          (std) =>
                            std.certifiedValues?.map((cv, i) => (
                              <tr key={`${std.id}-${i}`}>
                                <td>{i === 0 ? std.name : ""}</td>
                                <td>{cv.nominal}</td>
                                <td>
                                  {formatOriginalUnitValueWithResolvedUnit(
                                    cv.value,
                                    cv.unit,
                                    assetBaseMeasurementUnit,
                                  )}
                                </td>
                                <td>
                                  ±
                                  {formatCalibrationValue(
                                    convertOriginalUnitValueForDisplay(
                                      cv.uncertainty,
                                      cv.unit,
                                      assetBaseMeasurementUnit,
                                    ),
                                  )}{" "}
                                  {resolveDocumentDisplayUnit(
                                    assetBaseMeasurementUnit,
                                    cv.unit,
                                  )}
                                </td>
                              </tr>
                            )) || [],
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
            </div>
          )}

          {/* Calibration Data Tables */}
          {tableFields.length > 0 && job.data && (
            <div className="section calibration-data-section">
              <div className="section-title">Dados de Calibração</div>
              {tableFields.map((field) => {
                const tableData = job.data?.[field.key];
                if (!Array.isArray(tableData)) return null;
                if (
                  shouldRenderEccentricityDiagram &&
                  isEccentricityCalibrationField(field)
                ) {
                  const eccentricityVariant =
                    getEccentricityIndicatorVariant(field);
                  if (!eccentricityVariant) {
                    return (
                      <DataTable
                        key={field.key}
                        field={field}
                        data={tableData}
                        assetBaseMeasurementUnit={assetBaseMeasurementUnit}
                      />
                    );
                  }

                  return (
                    <div key={field.key} className="eccentricity-layout">
                      <DataTable
                        field={field}
                        data={tableData}
                        assetBaseMeasurementUnit={assetBaseMeasurementUnit}
                      />
                      <CertificateEccentricityDiagram
                        selectedPosition={getEccentricityIndicatorPosition(
                          job,
                          eccentricityVariant,
                        )}
                        variant={eccentricityVariant}
                        loadPositions={
                          eccentricityVariant === "circular_platform"
                            ? getCircularEccentricityLoadPositions(
                                field,
                                tableData,
                              )
                            : undefined
                        }
                      />
                    </div>
                  );
                }

                return (
                  <DataTable
                    key={field.key}
                    field={field}
                    data={tableData}
                    assetBaseMeasurementUnit={assetBaseMeasurementUnit}
                  />
                );
              })}
            </div>
          )}

          {showMassCompositionTraceability && (
            <div className="section">
              <div className="section-title">
                Composição dos Padrões por Ponto
              </div>
              <table>
                <thead>
                  <tr>
                    <th>Ponto</th>
                    <th>Composição</th>
                    <th>Padrão</th>
                    <th>Certificado</th>
                    <th>Valor certificado</th>
                    <th>Incerteza</th>
                  </tr>
                </thead>
                <tbody>
                  {massCompositionRows.map((row, index) => (
                    <tr
                      key={`${row.item.standardId}-${row.item.certifiedValueIndex}-${index}`}
                    >
                      <td>{row.point}</td>
                      <td>{row.composition}</td>
                      <td>
                        {row.item.quantity} x{" "}
                        {row.item.compositionProfile
                          ? (row.item.profileKey ?? row.item.nominal)
                          : `${row.item.nominal} ${row.item.standardName}`}
                      </td>
                      <td>{row.item.certificateNumber}</td>
                      <td>
                        {formatOriginalUnitValueWithResolvedUnit(
                          row.item.value,
                          row.item.unit,
                          assetBaseMeasurementUnit,
                        )}
                      </td>
                      <td>
                        ±
                        {formatCalibrationValue(
                          convertOriginalUnitValueForDisplay(
                            row.item.uncertainty,
                            row.item.unit,
                            assetBaseMeasurementUnit,
                          ),
                        )}{" "}
                        {resolveDocumentDisplayUnit(
                          assetBaseMeasurementUnit,
                          row.item.unit,
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* RBC-like Calibration Result */}
          {calibrationResultEntries.length > 0 &&
            calibrationResultRowCount > 0 && (
              <div className="section">
                <div className="section-title">Resultado da Calibração</div>
                {calibrationResultChunks.map((entries, chunkIndex) => {
                  const isLastChunk =
                    chunkIndex === calibrationResultChunks.length - 1;
                  const includeCriterion = !!conformityEntry && isLastChunk;

                  return (
                    <div className="table-chunk" key={chunkIndex}>
                      {calibrationResultChunks.length > 1 && (
                        <div className="data-table-subtitle">
                          {chunkIndex === 0
                            ? "Resultados principais"
                            : `Continuação ${chunkIndex + 1}`}
                        </div>
                      )}
                      <table
                        className={
                          calibrationResultEntries.length >
                          MAX_CALIBRATION_RESULT_COLUMNS
                            ? "wide-table result-table"
                            : "result-table"
                        }
                      >
                        <thead>
                          <tr>
                            <th>Ponto</th>
                            {entries.map(({ key, label, unit }) => (
                              <th key={key}>
                                {label}
                                {resolveDocumentDisplayUnit(
                                  assetBaseMeasurementUnit,
                                  unit,
                                )
                                  ? ` (${resolveDocumentDisplayUnit(
                                      assetBaseMeasurementUnit,
                                      unit,
                                    )})`
                                  : ""}
                              </th>
                            ))}
                            {includeCriterion && <th>Critério</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {Array.from({
                            length: calibrationResultRowCount,
                          }).map((_, index) => {
                            const conformityValue = conformityEntry
                              ? getIndexedValue(conformityEntry.value, index)
                              : undefined;
                            const conformityNumber =
                              typeof conformityValue === "number"
                                ? conformityValue
                                : typeof conformityValue === "string"
                                  ? Number(conformityValue)
                                  : NaN;

                            return (
                              <tr key={index}>
                                <td>
                                  {pointLabels[index] ?? String(index + 1)}
                                </td>
                                {entries.map((entry) => (
                                  <td key={entry.key}>
                                    {formatReportedValue(
                                      entry,
                                      getIndexedValue(entry.value, index),
                                      assetBaseMeasurementUnit,
                                    )}
                                  </td>
                                ))}
                                {includeCriterion && (
                                  <td>
                                    {Number.isFinite(conformityNumber)
                                      ? conformityNumber >= 0
                                        ? "Conforme"
                                        : "Não conforme"
                                      : "-"}
                                  </td>
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </div>
            )}

          {showUncertaintyBudget && (
            <div className="section">
              <div className="section-title">Orçamento de Incerteza</div>
              <table>
                <thead>
                  <tr>
                    <th>Componente</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {uncertaintyBudgetEntries.map(
                    ({ key, label, value, unit }) => (
                      <tr key={key}>
                        <td>{label}</td>
                        <td>
                          {formatValue(value)}
                          {unit ? ` ${unit}` : ""}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Results */}
          {genericResultEntries.length > 0 && (
            <div className="section">
              <div className="section-title">Resultados</div>
              <table>
                <thead>
                  <tr>
                    <th>Parâmetro</th>
                    <th>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {genericResultEntries.map(({ key, label, value, unit }) => (
                    <tr key={key}>
                      <td>{label}</td>
                      <td>
                        {formatValue(value)}
                        {unit ? ` ${unit}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="closing-block">
            {/* Signature - ISO 17025 Clause 7.8.2.1(q) */}
            <div className="signature-section">
              <div className="signature-box">
                {/* Visual signature image */}
                {job.approverSignatureUrl && (
                  <img
                    src={job.approverSignatureUrl}
                    alt="Assinatura"
                    style={{
                      maxHeight: "60px",
                      maxWidth: "180px",
                      marginBottom: "4px",
                      display: "block",
                      marginLeft: "auto",
                      marginRight: "auto",
                    }}
                  />
                )}
                <div className="signature-line">
                  {job.lab.technicalManagerName || job.approverName || "-"}
                </div>
                <div>
                  {job.lab.technicalManagerTitle || "Responsável Técnico"}
                </div>
                <div
                  style={{
                    fontSize: "8pt",
                    color: "#666",
                  }}
                >
                  {formatDate(job.approvedAt)}
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="footer">
              <div>Emitido em: {formatDate(new Date())}</div>
            </div>

            {/* End of Document Marker (ISO requirement) */}
            <div className="end-marker">--- FIM DO CERTIFICADO ---</div>
          </div>
        </div>
      </body>
    </html>
  );
}
