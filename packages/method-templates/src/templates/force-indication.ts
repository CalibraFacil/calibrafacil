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
  MetrologyGovernance,
  TemplateModule,
  TemplateProductDefinition,
} from "../types";

/**
 * Force indication-error calibration of a force-measuring instrument
 * (dynamometer / load cell) by comparison against a reference force.
 *
 * ⚠️ DRAFT — pending metrologist review. Every metrology decision below is
 * marked [VERIFICAR] and drawn from public guides; no uncertainty value is
 * invented. Sources:
 *   - EURAMET cg-04 "Uncertainty of Force Measurements"
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" (the GUM framework: combination by RSS, k for ~95%).
 *
 * [VERIFICAR] SCOPE: this first draft models only repeatability, resolution and
 * the reference-standard contribution. EURAMET cg-04 additionally treats
 * reversibility/hysteresis, zero drift/creep, reproducibility (rotation/
 * repositioning) and temperature. Those components are intentionally OMITTED
 * here and MUST be reviewed/added before this method is used for real
 * calibrations.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived generically via buildDraftFromProduct (see product-to-draft.ts).
 */

const METHOD_NAME = "Calibração de Força por Erro de Indicação";
const FORCE_ASSET_TYPE_SLUG = "dinamometro";
const methodDescription =
  "Calibração de instrumentos de medição de força (dinamômetros/células de carga) por comparação direta contra uma força de referência. Erro de indicação E = leitura média − valor de referência; incerteza expandida combinando repetibilidade (Tipo A), resolução e a incerteza do padrão (EURAMET cg-04 / EA-4/02). Rascunho pendente de revisão metrológica.";

// Each table row is one calibration point.
const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_forca" } as const;

// --- Product-format inputs -----------------------------------------------------
const forceColumns = [
  {
    key: "valor_referencia",
    label: "Força de referência (valor convencional)",
    type: "number",
    unit: "N",
    quantityKind: "reference",
  },
  {
    // [VERIFICAR] this is the EXPANDED uncertainty U of the reference force from
    // the standard's calibration certificate (reduced to a standard uncertainty
    // below by the certificate's k).
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
  },
  {
    key: "resolucao",
    label: "Resolução do instrumento",
    type: "number",
    unit: "N",
    quantityKind: "resolution",
  },
  {
    key: "leitura_1",
    label: "Leitura 1",
    type: "number",
    unit: "N",
    quantityKind: "indication",
  },
  {
    key: "leitura_2",
    label: "Leitura 2",
    type: "number",
    unit: "N",
    quantityKind: "indication",
  },
  {
    key: "leitura_3",
    label: "Leitura 3",
    type: "number",
    unit: "N",
    quantityKind: "indication",
  },
];

const dataFields = [
  {
    key: "pontos_forca",
    label: "Pontos de calibração de força",
    type: "table",
    required: true,
    columns: forceColumns,
  },
];

// --- Product-format formulas (per calibration point) ---------------------------
// Expressions use only +, -, *, / , ^ and sqrt (math-engine SAFE_FUNCTIONS).
const formulas = [
  {
    outputKey: "media",
    label: "Indicação média",
    // [VERIFICAR] 3 repeated readings assumed; arithmetic mean.
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // [VERIFICAR] sign convention E = indicação − referência (EURAMET cg-04).
    expression: "media - valor_referencia",
    scope: ROW_SCOPE,
    unit: "N",
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
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    // [VERIFICAR] standard uncertainty of the MEAN = s/√n (n=3). If the result
    // applies to a single reading rather than the mean, EURAMET cg-04 would use
    // s directly — DECISION POINT for review.
    expression: "desvio_padrao / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    // [VERIFICAR] rectangular distribution, half-width = resolução/2, divisor √3
    // (EA-4/02). Equivalent to resolução/√12.
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    // [VERIFICAR] reduce the certificate's EXPANDED uncertainty to a standard
    // uncertainty by dividing by k. k_ref=2 ASSUMED — read the actual k from the
    // reference standard's certificate.
    expression: "incerteza_referencia / 2",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // [VERIFICAR] combination by RSS (EA-4/02). OMITS hysteresis/reversibility,
    // creep, zero drift, reproducibility and temperature (EURAMET cg-04) — add
    // before real use.
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_expandida",
    label: "Incerteza expandida (U)",
    // [VERIFICAR] k=2 for ~95% assuming a normal distribution and high effective
    // degrees of freedom. If veff is low, use a Welch–Satterthwaite veff +
    // Student-t (as the mass-balance method does).
    expression: "2 * u_combinada",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
];

// --- Certificate content -------------------------------------------------------
const certificateContent = {
  procedureCode: "[VERIFICAR]",
  referenceStandards: ["EURAMET cg-04", "EA-4/02"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por comparação direta entre a força de referência aplicada e a indicação do instrumento. O erro de indicação é E = indicação média − valor de referência.",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        {
          term: "VC",
          definition: "Valor convencional da força de referência.",
        },
        { term: "E", definition: "Erro de indicação (indicação − VC)." },
        { term: "U", definition: "Incerteza expandida (k = 2)." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada foi determinada conforme a EA-4/02, combinando por soma quadrática as contribuições de repetibilidade, resolução e do padrão de referência. A incerteza expandida é U = k·u_c com k = 2, correspondendo a uma probabilidade de abrangência de aproximadamente 95%.",
        "[VERIFICAR] Componentes de reversibilidade/histerese, deriva de zero, fluência e reprodutibilidade (EURAMET cg-04) ainda não estão incluídos.",
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

// --- Product definition (single source for buildDraft + the route) -------------
export const forceProductDefinition: TemplateProductDefinition = {
  assetTypeSlug: FORCE_ASSET_TYPE_SLUG,
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
      assetTypeId: FORCE_ASSET_TYPE_SLUG,
      dataFields,
      formulas,
      validations: [],
      metadata: {
        validationStatus: "pending_revalidation",
        source: "method-templates:force-indication",
      },
    },
    args,
  );
}

// --- Preview scenarios ---------------------------------------------------------
// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. They lock the formula
// arithmetic; the metrology MODEL still requires [VERIFICAR] review.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_1kN",
    label: "Ponto de 1 kN, U_padrão 0,5 N, resolução 0,1 N",
    inputs: {
      pontos_forca: [
        {
          valor_referencia: 1000,
          incerteza_referencia: 0.5,
          resolucao: 0.1,
          leitura_1: 1000.2,
          leitura_2: 1000.1,
          leitura_3: 1000.3,
        },
      ],
    },
    expected: {
      // Row-scoped formulas yield one value per row. Hand-checked:
      // E = 1000.2 − 1000 = 0.2 N; u_c = √(0.057735² + 0.028868² + 0.25²)
      // = 0.258199 N; U = 2·u_c.
      formulas: {
        erro: [0.2],
        u_repetibilidade: [0.05773502691896258],
        u_resolucao: [0.02886751345948129],
        u_referencia: [0.25],
        u_combinada: [0.2581988897471611],
        u_expandida: [0.5163977794943222],
      },
    },
  },
];

