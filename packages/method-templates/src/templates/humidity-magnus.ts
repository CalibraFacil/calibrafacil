import type {
  MethodDraft,
  MethodPreviewScenario,
} from "@calibra-facil/method-definition";
import {
  MethodCertificateContentSchema,
  MethodFormulaSchema,
  MethodInputFieldSchema,
  MethodMeasurementModelSchema,
} from "@calibra-facil/schemas";

import { buildDraftFromProduct } from "../product-to-draft";
import type {
  BuildDraftArgs,
  TemplateModule,
  TemplateProductDefinition,
} from "../types";

/**
 * Relative-humidity indication-error calibration of a thermohygrometer against
 * a dew-point reference, using the Magnus saturation-vapour-pressure formula.
 *
 * ⚠️ DRAFT — pending metrologist review. The Magnus formula + coefficients were
 * read from the cited source; uncertainty is propagated through the exp() terms
 * by the GUM engine (no hand-derived sensitivity coefficients). Sources:
 *   - WMO No. 8, Guide to Meteorological Instruments and Methods of Observation
 *     (CIMO Guide, 2008), Annex 4.B — Magnus formula over water:
 *     e_w = 6.112·exp(17.62·t/(243.12 + t)), t in °C, e_w in hPa
 *     (verbatim per the UCAR/EOL compilation:
 *     https://www.eol.ucar.edu/data-software/conventions-and-standards/water-vapor-pressure-formulations).
 *   - EA-4/02 M:2022 (GUM propagation):
 *     https://european-accreditation.org/publications/ea-4-02/
 *
 * Model: RH_ref = 100·e_w(t_d)/e_w(t) (actual vapour pressure at the reference
 * dew point t_d over saturation at air temperature t); E = RH_ind − RH_ref.
 *
 * [VERIFICAR] every metrology decision:
 *   - Magnus coefficients (6.112 hPa, 17.62, 243.12 °C) are the WMO over-water
 *     set; the WMO note states ~±0.6 % (k=2) on e_w — confirm this is folded in.
 *   - Over-water vs over-ice (below 0 °C uses different coefficients) — this
 *     template is over-water only.
 *   - Input standard uncertainties below are representative placeholders (set
 *     from the dew-point mirror / thermometer / DUT resolution certificates).
 *   - k = 2 assumed; t_d ≈ t_water assumption; no temperature-gradient term.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived via the shared buildDraftFromProduct.
 */

const METHOD_NAME = "Calibração de Termohigrômetro (UR) por Erro de Indicação";
const HYGROMETER_ASSET_TYPE_SLUG = "termohigrometro";
const methodDescription =
  "Calibração de termohigrômetros em umidade relativa por comparação contra uma referência de ponto de orvalho. A UR de referência é calculada por UR = 100·e_w(t_d)/e_w(t) com a fórmula de Magnus (WMO CIMO Annex 4.B, sobre água); o erro de indicação é E = UR indicada − UR de referência. A incerteza é propagada pelo motor GUM através dos termos exp() (EA-4/02). Rascunho pendente de revisão metrológica.";

const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_umidade" } as const;

// Magnus saturation vapour pressure e_w(T) over water (WMO CIMO Annex 4.B).
const e_w = (tempSymbol: string) =>
  `6.112 * exp(17.62 * ${tempSymbol} / (243.12 + ${tempSymbol}))`;

const humidityColumns = [
  {
    key: "temperatura",
    label: "Temperatura do ar (t)",
    type: "number",
    unit: "°C",
    quantityKind: "environment",
  },
  {
    key: "ponto_orvalho",
    label: "Ponto de orvalho de referência (t_d)",
    type: "number",
    unit: "°C",
    quantityKind: "reference",
  },
  {
    key: "leitura_ur",
    label: "Umidade relativa indicada",
    type: "number",
    unit: "%RH",
    quantityKind: "indication",
  },
];

const dataFields = [
  {
    key: "pontos_umidade",
    label: "Pontos de calibração de umidade",
    type: "table",
    required: true,
    columns: humidityColumns,
  },
];

// Display formulas (grounded in WMO Magnus). Reported alongside the result.
const formulas = [
  {
    outputKey: "es_t",
    label: "Pressão de saturação à temperatura do ar (e_w(t))",
    expression: e_w("temperatura"),
    scope: ROW_SCOPE,
    unit: "hPa",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "es_td",
    label: "Pressão de vapor no ponto de orvalho (e_w(t_d))",
    expression: e_w("ponto_orvalho"),
    scope: ROW_SCOPE,
    unit: "hPa",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "ur_referencia",
    label: "UR de referência",
    // RH = 100 · e_w(t_d) / e_w(t) (WMO CIMO). The 6.112 multiplier cancels.
    expression: "100 * es_td / es_t",
    scope: ROW_SCOPE,
    unit: "%RH",
    reporting: { includeInCertificate: true, role: "auxiliary", group: "calibration_result" },
  },
];

