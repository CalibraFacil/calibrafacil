import type {
  MethodDraft,
  MethodPreviewScenario,
} from "@calibra-facil/method-definition";
import {
  MethodCertificateContentSchema,
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
 * Gravimetric volume calibration of laboratory glassware (volumetric flask /
 * pipette) at the reference temperature t0 = 20 °C.
 *
 * ⚠️ DRAFT — pending metrologist review. The measurement equation was read from
 * and matches the cited guide; uncertainty is propagated by the GUM engine (NOT
 * hand-derived sensitivity coefficients). Sources:
 *   - EURAMET cg-19 v4.1 "Guidelines on the Determination of Uncertainty in
 *     Gravimetric Volume Calibration":
 *     https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-019_Calibration_Guide_No._19_web.pdf
 *   - ISO 4787 (the source of Eq. 1, referenced by cg-19 §3).
 *
 * Conformance to cg-19 (read from the v4.1 text):
 *   - §3 Eq. (1): V0 = (I_L − I_E)·[1/(ρ_W − ρ_A)]·(1 − ρ_A/ρ_B)·[1 − γ(t − t0)].
 *   - §3 Eq. (2): water density ρ_W via the Tanaka formula with coefficients
 *     a1=−3.983035, a2=301.797, a3=522528.9, a4=69.34881, a5=0.999974950 g/mL
 *     (verbatim from p.6). Inlined into the V0 expression so the temperature
 *     uncertainty propagates through both ρ_W and the γ term (correctly
 *     correlated).
 *   - ρ_B = 8.0 g/mL (cg-19 default for reference weights); t0 = 20 °C.
 *   - §6.7 / §6.8: expanded uncertainty U = k·u_c, k = 2.
 *
 * [VERIFICAR] The input STANDARD UNCERTAINTIES below are representative
 * placeholders — the metrologist must set them from the actual balance / sensor
 * / air-density (cg-19 §6.3.4 / CIPM) certificates. cg-19 §6.3 also lists
 * contributions OMITTED here pending review: operator/reproducibility (§6.3.7),
 * evaporation (§6.3.8), and the density-of-reference-weights and γ uncertainties
 * (treated here only via their input-uncertainty terms). ρ_A is taken as an
 * input; cg-19 §6.3.4 derives it from ambient T/P/RH (CIPM) — [VERIFICAR].
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived via the shared buildDraftFromProduct.
 */

const METHOD_NAME = "Calibração Gravimétrica de Volume (vidraria)";
const VOLUME_ASSET_TYPE_SLUG = "pipeta"; // [VERIFICAR] also balão volumétrico / bureta
const methodDescription =
  "Calibração gravimétrica de vidraria volumétrica (balões, pipetas, buretas) a 20 °C: pesa-se o recipiente vazio e cheio de água; a massa de água é convertida em volume pela equação ISO 4787 / EURAMET cg-19 Eq. (1), com densidade da água pela fórmula de Tanaka (Eq. 2). A incerteza é propagada pelo motor GUM a partir das incertezas de entrada (EA-4/02 / cg-19 §6). Rascunho pendente de revisão metrológica.";

const ROW_SCOPE = { kind: "table_row", tableKey: "determinacoes" } as const;

const determinationColumns = [
  {
    key: "I_L",
    label: "Pesagem do recipiente cheio (I_L)",
    type: "number",
    unit: "g",
    quantityKind: "indication",
  },
  {
    key: "I_E",
    label: "Pesagem do recipiente vazio (I_E)",
    type: "number",
    unit: "g",
    quantityKind: "indication",
  },
  {
    key: "t_w",
    label: "Temperatura da água (t_w)",
    type: "number",
    unit: "°C",
    quantityKind: "environment",
  },
  {
    // [VERIFICAR] cg-19 §6.3.4: derive ρ_A from ambient T/P/RH (CIPM). Entered
    // directly here for v1.
    key: "rho_a",
    label: "Densidade do ar (ρ_A)",
    type: "number",
    unit: "g/mL",
    quantityKind: "environment",
  },
  {
    // [VERIFICAR] cubic expansion coefficient = 3 × linear (cg-19 §3 note).
    key: "gamma",
    label: "Coef. de expansão cúbica do material (γ)",
    type: "number",
    quantityKind: "other",
  },
];

const dataFields = [
  {
    key: "determinacoes",
    label: "Determinações gravimétricas",
    type: "table",
    required: true,
    columns: determinationColumns,
  },
];

// Water density ρ_W(t_w) — Tanaka, cg-19 Eq. (2) (coefficients verbatim p.6).
const RHO_W =
  "0.999974950 * (1 - ((t_w - 3.983035) ^ 2 * (t_w + 301.797)) / (522528.9 * (t_w + 69.34881)))";
// V0 — cg-19 Eq. (1); ρ_B = 8.0 g/mL, t0 = 20 °C inlined as literals.
const V0_EXPRESSION = `(I_L - I_E) / (${RHO_W} - rho_a) * (1 - rho_a / 8.0) * (1 - gamma * (t_w - 20))`;

const measurementModels = [
  {
    key: "volume_v0",
    label: "Volume a 20 °C (V₀)",
    scope: ROW_SCOPE,
    measurand: "V0",
    expression: V0_EXPRESSION,
    outputUnit: "mL",
    // k = 2 per cg-19 §6.7/§6.8.
    coverageFactor: 2,
    // No correlations modelled between the input quantities ([VERIFICAR] cg-19
    // §6.6 — e.g. water-density/temperature handled via the inlined ρ_W(t_w)).
    correlations: [],
    covariances: [],
    // V0 is smooth (no abs/min/max/floor) → numeric/symbolic sensitivities apply.
    options: { allowNonSmoothWithExplicitSensitivities: false },
    quantities: [
      {
        symbol: "I_L",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "I_L" },
        unit: "g",
        // [VERIFICAR] balance combined standard uncertainty (cg-19 §6.3.1).
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.0005 },
      },
      {
        symbol: "I_E",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "I_E" },
        unit: "g",
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.0005 },
      },
      {
        symbol: "t_w",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "t_w" },
        unit: "°C",
        // [VERIFICAR] thermometer standard uncertainty (cg-19 §6.3.2).
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.1 },
      },
      {
        symbol: "rho_a",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "rho_a" },
        unit: "g/mL",
        // [VERIFICAR] air-density uncertainty (cg-19 §6.3.4 / CIPM).
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.00001 },
      },
      {
        symbol: "gamma",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "gamma" },
        unit: "1/°C",
        // [VERIFICAR] cubic expansion coefficient uncertainty (cg-19 §6.3.6).
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.000001 },
      },
    ],
  },
];

