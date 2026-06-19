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
 * Platform-canonical calibration of a non-automatic weighing instrument (NAWI /
 * electronic balance) by error of indication, grounded in EURAMET cg-18.
 *
 * This is the GENERIC, guide-grounded mass/balance template — the platform mass
 * method. Exemplo's FOR 50/51 method lives only in its seed script (mass-balance.ts
 * + seed-exemplo-balance-method.mjs), not in this catalog.
 *
 * ⚠️ DRAFT — pending metrologist review. Model + the full uncertainty budget were
 * read from the cited guide and validated against its Appendix H1 worked example
 * (the preview below reproduces H1's E, u(E) and U(E) for the 100 g point).
 * Sources (read in full from the PDFs, not merely cited):
 *   - EURAMET cg-18 v4.0 "Guidelines on the Calibration of Non-Automatic
 *     Weighing Instruments":
 *     https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-018_Calibration_Guide_No._18_web.pdf
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" (the GUM framework). NOTE: european-accreditation.org serves
 *     no PDF at /publications/ea-4-02/; the document is freely available from EA
 *     member bodies, e.g. ENAC:
 *     https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *   - UKAS LAB 14 ed.8 (Dec 2025) "Guidance on the calibration of weighing
 *     machines used in testing and calibration laboratories". §1.2 explicitly
 *     defers to EURAMET cg-18 for accredited weighing-machine calibration, so it
 *     is used here only to CORROBORATE the coverage treatment (§5.2 + Table 2)
 *     and the multi-weight rule (§4.2.2):
 *     https://www.ukas.com/wp-content/uploads/schedule_uploads/759162/LAB-14-Guidance-on-the-calibration-of-weighing-machines.pdf
 *
 * Conformance to cg-18 (read from the v4.0 text):
 *   - §4.2.4 / §7.1-1: E = I − m_ref, where I is the ERROR-TEST indication (a net
 *     load−noload reading, §4.4.1) and m_ref is the conventional mass of the
 *     standards. The repeatability standard deviation s comes from a SEPARATE
 *     ≥5-loading repeatability test (§5.1) — the two are kept distinct here.
 *   - §7.1.1: u²(I) = d₀²/12 + d_L²/12 + u²(δI_rep) + u²(δI_ecc): rounding at the
 *     zero AND load readings (each rectangular d/(2√3), §7.1.1-2a/3a),
 *     repeatability (Type A, s, §7.1.1-5), eccentricity (§7.1.1-10).
 *   - §7.1.2: u²(m_ref) = u²(δm_c) + u²(δm_B) + u²(δm_D) [+ u²(δm_conv)]:
 *     certified value U/k (§7.1.2-2), air buoyancy (§7.1.2.2), drift (§7.1.2.3).
 *   - §7.1.3-1a: combine all by RSS (inputs uncorrelated).
 *
 * [VERIFICAR] every metrology decision:
 *   - Buoyancy u(δm_B) and drift u(δm_D) are entered as standard uncertainties
 *     (`u_empuxo`, `u_deriva`); compute them per §7.1.2.2 (eq. 7.1.2-5a..5e, by
 *     air density or weight-class mpe) and §7.1.2.3 (D = k_D·U, k_D∈[1,3]). For
 *     E2/E1 weights buoyancy typically DOMINATES the budget — do not set it to 0.
 *   - Convection (§7.1.2.4) is OMITTED — relevant for class F1 or better and
 *     acclimatization-dependent; add u(δm_conv)=Δm_conv/√3 if applicable.
 *   - Repeatability divisor is s (single error-test indication, §7.1.1-5); use
 *     s/√N only if the reported indication is the mean of N error-test readings
 *     (§7.1.1-6). Here `indicacao` is a single reading, so s is used.
 *   - Reference weights: U/k with k_ref=2 ASSUMED — read the actual k from the
 *     certificate; for a load of several weights SUM the per-weight δm_c
 *     ARITHMETICALLY (correlated), not in quadrature (cg-18 §7.1.2.1; UKAS LAB 14
 *     §4.2.2 applies the same arithmetic sum to combined weights). Arithmetic
 *     sum ≥ RSS, so the cg-18/LAB-14 treatment is the CONSERVATIVE one. The open
 *     question in issue #506 (item 3) is the inverse code risk: whether the
 *     composition layer (`uncertaintyMode: "expanded_rss"`) actually sums
 *     ARITHMETICALLY here or in QUADRATURE — RSS would UNDER-state for stacked
 *     loads, so it still needs a code check.
 *   - Coverage factor k is COMPUTED, not assumed: Welch–Satterthwaite ν_eff
 *     (cg-18 Appendix B3-1; EA-4/02 Appendix E) + the two-tailed Student-t at
 *     95.45%. This is required because the Type A term rests on <10 observations,
 *     so a flat k=2 would be non-conformant: EA-4/02 §5.3 states "the reliability
 *     criterion is satisfied if none of the uncertainty contributions is obtained
 *     from a Type A evaluation based on fewer than ten repeated observations"
 *     (see also §5.4 and cg-18 Appendix B2). UKAS LAB 14 §5.2 + Table 2 corroborate
 *     numerically: t for ν_eff = n−1 gives k₉₅ ≈ 2.87 at ν=4. k → 2 where the
 *     Type B terms dominate and rises (≈2.87 at zero load) where repeatability
 *     dominates. [VERIFICAR] ν_rep = n−1 = 4 (5 readings); Type B terms taken ν=∞.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived via the shared buildDraftFromProduct.
 */

const METHOD_NAME =
  "Calibração de Instrumento de Pesagem Não-Automático (NAWI) por Erro de Indicação";
const BALANCE_ASSET_TYPE_SLUG = "balanca-digital";
const methodDescription =
  "Calibração de instrumentos de pesagem não-automáticos (balanças eletrônicas) por erro de indicação E = indicação − m_ref (massa convencional dos padrões), conforme EURAMET cg-18 §7.1. Incerteza combinando repetibilidade (Tipo A), arredondamento no zero e na carga, excentricidade, incerteza dos padrões, empuxo do ar e deriva, por soma quadrática (§7.1.3); fator de abrangência k por Welch–Satterthwaite + t-Student a 95,45% (Apêndice B3). Convecção adiada ([VERIFICAR]). Rascunho pendente de revisão metrológica.";

const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_pesagem" } as const;

const weighingColumns = [
  {
    key: "m_ref",
    label: "Massa convencional dos padrões (m_ref)",
    type: "number",
    unit: "g",
    quantityKind: "reference",
  },
  {
    // cg-18 §4.4.1: net (load − no-load) indication from the ERROR test (one
    // reading per load). [VERIFICAR] enter the zeroed/net indication.
    key: "indicacao",
    label: "Indicação no ensaio de erro (I)",
    type: "number",
    unit: "g",
    quantityKind: "indication",
  },
  {
    // cg-18 §7.1.2.1: U/k from the weight certificate. [VERIFICAR] for a load of
    // several weights, sum the per-weight δm_c ARITHMETICALLY (§7.1.2.1).
    key: "incerteza_padrao",
    label: "Incerteza expandida dos padrões (U)",
    type: "number",
    unit: "g",
    quantityKind: "uncertainty",
  },
  {
    key: "resolucao",
    label: "Resolução / intervalo de escala (d)",
    type: "number",
    unit: "g",
    quantityKind: "resolution",
  },
  {
    // cg-18 §5.1: load applied ≥5 times for the SEPARATE repeatability test.
    key: "rep_1",
    label: "Repetibilidade — leitura 1",
    type: "number",
    unit: "g",
    quantityKind: "indication",
  },
  { key: "rep_2", label: "Repetibilidade — leitura 2", type: "number", unit: "g", quantityKind: "indication" },
  { key: "rep_3", label: "Repetibilidade — leitura 3", type: "number", unit: "g", quantityKind: "indication" },
  { key: "rep_4", label: "Repetibilidade — leitura 4", type: "number", unit: "g", quantityKind: "indication" },
  { key: "rep_5", label: "Repetibilidade — leitura 5", type: "number", unit: "g", quantityKind: "indication" },
  {
    key: "excentricidade_max",
    label: "Maior diferença de excentricidade (|ΔI_ecc|max)",
    type: "number",
    unit: "g",
    quantityKind: "other",
  },
  {
    key: "carga_excentricidade",
    label: "Carga do ensaio de excentricidade (L_ecc)",
    type: "number",
    unit: "g",
    quantityKind: "other",
  },
  {
    // cg-18 §7.1.2.2: air-buoyancy standard uncertainty u(δm_B). [VERIFICAR]
    // compute per eq. 7.1.2-5a..5e; DOMINATES for E2/E1 weights — not zero.
    key: "u_empuxo",
    label: "Incerteza de empuxo do ar (u(δm_B))",
    type: "number",
    unit: "g",
    quantityKind: "uncertainty",
  },
  {
    // cg-18 §7.1.2.3: drift standard uncertainty u(δm_D) = D/√3, D = k_D·U.
    key: "u_deriva",
    label: "Incerteza de deriva dos padrões (u(δm_D))",
    type: "number",
    unit: "g",
    quantityKind: "uncertainty",
  },
];

const dataFields = [
  {
    key: "pontos_pesagem",
    label: "Pontos de calibração de pesagem",
    type: "table",
    required: true,
    columns: weighingColumns,
  },
];

// Expressions use only +, -, *, / , ^ and sqrt (math-engine SAFE_FUNCTIONS).
const formulas = [
  {
    outputKey: "media_repetibilidade",
    label: "Média do ensaio de repetibilidade",
    // cg-18 §6.1: mean of the ≥5 repeatability readings (basis for s only).
    expression: "(rep_1 + rep_2 + rep_3 + rep_4 + rep_5) / 5",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // cg-18 §4.2.4-1 / §7.1-1: E = I − m_ref (I = error-test indication).
    expression: "indicacao - m_ref",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_padrao",
    label: "Desvio-padrão experimental (repetibilidade)",
    // cg-18 §6.1-1: sample standard deviation, divisor (n−1)=4 for n=5 readings.
    expression:
      "sqrt(((rep_1 - media_repetibilidade) ^ 2 + (rep_2 - media_repetibilidade) ^ 2 + (rep_3 - media_repetibilidade) ^ 2 + (rep_4 - media_repetibilidade) ^ 2 + (rep_5 - media_repetibilidade) ^ 2) / 4)",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    // [VERIFICAR] cg-18 §7.1.1-5: u(δI_rep) = s (single error-test indication).
    // Use s/√N only if the indication is itself the mean of N readings (§7.1.1-6).
    expression: "desvio_padrao",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_res_zero",
    label: "Incerteza de arredondamento no zero",
    // [VERIFICAR] cg-18 §7.1.1-2a: rectangular, half-width d/2, divisor √3.
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_res_carga",
    label: "Incerteza de arredondamento na carga",
    // [VERIFICAR] cg-18 §7.1.1-3a: rectangular, half-width d/2, divisor √3.
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_excentricidade",
    label: "Incerteza de excentricidade",
    // [VERIFICAR] cg-18 §7.1.1-10: u(δI_ecc) = I·|ΔI_ecc|max/(2·L_ecc·√3), with I
    // the error-test indication.
    expression:
      "indicacao * excentricidade_max / (2 * carga_excentricidade * sqrt(3))",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza dos padrões de referência",
    // [VERIFICAR] cg-18 §7.1.2-2: u(δm_c) = U/k. k_ref=2 ASSUMED — read from cert.
    expression: "incerteza_padrao / 2",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // cg-18 §7.1.3-1a: RSS (uncorrelated). u_empuxo (§7.1.2.2) and u_deriva
    // (§7.1.2.3) are entered as standard uncertainties. [VERIFICAR] convection
    // (§7.1.2.4) is omitted (F1+ / acclimatization-dependent).
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_res_zero ^ 2 + u_res_carga ^ 2 + u_excentricidade ^ 2 + u_referencia ^ 2 + u_empuxo ^ 2 + u_deriva ^ 2)",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "veff",
    label: "Graus de liberdade efetivos (Welch–Satterthwaite)",
    // cg-18 Appendix B3-1: ν_eff = u_c⁴ / Σ(uᵢ⁴/νᵢ). Only the Type A repeatability
    // has finite DoF (ν = n−1 = 4 for the 5 readings); the Type B (rectangular/
    // normal) terms are taken as ν=∞ (cg-18 App. H Note 3) and drop out of the sum.
    // [VERIFICAR] ν_rep = 4 assumes exactly 5 repeatability readings.
    expression:
      "if_zero(u_repetibilidade, 1000000000, (u_combinada ^ 4) / ((u_repetibilidade ^ 4) / 4))",
    scope: ROW_SCOPE,
    reporting: { role: "auxiliary", group: "uncertainty_budget" },
  },
  {
    outputKey: "fator_k",
    label: "Fator de abrangência (k)",
    // cg-18 §7.3 / Appendix B1+B3: k from the two-tailed Student-t at 95.45%
    // (P=0.9545 → α=0.0455) with ν_eff — required because the Type A term rests on
    // <10 observations, so a flat k=2 is NOT permitted (Appendix B2). Guards the
    // ν=∞ case → k=2. [VERIFICAR] the coverage probability + the t-inverse.
    expression: "if_zero(u_repetibilidade, 2, student_t_inverse_2t(0.0455, veff))",
    scope: ROW_SCOPE,
    reporting: {
      includeInCertificate: true,
      role: "coverage_factor",
      group: "calibration_result",
    },
  },
  {
    outputKey: "u_expandida",
    label: "Incerteza expandida (U)",
    // cg-18 §7.3: U = k·u_c, with k the Welch–Satterthwaite/Student-t factor above
    // (≈2 where Type B dominates; >2 at low load where repeatability dominates).
    expression: "fator_k * u_combinada",
    scope: ROW_SCOPE,
    unit: "g",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
];

const certificateContent = {
  procedureCode: "[VERIFICAR]",
  referenceStandards: ["EURAMET cg-18 v4.0", "EA-4/02 M:2022", "UKAS LAB 14 ed.8"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por comparação entre a massa convencional dos padrões e a indicação do instrumento. O erro de indicação é E = indicação − m_ref (EURAMET cg-18 §7.1-1).",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "m_ref", definition: "Massa convencional dos padrões de referência." },
        { term: "E", definition: "Erro de indicação (indicação − m_ref)." },
        { term: "d", definition: "Resolução / intervalo de escala." },
        { term: "U", definition: "Incerteza expandida (U = k·u_c)." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada foi determinada conforme a EA-4/02 / cg-18 §7.1.3, combinando por soma quadrática a repetibilidade (Tipo A), o arredondamento no zero e na carga, a excentricidade, a incerteza dos padrões, o empuxo do ar e a deriva.",
        "A incerteza expandida é U = k·u_c, com o fator de abrangência k determinado a partir dos graus de liberdade efetivos (Welch–Satterthwaite) e da distribuição t-Student para uma probabilidade de abrangência de aproximadamente 95,45% (cg-18 Apêndice B3). k tende a 2 quando as contribuições Tipo B predominam e aumenta (p.ex. ~2,87 em carga nula) quando a repetibilidade predomina.",
        "[VERIFICAR] A contribuição de convecção (§7.1.2.4) não está incluída (relevante para classe F1 ou superior).",
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

export const weighingProductDefinition: TemplateProductDefinition = {
  assetTypeSlug: BALANCE_ASSET_TYPE_SLUG,
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
      assetTypeId: BALANCE_ASSET_TYPE_SLUG,
      dataFields,
      formulas,
      validations: [],
      metadata: {
        validationStatus: "pending_revalidation",
        source: "method-templates:weighing-instrument",
      },
    },
    args,
  );
}

// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. Inputs are the cg-18 Appendix H1
// worked example (100 g, class E2, Situation A Option 1, buoyancy form 7.1.2-5d):
// this REPRODUCES the guide's published E = 0.0007 g, u(E) ≈ 0.000900 g and
// U(E) ≈ 0.00180 g (k=2 at this load). The buoyancy term dominates, exactly as in
// the guide. The metrology MODEL keeps [VERIFICAR] for k at low load + convection.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_100g_h1",
    label: "Ponto 100 g (cg-18 Apêndice H1, classe E2, opção 1)",
    inputs: {
      pontos_pesagem: [
        {
          m_ref: 99.9999,
          indicacao: 100.0006,
          incerteza_padrao: 0.00005,
          resolucao: 0.0001,
          rep_1: 100.0006,
          rep_2: 100.0003,
          rep_3: 100.0005,
          rep_4: 100.0004,
          rep_5: 100.0005,
          excentricidade_max: 0.0002,
          carga_excentricidade: 100,
          u_empuxo: 0.000889,
          u_deriva: 0.000036,
        },
      ],
    },
    expected: {
      // Row-scoped → one value per row. REPRODUCES cg-18 Appendix H1 (100 g):
      // E = 0.0007 g, u(E) = 0.000900 g, ν_eff = 15538 (matches the guide's
      // table), k = 2.0002 (Student-t at ν_eff ≈ 2.00 in the guide), U = 0.00180 g
      // — buoyancy dominates, as in the guide. Pinned from the engine, within 1e-9.
      formulas: {
        erro: [0.0007],
        u_repetibilidade: [0.0001140175425099138],
        u_res_zero: [0.00002886751345948129],
        u_excentricidade: [0.00005773537332912409],
        u_referencia: [0.000025],
        u_combinada: [0.0009001344566230759],
        veff: [15538.27605641553],
        fator_k: [2.0001633529712803],
        u_expandida: [0.0018004159528841929],
      },
    },
  },
];