// --- Metrology governance ------------------------------------------------------
// Structured transcription of the header docblock — FAITHFUL ONLY, no invented
// metrology. See the docblock at the top of this file for the prose source.
const governance: MetrologyGovernance = {
  summary:
    "Calibração de força por erro de indicação (dinamômetro / célula de carga) por comparação direta contra uma força de referência. RASCUNHO pendente de revisão metrológica: este primeiro rascunho modela apenas repetibilidade, resolução e a contribuição do padrão de referência.",
  measurand: "E = leitura média − força de referência",
  model: "formulas",
  sources: [
    {
      // Docblock cites cg-04 by title only, without a URL.
      title: "EURAMET cg-04 \"Uncertainty of Force Measurements\"",
      edition: "cg-04",
    },
    {
      // Docblock cites EA-4/02 by title without a URL.
      title:
        "EA-4/02 \"Evaluation of the Uncertainty of Measurement in Calibration\" (GUM framework: combination by RSS, k for ~95%)",
      edition: "M:2022",
    },
  ],
  conformanceNotes: [
    {
      ref: "EA-4/02",
      note: "Incerteza-padrão combinada por soma quadrática (RSS) das contribuições de repetibilidade, resolução e padrão de referência; incerteza expandida U = k·u_c com k = 2 (~95%).",
    },
    {
      ref: "EURAMET cg-04",
      note: "Convenção de sinal do erro de indicação E = indicação − valor de referência segue a EURAMET cg-04.",
    },
  ],
  verificarItems: [
    {
      item: "Aterramento desta grandeza na EURAMET cg-04 antecede a regra 'read-the-guide'; deve ser reverificado contra o texto efetivo da cg-04 antes do uso real.",
      severity: "info",
    },
    {
      ref: "EURAMET cg-04 / EA-4/02",
      item: "SCOPE: este primeiro rascunho modela apenas repetibilidade, resolução e a contribuição do padrão de referência. Os demais componentes da cg-04 estão OMITIDOS e DEVEM ser revisados/adicionados antes de calibrações reais.",
      severity: "info",
      fieldKeys: ["u_repetibilidade", "u_resolucao", "u_referencia"],
    },
    {
      ref: "EURAMET cg-04 / EA-4/02",
      item: "Incerteza de repetibilidade (Tipo A) usa a incerteza-padrão da MÉDIA = s/√n (n=3). Se o resultado se aplica a uma leitura única em vez da média, a cg-04 usaria s diretamente — PONTO DE DECISÃO para revisão.",
      severity: "action",
      fieldKeys: ["u_repetibilidade", "desvio_padrao"],
    },
    {
      ref: "EURAMET cg-04 / EA-4/02",
      item: "Reduz a incerteza expandida do certificado do padrão para incerteza-padrão dividindo por k. k_ref=2 ASSUMIDO — ler o k real do certificado do padrão de referência.",
      severity: "action",
      fieldKeys: ["u_referencia", "incerteza_referencia"],
    },
  ],
  omittedComponents: [
    {
      ref: "EURAMET cg-04",
      component: "Reversibilidade / histerese",
    },
    {
      ref: "EURAMET cg-04",
      component: "Deriva de zero / fluência (creep)",
    },
    {
      ref: "EURAMET cg-04",
      component: "Reprodutibilidade (rotação / reposicionamento)",
      appliesWhen:
        "instrumento medido em diferentes orientações/posições de montagem",
    },
    {
      ref: "EURAMET cg-04",
      component: "Temperatura",
      appliesWhen: "condições de calibração fora da temperatura de referência",
    },
  ],
  workedExample: {
    scenarioKey: "ponto_1kN",
    provenance: "engine_characterization",
    source: "Motor (modo decimal)",
    expected: {
      erro: 0.2,
      u_combinada: 0.2581988897471611,
      u_expandida: 0.5163977794943222,
    },
  },
  reviewStatus: "draft_pending_revalidation",
};

export const forceIndicationTemplate: TemplateModule = {
  key: "force-indication",
  templateVersion: 1,
  discipline: "force",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-04", "EA-4/02"],
  buildDraft,
  productDefinition: forceProductDefinition,
  previewScenarios,
  governance,
};