const certificateContent = {
  procedureCode: "[VERIFICAR]",
  referenceStandards: ["EURAMET cg-19 v4.1", "ISO 4787", "EA-4/02"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "Método gravimétrico (EURAMET cg-19 §3 / ISO 4787): a massa de água contida/escoada é convertida em volume a 20 °C pela Eq. (1), com a densidade da água pela fórmula de Tanaka (Eq. 2).",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "V₀", definition: "Volume à temperatura de referência de 20 °C." },
        { term: "ρ_W", definition: "Densidade da água (Tanaka, cg-19 Eq. 2)." },
        { term: "U", definition: "Incerteza expandida (k = 2)." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada é propagada conforme a EA-4/02 a partir das incertezas das grandezas de entrada (massa, temperatura, densidade do ar, coeficiente de expansão). A incerteza expandida é U = k·u_c com k = 2 (cg-19 §6.7/§6.8).",
        "[VERIFICAR] As incertezas de entrada são placeholders representativos; contribuições de operador/reprodutibilidade (cg-19 §6.3.7) e evaporação (§6.3.8) ainda não estão incluídas.",
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

export const volumeProductDefinition: TemplateProductDefinition = {
  assetTypeSlug: VOLUME_ASSET_TYPE_SLUG,
  name: METHOD_NAME,
  description: methodDescription,
  dataFields: MethodInputFieldSchema.array().parse(dataFields),
  variableBindings: [],
  formulas: [],
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
      assetTypeId: VOLUME_ASSET_TYPE_SLUG,
      dataFields,
      formulas: [],
      measurementModels,
      validations: [],
      metadata: {
        validationStatus: "pending_revalidation",
        source: "method-templates:volume-glassware",
      },
    },
    args,
  );
}

// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. The V0 equation is grounded in
// cg-19; the metrology MODEL (input uncertainties, omitted components) is
// [VERIFICAR]. Second scenario = envelope check (cold water) confirming no
// DOMAIN/EXPONENT error from the Tanaka/division terms.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "balao_100mL_20C",
    label: "Balão ~100 mL a 20 °C",
    inputs: {
      determinacoes: [
        {
          I_L: 149.82,
          I_E: 50.0,
          t_w: 20,
          rho_a: 0.0012,
          gamma: 0.00001,
        },
      ],
    },
    expected: {
      // Row-scoped model → one value per row. V0 = 100.1047 mL (cg-19 Eq. 1 +
      // Tanaka Eq. 2); u_c and U = 2·u_c propagated by the engine from the input
      // uncertainties. Pinned from the engine (decimal mode), within 1e-9.
      measurementModels: {
        volume_v0: {
          estimate: [100.104665735215],
          standardUncertainty: [0.002273531566076648],
          expandedUncertainty: [0.004547063132153296],
        },
      },
    },
  },
  {
    key: "envelope_agua_fria_5C",
    label: "Envelope: água a 5 °C (confirma ausência de DOMAIN/EXPONENT error)",
    inputs: {
      determinacoes: [
        {
          I_L: 150.0,
          I_E: 50.0,
          t_w: 5,
          rho_a: 0.0013,
          gamma: 0.00001,
        },
      ],
    },
    // No expected assertion — this scenario only confirms the model evaluates
    // without error across the temperature envelope.
  },
];

export const volumeGlasswareTemplate: TemplateModule = {
  key: "volume-glassware",
  templateVersion: 1,
  discipline: "volume",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-19 v4.1", "ISO 4787", "EA-4/02"],
  buildDraft,
  productDefinition: volumeProductDefinition,
  previewScenarios,
};