export const weighingInstrumentTemplate: TemplateModule = {
  key: "weighing-instrument",
  templateVersion: 1,
  discipline: "mass",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-18 v4.0", "EA-4/02 M:2022", "UKAS LAB 14 ed.8"],
  governance: {
    summary:
      "Template de massa genérico, fundamentado em guia (EURAMET cg-18): calibração de balança/NAWI por erro de indicação, com o orçamento de incerteza validado contra o exemplo H1 do guia. Rascunho pendente de revisão metrológica.",
    measurand: "E = indicação − m_ref (cg-18 §7.1-1)",
    model: "formulas",
    sources: [
      {
        title: "EURAMET cg-18",
        edition: "v4.0",
        section: "§7.1",
        url: "https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-018_Calibration_Guide_No._18_web.pdf",
      },
      {
        title: "EA-4/02",
        edition: "M:2022",
        section: "§5.3",
        url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
      },
      {
        title: "UKAS LAB 14",
        edition: "ed.8 (dez/2025)",
        section: "§5.2 + Table 2 / §4.2.2",
        url: "https://www.ukas.com/wp-content/uploads/schedule_uploads/759162/LAB-14-Guidance-on-the-calibration-of-weighing-machines.pdf",
      },
    ],
    conformanceNotes: [
      {
        ref: "§4.2.4 / §7.1-1",
        note: "E = I − m_ref, onde I é a indicação do ENSAIO DE ERRO (leitura líquida carga−sem carga, §4.4.1) e m_ref é a massa convencional dos padrões. O desvio-padrão de repetibilidade s vem de um ensaio SEPARADO com ≥5 carregamentos (§5.1) — mantidos distintos aqui.",
      },
      {
        ref: "§7.1.1",
        note: "u²(I) = d₀²/12 + d_L²/12 + u²(δI_rep) + u²(δI_ecc): arredondamento nas leituras de zero E de carga (cada uma retangular d/(2√3), §7.1.1-2a/3a), repetibilidade (Tipo A, s, §7.1.1-5) e excentricidade (§7.1.1-10).",
      },
      {
        ref: "§7.1.2",
        note: "u²(m_ref) = u²(δm_c) + u²(δm_B) + u²(δm_D) [+ u²(δm_conv)]: valor certificado U/k (§7.1.2-2), empuxo do ar (§7.1.2.2) e deriva (§7.1.2.3).",
      },
      {
        ref: "§7.1.3-1a",
        note: "Combinação por soma quadrática (RSS), entradas não correlacionadas.",
      },
    ],
    verificarItems: [
      {
        item:
          "Empuxo u(δm_B) e deriva u(δm_D) entram como incertezas-padrão (u_empuxo, u_deriva); calcule-as por §7.1.2.2 (eq. 7.1.2-5a..5e, pela densidade do ar ou pelo emp da classe do peso) e §7.1.2.3 (D = k_D·U, k_D∈[1,3]). Para pesos E2/E1 o empuxo normalmente DOMINA o orçamento — não use 0.",
        severity: "action",
        fieldKeys: ["u_empuxo", "u_deriva"],
      },
      {
        item:
          "Convecção (§7.1.2.4) é situacional — relevante para classe F1 ou melhor e dependente de aclimatização; some u(δm_conv)=Δm_conv/√3 quando se aplicar.",
        severity: "info",
      },
      {
        item:
          "O divisor de repetibilidade é s (indicação única do ensaio de erro, §7.1.1-5); use s/√N só se a indicação reportada for a média de N leituras (§7.1.1-6). Aqui indicacao é uma leitura única, então usa-se s.",
        severity: "info",
        fieldKeys: ["indicacao", "rep_1", "rep_2", "rep_3", "rep_4", "rep_5"],
      },
      {
        item:
          "Padrões: U/k com k_ref=2 ASSUMIDO — leia o k real do certificado; para carga de vários pesos some os δm_c por peso ARITMETICAMENTE (correlacionados), não em quadratura (cg-18 §7.1.2.1; UKAS LAB 14 §4.2.2). A soma aritmética ≥ RSS, logo é o tratamento CONSERVADOR.",
        severity: "action",
        fieldKeys: ["incerteza_padrao"],
      },
      {
        item:
          "O fator de abrangência k é CALCULADO, não assumido: ν_eff por Welch–Satterthwaite (cg-18 Apêndice B3-1; EA-4/02 Apêndice E) + t-Student bicaudal a 95,45%. ν_rep = n−1 = 4 (5 leituras); termos Tipo B com ν=∞.",
        severity: "info",
        fieldKeys: ["rep_1", "rep_2", "rep_3", "rep_4", "rep_5"],
      },
    ],
    omittedComponents: [
      {
        ref: "§7.1.2.4",
        component: "Convecção u(δm_conv) = Δm_conv/√3",
        appliesWhen: "classe F1 ou melhor; dependente de aclimatização",
      },
    ],
    workedExample: {
      scenarioKey: "ponto_100g_h1",
      provenance: "cited_guide_table",
      source: "EURAMET cg-18 Apêndice H1 (100 g)",
      expected: {
        erro: 0.0007,
        u_expandida: 0.0018004159528841929,
      },
    },
    reviewStatus: "draft_pending_revalidation",
  },
  buildDraft,
  productDefinition: weighingProductDefinition,
  previewScenarios,
};
