import type {
  MethodDraft,
  MethodPreviewScenario,
} from "@calibra-facil/method-definition";
import {
  MethodCertificateContentSchema,
  MethodFormulaSchema,
  MethodInputFieldSchema,
} from "@calibra-facil/schemas";

import { buildDraftFromProduct } from "../product-to-draft";
import type {
  BuildDraftArgs,
  TemplateModule,
  TemplateProductDefinition,
} from "../types";

/**
 * Rotational-speed (RPM) indication-error calibration of a tachometer by
 * comparison against a reference rotation rate.
 *
 * ⚠️ DRAFT — pending metrologist review. Every metrology decision is marked
 * [VERIFICAR] and drawn from a cited public guide; no uncertainty value is
 * invented. Source for the uncertainty framework (Type A, rectangular
 * resolution, RSS combination, k for ~95%):
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration": https://european-accreditation.org/publications/ea-4-02/
 *
 * [VERIFICAR] DISCIPLINE PROCEDURE: there is no discipline-specific EURAMET cg
 * cited here for rotation/frequency — the calibration procedure, the contact vs.
 * optical method, and any stroboscope/gate-time quantization contribution must
 * be supplied/confirmed by the metrologist. Only repeatability, resolution and
 * the reference standard are modelled; reproducibility (across mounting/angle)
 * and any time-base contribution are OMITTED pending review.
 */

const METHOD_NAME = "Calibração de Tacômetro por Erro de Indicação";
const TACHOMETER_ASSET_TYPE_SLUG = "tacometro";
const methodDescription =
  "Calibração de tacômetros por comparação direta da rotação indicada contra uma referência (rpm). Erro de indicação E = leitura média − valor de referência; incerteza expandida combinando repetibilidade (Tipo A), resolução e a incerteza do padrão por soma quadrática (EA-4/02). Rascunho pendente de revisão metrológica.";

// Each table row is one calibration point.
const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_rotacao" } as const;

const tachometerColumns = [
  {
    key: "valor_referencia",
    label: "Rotação de referência (valor convencional)",
    type: "number",
    unit: "rpm",
    quantityKind: "reference",
  },
  {
    // [VERIFICAR] EXPANDED uncertainty U of the reference from its certificate,
    // reduced to a standard uncertainty below by the certificate's k.
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "rpm",
    quantityKind: "uncertainty",
  },
  {
    key: "resolucao",
    label: "Resolução do instrumento",
    type: "number",
    unit: "rpm",
    quantityKind: "resolution",
  },
  {
    key: "leitura_1",
    label: "Leitura 1",
    type: "number",
    unit: "rpm",
    quantityKind: "indication",
  },
  {
    key: "leitura_2",
    label: "Leitura 2",
    type: "number",
    unit: "rpm",
    quantityKind: "indication",
  },
  {
    key: "leitura_3",
    label: "Leitura 3",
    type: "number",
    unit: "rpm",
    quantityKind: "indication",
  },
];

const dataFields = [
  {
    key: "pontos_rotacao",
    label: "Pontos de calibração de rotação",
    type: "table",
    required: true,
    columns: tachometerColumns,
  },
];

// Expressions use only +, -, *, / , ^ and sqrt (math-engine SAFE_FUNCTIONS).
const formulas = [
  {
    outputKey: "media",
    label: "Indicação média",
    // [VERIFICAR] 3 repeated readings assumed; arithmetic mean.
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // [VERIFICAR] sign convention E = indicação − referência.
    expression: "media - valor_referencia",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_padrao",
    label: "Desvio-padrão experimental",
    // [VERIFICAR] sample standard deviation, divisor (n−1)=2 for n=3 readings
    // (EA-4/02 Type A). Hardcoded n=3 to match the 3 reading columns.
    expression:
      "sqrt(((leitura_1 - media) ^ 2 + (leitura_2 - media) ^ 2 + (leitura_3 - media) ^ 2) / 2)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    // [VERIFICAR] standard uncertainty of the MEAN = s/√n (n=3). If the result
    // applies to a single reading rather than the mean, use s directly.
    expression: "desvio_padrao / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    // [VERIFICAR] rectangular distribution, half-width = resolução/2, divisor √3
    // (EA-4/02). Equivalent to resolução/√12.
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    // [VERIFICAR] reduce the certificate's EXPANDED uncertainty to a standard
    // uncertainty by dividing by k. k_ref=2 ASSUMED — read from the certificate.
    expression: "incerteza_referencia / 2",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // [VERIFICAR] combination by RSS (EA-4/02). OMITS reproducibility and any
    // time-base/quantization contribution — add before real use.
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_expandida",
    label: "Incerteza expandida (U)",
    // [VERIFICAR] k=2 for ~95% assuming a normal distribution and high effective
    // degrees of freedom. If veff is low, use a Welch–Satterthwaite veff + t.
    expression: "2 * u_combinada",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
];

const certificateContent = {
  procedureCode: "[VERIFICAR]",
  referenceStandards: ["EA-4/02"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por comparação direta entre a rotação de referência e a indicação do tacômetro. O erro de indicação é E = indicação média − valor de referência.",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "VC", definition: "Valor convencional da rotação de referência." },
        { term: "E", definition: "Erro de indicação (indicação − VC)." },
        { term: "U", definition: "Incerteza expandida (k = 2)." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada foi determinada conforme a EA-4/02, combinando por soma quadrática as contribuições de repetibilidade, resolução e do padrão de referência. A incerteza expandida é U = k·u_c com k = 2 (~95%).",
        "[VERIFICAR] Reprodutibilidade e contribuições de base de tempo/quantização (estroboscópio) ainda não estão incluídas.",
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

export const frequencyProductDefinition: TemplateProductDefinition = {
  assetTypeSlug: TACHOMETER_ASSET_TYPE_SLUG,
  name: METHOD_NAME,
  description: methodDescription,
  dataFields: MethodInputFieldSchema.array().parse(dataFields),
  variableBindings: [],
  formulas: MethodFormulaSchema.array().parse(formulas),
  measurementModels: [],
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
      assetTypeId: TACHOMETER_ASSET_TYPE_SLUG,
      dataFields,
      formulas,
      validations: [],
      metadata: {
        validationStatus: "pending_revalidation",
        source: "method-templates:frequency-indication",
      },
    },
    args,
  );
}

// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. They lock the arithmetic; the
// metrology MODEL still requires [VERIFICAR] review.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_1500rpm",
    label: "Ponto de 1500 rpm, U_padrão 1,0 rpm, resolução 1 rpm",
    inputs: {
      pontos_rotacao: [
        {
          valor_referencia: 1500,
          incerteza_referencia: 1.0,
          resolucao: 1,
          leitura_1: 1502,
          leitura_2: 1501,
          leitura_3: 1503,
        },
      ],
    },
    expected: {
      // Hand-checked: E = 1502 − 1500 = 2 rpm; s = 1; u_c = √(0.57735² +
      // 0.288675² + 0.5²) = 0.816497 rpm; U = 2·u_c. (pinned from the engine)
      formulas: {
        erro: [2],
        u_repetibilidade: [0.5773502691896258],
        u_resolucao: [0.2886751345948129],
        u_referencia: [0.5],
        u_combinada: [0.816496580927726],
        u_expandida: [1.632993161855452],
      },
    },
  },
];

export const frequencyIndicationTemplate: TemplateModule = {
  key: "frequency-indication",
  templateVersion: 1,
  discipline: "frequency",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EA-4/02"],
  buildDraft,
  productDefinition: frequencyProductDefinition,
  previewScenarios,
};