// GUM model for the indication error, propagating through the exp() terms.
const measurementModels = [
  {
    key: "erro_ur",
    label: "Erro de indicação de UR (E)",
    scope: ROW_SCOPE,
    measurand: "E",
    // E = RH_ind − 100·e_w(t_d)/e_w(t); Magnus inlined in the base quantities so
    // the engine differentiates through exp() (correct sensitivity coefficients).
    expression: `leitura_ur - 100 * (${e_w("ponto_orvalho")}) / (${e_w("temperatura")})`,
    outputUnit: "%RH",
    coverageFactor: 2,
    correlations: [],
    covariances: [],
    options: { allowNonSmoothWithExplicitSensitivities: false },
    quantities: [
      {
        symbol: "leitura_ur",
        source: { kind: "table_column", tableKey: "pontos_umidade", columnKey: "leitura_ur" },
        unit: "%RH",
        // [VERIFICAR] resolution + short-term instability of the DUT reading.
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.2 },
      },
      {
        symbol: "temperatura",
        source: { kind: "table_column", tableKey: "pontos_umidade", columnKey: "temperatura" },
        unit: "°C",
        // [VERIFICAR] reference thermometer standard uncertainty.
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.1 },
      },
      {
        symbol: "ponto_orvalho",
        source: { kind: "table_column", tableKey: "pontos_umidade", columnKey: "ponto_orvalho" },
        unit: "°C",
        // [VERIFICAR] dew-point mirror reference standard uncertainty.
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.2 },
      },
    ],
  },
];

const certificateContent = {
  procedureCode: "[VERIFICAR]",
  referenceStandards: ["WMO No. 8 (CIMO Guide) Annex 4.B", "EA-4/02"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A UR de referência é calculada a partir do ponto de orvalho e da temperatura do ar pela fórmula de Magnus (WMO CIMO Annex 4.B): UR = 100·e_w(t_d)/e_w(t), com e_w(T) = 6,112·exp(17,62·T/(243,12+T)) hPa. O erro de indicação é E = UR indicada − UR de referência.",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "e_w", definition: "Pressão de saturação de vapor sobre água (Magnus, WMO)." },
        { term: "t_d", definition: "Ponto de orvalho de referência." },
        { term: "E", definition: "Erro de indicação de UR (indicada − referência)." },
        { term: "U", definition: "Incerteza expandida (k = 2)." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada é propagada conforme a EA-4/02 a partir das incertezas de entrada (UR indicada, temperatura, ponto de orvalho) através dos termos exp() da fórmula de Magnus. A incerteza expandida é U = k·u_c com k = 2.",
        "[VERIFICAR] Fórmula sobre água apenas (abaixo de 0 °C usa coeficientes sobre gelo); a incerteza da própria fórmula de Magnus (~±0,6 %, k=2 segundo a WMO) deve ser incluída.",
      ],
    },
    {
      kind: "bullets",
      items: [
        "Os resultados referem-se exclusivamente ao instrumento calibrado, no momento da calibração.",
        "Este certificado não tem valor para fins de metrologia legal.",
      ],
    },
  ],
};

export const humidityProductDefinition: TemplateProductDefinition = {
  assetTypeSlug: HYGROMETER_ASSET_TYPE_SLUG,
  name: METHOD_NAME,
  description: methodDescription,
  dataFields: MethodInputFieldSchema.array().parse(dataFields),
  variableBindings: [],
  formulas: MethodFormulaSchema.array().parse(formulas),
  measurementModels: MethodMeasurementModelSchema.array().parse(measurementModels),
  validations: [],
  uncertaintyParams: [],
  certificateContent: MethodCertificateContentSchema.parse(certificateContent),
  accreditedScope: false,
};

function buildDraft(args: BuildDraftArgs = {}): MethodDraft {
  return buildDraftFromProduct(
    {
      name: METHOD_NAME,
      description: methodDescription,
      assetTypeId: HYGROMETER_ASSET_TYPE_SLUG,
      dataFields,
      formulas,
      measurementModels,
      validations: [],
      metadata: {
        validationStatus: "pending_revalidation",
        source: "method-templates:humidity-magnus",
      },
    },
    args,
  );
}

// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. Second scenario = envelope check
// at high temperature confirming the exp() terms produce no EXPONENT_TOO_LARGE.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_23C_orvalho12C",
    label: "Ponto: ar 23 °C, orvalho 12 °C, indicado 50,5 %RH",
    inputs: {
      pontos_umidade: [
        { temperatura: 23, ponto_orvalho: 12, leitura_ur: 50.5 },
      ],
    },
    expected: {
      // Row-scoped → one value per row. RH_ref = 100·e_w(12)/e_w(23) = 49.954 %RH
      // (WMO Magnus); E = 50.5 − 49.954 = 0.546 %RH; u_c and U = 2·u_c propagated
      // by the engine through exp() (symbolic sensitivities). Pinned within 1e-9.
      formulas: {
        ur_referencia: [49.95436074109317],
      },
      measurementModels: {
        erro_ur: {
          estimate: [0.5456392589068291],
          standardUncertainty: [0.7507997859366027],
          expandedUncertainty: [1.5015995718732054],
        },
      },
    },
  },
  {
    key: "envelope_90C",
    label: "Envelope: ar 90 °C, orvalho 85 °C (confirma ausência de EXPONENT_TOO_LARGE)",
    inputs: {
      pontos_umidade: [
        { temperatura: 90, ponto_orvalho: 85, leitura_ur: 75 },
      ],
    },
    // No expected assertion — confirms the exp() terms evaluate without error.
  },
];

export const humidityMagnusTemplate: TemplateModule = {
  key: "humidity-magnus",
  templateVersion: 1,
  discipline: "humidity",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["WMO No. 8 (CIMO Guide) Annex 4.B", "EA-4/02"],
  buildDraft,
  productDefinition: humidityProductDefinition,
  previewScenarios,
};
