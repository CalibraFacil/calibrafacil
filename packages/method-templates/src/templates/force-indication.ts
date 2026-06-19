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
 * marked [VERIFICAR] and drawn from public guides that were READ IN FULL; no
 * uncertainty value is invented. Sources:
 *   - EURAMET cg-04 v3.0 (02/2022) "Guidelines on the Uncertainty of Force
 *     Measurements" (read): §6 calibration of force transducers (ISO 376) and
 *     §7.1 "Uncertainty contributions to be considered" (eq. 26 — combine the
 *     contributions in quadrature; W = k·w_c). Per §7.1 the reference-standard
 *     ("Calibration uncertainty") contribution is W_cal/2 = the Section-6
 *     expanded uncertainty ÷ k, which is this template's
 *     `u_referencia = incerteza_referencia / 2`.
 *     https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-004_Calibration_Guideline_No._4_web.pdf
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" (GUM framework: combination by RSS, k for ~95%):
 *     https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *
 * Conformance + scope (verified against the read cg-04 v3.0 text):
 *   - MODELLED (the core ISO 376 / cg-04 §7.1 terms): repeatability of the
 *     indication (Type A, s/√n), resolution (rectangular w_res), and the
 *     reference-standard calibration uncertainty (W_cal/2). Combined by RSS;
 *     U = k·u_c with k = 2 (~95%). These three terms are cg-04-consistent — the
 *     model is a correct SIMPLIFIED subset, not wrong; formulas unchanged.
 *   - [VERIFICAR] OMITTED — the additional cg-04 §7.1 contributions (with their
 *     guide treatments) are NOT yet modelled and MUST be reviewed/added before
 *     real use: reversibility/hysteresis (eq. 27, v/(100%·√3), rectangular),
 *     drift in sensitivity (rectangular, ± largest change between adjacent
 *     calibrations), temperature TC0/TCs (eq. 28/29, rectangular), end-loading,
 *     parasitic/reproducibility (rotation), time-loading profile, interpolation/
 *     linear-approximation, replacement indicator, dynamic force, and EMC.
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
  referenceStandards: ["EURAMET cg-04 v3.0", "EA-4/02 M:2022"],
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
        "[VERIFICAR] Contribuições adicionais da EURAMET cg-04 v3.0 §7.1 (reversibilidade/histerese, deriva de sensibilidade, temperatura, reprodutibilidade/parasitas, end-loading, perfil tempo-carga, interpolação, indicador substituto, força dinâmica e EMC) ainda não estão incluídas.",
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
      title: "EURAMET cg-04 \"Guidelines on the Uncertainty of Force Measurements\"",
      edition: "v3.0 (02/2022)",
      section: "§6 (transdutores / ISO 376) + §7.1 (eq. 26)",
      url: "https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-004_Calibration_Guideline_No._4_web.pdf",
    },
    {
      title:
        "EA-4/02 \"Evaluation of the Uncertainty of Measurement in Calibration\" (estrutura GUM: combinação por RSS, k para ~95%)",
      edition: "M:2022",
      url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
    },
  ],
  conformanceNotes: [
    {
      ref: "cg-04 v3.0 §7.1 eq. (26)",
      note: "As contribuições de incerteza são combinadas por soma quadrática (RSS) e a incerteza expandida é W = k·w_c. Este template combina repetibilidade, resolução e a contribuição do padrão exatamente nessa forma, com k = 2 (~95%).",
    },
    {
      ref: "cg-04 v3.0 §7.1 (\"Calibration uncertainty\")",
      note: "A contribuição do padrão de referência é W_cal/2 — metade da incerteza expandida calculada na Seção 6 (ISO 376). Corresponde a u_referencia = incerteza_referencia / 2 (assumindo k_ref = 2).",
    },
    {
      ref: "cg-04 v3.0 §7.1 / §6.1 (resolução)",
      note: "A resolução entra como componente retangular (w_res); se as leituras flutuarem mais que a resolução, usa-se metade da faixa de flutuação. Corresponde a u_resolucao = (resolucao/2)/√3.",
    },
    {
      ref: "cg-04 v3.0 §6 / ISO 376",
      note: "O modelo de erro de indicação E = indicação média − valor de referência segue a calibração de instrumentos de medição de força (ISO 376) descrita na Seção 6.",
    },
  ],
  verificarItems: [
    {
      ref: "cg-04 v3.0 §7.1",
      item: "MODELO SIMPLIFICADO: este rascunho modela apenas repetibilidade (Tipo A), resolução e a contribuição do padrão de referência. Os demais contribuintes da cg-04 §7.1 estão OMITIDOS e DEVEM ser revisados/adicionados antes de calibrações reais (ver Componentes omitidos).",
      severity: "action",
      fieldKeys: ["u_repetibilidade", "u_resolucao", "u_referencia"],
    },
    {
      ref: "cg-04 v3.0 §6.1 / ISO 376",
      item: "Repetibilidade (Tipo A) usa a incerteza-padrão da MÉDIA = s/√n (n=3). Se o resultado se aplica a uma leitura única em vez da média, usa-se s diretamente — PONTO DE DECISÃO para revisão.",
      severity: "action",
      fieldKeys: ["u_repetibilidade", "desvio_padrao"],
    },
    {
      ref: "cg-04 v3.0 §7.1 (\"Calibration uncertainty\" = W_cal/2)",
      item: "Reduz a incerteza expandida do certificado do padrão para incerteza-padrão dividindo por k. k_ref = 2 ASSUMIDO — ler o k real do certificado do padrão de referência.",
      severity: "action",
      fieldKeys: ["u_referencia", "incerteza_referencia"],
    },
    {
      ref: "cg-04 v3.0 §7.1 / EA-4/02 §5",
      item: "k = 2 (~95%) assume normalidade e graus de liberdade efetivos altos. Se veff for baixo, usar veff por Welch–Satterthwaite + t-Student.",
      severity: "info",
      fieldKeys: ["u_combinada", "u_expandida"],
    },
  ],
  omittedComponents: [
    {
      ref: "cg-04 v3.0 §7.1 eq. (27)",
      component:
        "Reversibilidade / histerese — w_rev = v/(100%·√3) (retangular), v = erro de reversibilidade relativo (ISO 376)",
      appliesWhen:
        "medições com força decrescente, sem correção pelos dados de calibração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (w_drift)",
      component:
        "Deriva de sensibilidade desde a calibração — retangular, ± maior variação entre calibrações adjacentes",
    },
    {
      ref: "cg-04 v3.0 §7.1 eq. (28)/(29)",
      component:
        "Efeitos de temperatura no zero (TC0) e na sensibilidade (TCs) — retangular; TC0 geralmente desprezível, TCs precisa ser considerado",
      appliesWhen: "uso fora da temperatura de calibração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (parasitas / reprodutibilidade)",
      component:
        "Componentes parasitas / reprodutibilidade (rotação/reposicionamento) — a reprodutibilidade da calibração só vale para a média de 3 medições; girar o instrumento entre corridas",
    },
    {
      ref: "cg-04 v3.0 §7.1 (end-loading)",
      component:
        "Condições de carregamento de extremidade (end-loading) — ensaio do bearing pad da ISO 376",
    },
    {
      ref: "cg-04 v3.0 §7.1 (time-loading)",
      component:
        "Perfil tempo-carga — diferenças entre ISO 376 (espera de 30 s) e o uso subsequente (p.ex. ISO 7500-1)",
    },
    {
      ref: "cg-04 v3.0 §7.1 (aproximações à equação)",
      component:
        "Aproximações lineares à equação de interpolação / equação de calibração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (indicador substituto)",
      component:
        "Efeito de indicador substituto — se o transdutor for usado com indicador diferente do da calibração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (força dinâmica)",
      component:
        "Natureza dinâmica da força medida — requer análise de medição dinâmica (não coberta em detalhe pela cg-04)",
    },
    {
      ref: "cg-04 v3.0 §7.1 (EMC)",
      component:
        "Efeitos eletromagnéticos (EMC) — devem ser considerados no orçamento de incerteza",
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
  citations: ["EURAMET cg-04 v3.0", "EA-4/02 M:2022"],
  buildDraft,
  productDefinition: forceProductDefinition,
  previewScenarios,
  governance,
};
