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
 * ⚠️ DRAFT — pending metrologist review. No uncertainty MAGNITUDE is invented:
 * every structural decision (divisor / distribution / coverage) is taken from
 * the cited guides, which were READ IN FULL from their PDFs (not merely cited).
 * Lab-specific magnitudes (drift, temperature sensitivity, reference k) stay as
 * lab-filled inputs marked [VERIFICAR] on the VALUE only. Sources:
 *   - EURAMET cg-04 v3.0 (02/2022) "Guidelines on the Uncertainty of Force
 *     Measurements" (read): §6 calibration of force transducers (ISO 376) and
 *     §7.1 "Uncertainty contributions to be considered" — the SUBSEQUENT-USE
 *     budget, eq. (26): w_c = √((W_cal/2)² + w_res² + w_rev² + w_TC0² + w_TCS² +
 *     w_drift² + …) and W = k·w_c. Per §7.1 ("Calibration uncertainty") the
 *     reference-standard contribution is W_cal/2 = the Section-6 expanded
 *     uncertainty ÷ its k. Resolution per §7.1 ("included again … as in 6.1") +
 *     Annex A eq. (19) + Annex B w_res: the indicator resolution enters TWICE
 *     (reading at zero AND at applied force), each a rectangular r/(2√3) added in
 *     quadrature — equivalent to one triangular distribution r/√6. Drift w_drift
 *     (§7.1, rectangular) + temperature w_TCS eq. (29) are lab-magnitude inputs.
 *     https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-004_Calibration_Guideline_No._4_web.pdf
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" (read): §5.3 — a flat k=2 needs ≥10 repeated observations; the
 *     3 readings here fail that, so §5.4/§5.5 → Appendix E. App. E eq. (E.1)
 *     Welch–Satterthwaite ν_eff with Type A ν=n−1 and Type B ν=∞, then Table E.1
 *     (Student-t at 95,45%): ν=2→k=4,53; ν=3→3,31; ν=4→2,87; ν=∞→2,00.
 *     https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *
 * Conformance + scope (verified against the read cg-04 v3.0 + EA-4/02 text):
 *   - MODELLED (the core cg-04 §7.1 / ISO 376 terms): repeatability of the
 *     indication (Type A, s/√n), resolution counted twice as one triangular
 *     contribution (r/√6, eq. 19), the reference-standard calibration uncertainty
 *     (W_cal/2 with the cert's own k), plus lab-magnitude drift and temperature
 *     terms (default 0). Combined by RSS (eq. 26); U = k·u_c with k DERIVED from
 *     ν_eff (Welch–Satterthwaite) + Student-t at 95,45% — NOT a flat k=2.
 *   - SITUATIONAL (see governance.omittedComponents, each with a cited
 *     `appliesWhen`): reversibility/hysteresis (eq. 27), end-loading, parasitic/
 *     reproducibility (rotation), time-loading profile, interpolation/linear-
 *     approximation, replacement indicator, dynamic force, EMC. These are added
 *     by the lab only when the cited situation applies; the certificate text
 *     points the reader to that list rather than hiding the scope.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived generically via buildDraftFromProduct (see product-to-draft.ts).
 */

const METHOD_NAME = "Calibração de Força por Erro de Indicação";
const FORCE_ASSET_TYPE_SLUG = "dinamometro";
const methodDescription =
  "Calibração de instrumentos de medição de força (dinamômetros/células de carga) por comparação direta contra uma força de referência. Erro de indicação E = leitura média − valor de referência; incerteza expandida combinando repetibilidade (Tipo A), resolução (contada duas vezes → triangular r/√6), a contribuição do padrão (W_cal/2 com o k do certificado), deriva de sensibilidade e temperatura, por soma quadrática (EURAMET cg-04 §7.1 eq. 26). Fator de abrangência k por Welch–Satterthwaite + t-Student a 95,45% (EA-4/02 Apêndice E). Rascunho pendente de revisão metrológica.";

// Each table row is one calibration point.
const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_forca" } as const;

// --- Product-format inputs -----------------------------------------------------
const forceColumns = [
  {
    // role:"standard_value": ao selecionar o padrão de referência registrado, o
    // ponto é casado por nominal a um certifiedValue do padrão e preenche
    // automaticamente o valor convencional, a incerteza expandida (U) e o k do
    // certificado nas colunas-alvo abaixo (editável; confira contra o certificado).
    key: "valor_referencia",
    label: "Força de referência (valor convencional)",
    type: "number",
    unit: "N",
    quantityKind: "reference",
    role: "standard_value",
    standardValue: {
      matchBy: "nominal",
      targetColumns: {
        value: "valor_referencia",
        expandedUncertainty: "incerteza_referencia",
        coverageFactor: "k_referencia",
      },
    },
  },
  {
    // A incerteza EXPANDIDA U da força de referência: preenchida automaticamente a
    // partir do padrão de referência selecionado (editável) e reduzida a
    // incerteza-padrão abaixo dividindo pelo k do próprio certificado (coluna
    // k_referencia).
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
  },
  {
    // cg-04 §7.1 ("Calibration uncertainty" = W_cal/2): o fator de abrangência do
    // CERTIFICADO do padrão. Preenchido automaticamente a partir do padrão de
    // referência selecionado (editável); confira contra o certificado.
    key: "k_referencia",
    label: "Fator k do certificado do padrão",
    type: "number",
    quantityKind: "other",
  },
  {
    key: "resolucao",
    label: "Resolução do instrumento",
    type: "number",
    unit: "N",
    quantityKind: "resolution",
  },
  {
    // [VERIFICAR] VALOR: incerteza-padrão da deriva de sensibilidade desde a
    // calibração (cg-04 §7.1 w_drift). Retangular: ± a maior variação entre
    // calibrações adjacentes, dividida por √3. Padrão 0 quando não houver
    // histórico — informe o valor do seu instrumento.
    key: "u_deriva",
    label: "Incerteza de deriva de sensibilidade (u_drift)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
  },
  {
    // [VERIFICAR] VALOR: incerteza-padrão do efeito de temperatura na
    // sensibilidade TCS (cg-04 §7.1 eq. 29). Retangular: (TCS/(10·100%))·ΔT·F·1/√3.
    // Padrão 0 quando o uso for na temperatura de calibração — informe o valor.
    key: "u_temperatura",
    label: "Incerteza por efeito de temperatura (u_TCS)",
    type: "number",
    unit: "N",
    quantityKind: "uncertainty",
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
// Expressions use only +, -, *, / , ^, sqrt + the math-engine SAFE_FUNCTIONS
// `if_zero` and `student_t_inverse_2t` (both allow-listed; see weighing-instrument).
const formulas = [
  {
    outputKey: "media",
    label: "Indicação média",
    // cg-04 §6.1 / ISO 376: 3 leituras repetidas; média aritmética.
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // cg-04 §6 / ISO 376: E = indicação média − valor de referência.
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
    // EA-4/02 §3.1: desvio-padrão amostral, divisor (n−1)=2 para n=3 leituras.
    expression:
      "sqrt(((leitura_1 - media) ^ 2 + (leitura_2 - media) ^ 2 + (leitura_3 - media) ^ 2) / 2)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    // [VERIFICAR] cg-04 §6.1: incerteza-padrão da MÉDIA = s/√n (n=3). Se o
    // resultado se aplicar a uma leitura única em vez da média, usa-se s — ponto
    // de decisão para revisão.
    expression: "desvio_padrao / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    // cg-04 §7.1 + Annex A eq. (19) + Annex B (w_res): a resolução do indicador
    // entra DUAS vezes (leitura no zero E na carga), cada uma retangular r/(2√3),
    // somadas em quadratura → distribuição triangular r/√6. Se as leituras
    // flutuarem mais que a resolução, usa-se metade da faixa de flutuação.
    expression: "resolucao / sqrt(6)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    // cg-04 §7.1 ("Calibration uncertainty" = W_cal/2): reduz a incerteza
    // EXPANDIDA do certificado a incerteza-padrão dividindo pelo k do PRÓPRIO
    // certificado (coluna k_referencia, não fixo em 2).
    expression: "incerteza_referencia / k_referencia",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // cg-04 §7.1 eq. (26): soma quadrática (RSS) de (W_cal/2), resolução,
    // repetibilidade, deriva e temperatura. As contribuições situacionais
    // (reversibilidade, end-loading, etc.) entram quando se aplicarem — ver
    // "Componentes omitidos" na governança.
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2 + u_deriva ^ 2 + u_temperatura ^ 2)",
    scope: ROW_SCOPE,
    unit: "N",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "veff",
    label: "Graus de liberdade efetivos (Welch–Satterthwaite)",
    // EA-4/02 App. E eq. (E.1): ν_eff = u_c⁴ / Σ(uᵢ⁴/νᵢ). Só a repetibilidade
    // (Tipo A) tem ν finito (ν = n−1 = 2, pois são 3 leituras); os termos Tipo B
    // (resolução, padrão, deriva, temperatura) têm ν=∞ e somem do denominador.
    expression:
      "if_zero(u_repetibilidade, 1000000000, (u_combinada ^ 4) / ((u_repetibilidade ^ 4) / 2))",
    scope: ROW_SCOPE,
    reporting: { role: "auxiliary", group: "uncertainty_budget" },
  },
  {
    outputKey: "fator_k",
    label: "Fator de abrangência (k)",
    // EA-4/02 §5.3/§5.5 + App. E: k da distribuição t-Student bicaudal a 95,45%
    // (P=0,9545 → α=0,0455) com ν_eff — exigido porque o termo Tipo A se apoia em
    // <10 observações (3 leituras), então um k=2 fixo NÃO é permitido (§5.3).
    // Protege o caso ν=∞ → k=2 (Tabela E.1).
    expression:
      "if_zero(u_repetibilidade, 2, student_t_inverse_2t(0.0455, veff))",
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
    // cg-04 §7.1 eq. (26) (W = k·w_c): U = k·u_c, com k pelo Welch–Satterthwaite /
    // t-Student acima (≈2 quando os termos Tipo B predominam; >2, p.ex. ≈4,53 em
    // ν_eff=2, quando a repetibilidade predomina).
    expression: "fator_k * u_combinada",
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
// No literal "[VERIFICAR]" is rendered in certificate text: a certificate must
// not announce its own incompleteness. The lab-fill procedure code defaults to an
// em-dash placeholder (the [VERIFICAR] lives only in governance.verificarItems),
// and the scope note points the reader to the explicit "Componentes omitidos"
// list rather than hiding it. The k=… text is DERIVED from the computed fator_k.
const certificateContent = {
  procedureCode: "—",
  referenceStandards: ["EURAMET cg-04 v3.0", "EA-4/02 M:2022"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por comparação direta entre a força de referência aplicada e a indicação do instrumento. O erro de indicação é E = indicação média − valor de referência (EURAMET cg-04 §6 / ISO 376).",
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
        {
          term: "U",
          definition:
            "Incerteza expandida (U = k·u_c), com k informado junto ao resultado.",
        },
        {
          term: "k",
          definition:
            "Fator de abrangência por t-Student a ≈95,45% (Welch–Satterthwaite); varia com os graus de liberdade efetivos.",
        },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada foi determinada conforme a EURAMET cg-04 §7.1 (eq. 26) e a EA-4/02, combinando por soma quadrática as contribuições de repetibilidade (Tipo A), resolução (contada no zero e na carga), padrão de referência, deriva de sensibilidade e efeito de temperatura.",
        "A incerteza expandida é U = k·u_c, com o fator de abrangência k determinado a partir dos graus de liberdade efetivos (Welch–Satterthwaite) e da distribuição t-Student para uma probabilidade de abrangência de aproximadamente 95,45% (EA-4/02 Apêndice E). Como o ensaio usa 3 leituras (menos de 10 observações), um k = 2 fixo não é aplicável (EA-4/02 §5.3): k tende a 2 quando os termos Tipo B predominam e aumenta quando a repetibilidade predomina.",
        "Contribuições situacionais da EURAMET cg-04 §7.1 (reversibilidade/histerese, carregamento de extremidade, componentes parasitas/reprodutibilidade, perfil tempo-carga, aproximações à equação de interpolação, indicador substituto, força dinâmica e efeitos eletromagnéticos) são incluídas pelo laboratório quando aplicáveis — ver a lista “Componentes omitidos” do método, que indica onde e quando cada uma se aplica.",
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
// within the preview's 1e-9 relative tolerance. They lock the formula arithmetic
// AND the coverage change (Welch–Satterthwaite + Student-t); the metrology MODEL
// still requires [VERIFICAR] review of the lab-supplied magnitudes.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_1kN",
    label: "Ponto de 1 kN, U_padrão 0,5 N (k=2), resolução 0,1 N",
    inputs: {
      pontos_forca: [
        {
          valor_referencia: 1000,
          incerteza_referencia: 0.5,
          k_referencia: 2,
          resolucao: 0.1,
          u_deriva: 0,
          u_temperatura: 0,
          leitura_1: 1000.2,
          leitura_2: 1000.1,
          leitura_3: 1000.3,
        },
      ],
    },
    expected: {
      // Row-scoped formulas yield one value per row. Pinned from the engine
      // (decimal mode), within 1e-9. The coverage factor now COMES FROM
      // Welch–Satterthwaite + Student-t (no longer a flat k=2). In THIS point the
      // reference term (0.25 N) dominates u_c, so the Type A weight is small and
      // ν_eff is high (≈820) → k ≈ 2.003; at a point where repeatability dominates
      // (ν_eff→2), k would rise toward 4,53 (Tabela E.1). A second scenario with a
      // smaller reference uncertainty would show that swing.
      formulas: {
        erro: [0.2],
        u_repetibilidade: [0.05773502691896258],
        u_resolucao: [0.04082482904638631],
        u_referencia: [0.25],
        u_combinada: [0.2598076211353316],
        veff: [820.1249999999999],
        fator_k: [2.0030557938668547],
        u_expandida: [0.5204091608058906],
      },
    },
  },
  {
    // Same point, but with a SMALL reference uncertainty (0,01 N) so the Type A
    // repeatability now DOMINATES u_c → ν_eff falls to its floor of 2 and the
    // Student-t factor jumps to ≈4,53 (Tabela E.1, ν=2). This is the headline
    // correction made visible: a flat k=2 would understate U by ~2,3×.
    key: "ponto_1kN_repeti_domina",
    label: "Ponto de 1 kN com U_padrão 0,01 N — repetibilidade domina",
    inputs: {
      pontos_forca: [
        {
          valor_referencia: 1000,
          incerteza_referencia: 0.01,
          k_referencia: 2,
          resolucao: 0.001,
          u_deriva: 0,
          u_temperatura: 0,
          leitura_1: 1000.2,
          leitura_2: 1000.1,
          leitura_3: 1000.3,
        },
      ],
    },
    expected: {
      formulas: {
        erro: [0.2],
        u_repetibilidade: [0.05773502691896258],
        u_resolucao: [0.0004082482904638631],
        u_referencia: [0.005],
        u_combinada: [0.05795256681114306],
        veff: [2.030314005],
        fator_k: [4.526550760081983],
        u_expandida: [0.26232523534768154],
      },
    },
  },
];

// --- Metrology governance ------------------------------------------------------
// Structured transcription of the header docblock — FAITHFUL ONLY, no invented
// metrology. See the docblock at the top of this file for the prose source.
const governance: MetrologyGovernance = {
  summary:
    "Calibração de força por erro de indicação (dinamômetro / célula de carga) por comparação direta contra uma força de referência. RASCUNHO pendente de revisão metrológica: modela repetibilidade, resolução (no zero e na carga), padrão de referência, deriva e temperatura; demais contribuições da cg-04 §7.1 são situacionais (ver Componentes omitidos).",
  measurand: "E = leitura média − força de referência",
  model: "formulas",
  sources: [
    {
      title: "EURAMET cg-04",
      edition: "v3.0 (02/2022)",
      section: "§7.1 eq. (26) + Anexo A eq. (19) + Anexo B",
      url: "https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-004_Calibration_Guideline_No._4_web.pdf",
    },
    {
      title: "EA-4/02",
      edition: "M:2022",
      section: "§5.3/§5.5 + Apêndice E (eq. E.1 + Tabela E.1)",
      url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
    },
  ],
  conformanceNotes: [
    {
      ref: "cg-04 v3.0 §7.1 eq. (26)",
      note: "As contribuições são somadas por quadratura (RSS) e a incerteza expandida é W = k·w_c. Este template soma repetibilidade, resolução, padrão de referência, deriva de sensibilidade e temperatura nessa forma; o k é calculado, não fixado em 2.",
    },
    {
      ref: 'cg-04 v3.0 §7.1 ("Calibration uncertainty")',
      note: "A contribuição do padrão de referência é W_cal/2 — metade da incerteza expandida da Seção 6, ou seja, a incerteza expandida do certificado dividida pelo fator k DESSE certificado. Por isso u_referencia = incerteza_referencia / k_referencia (o k é informado, não presumido).",
    },
    {
      ref: "cg-04 v3.0 §7.1 + Anexo A eq. (19) + Anexo B (w_res)",
      note: "A resolução do indicador é contada DUAS vezes (leitura no zero E na carga), cada parcela retangular r/(2√3), por quadratura — o que equivale a uma distribuição triangular r/√6. Por isso u_resolucao = resolucao/√6 (não resolucao/√12).",
    },
    {
      ref: "EA-4/02 M:2022 §5.3 + Apêndice E",
      note: "Um k = 2 fixo exige que nenhum termo Tipo A venha de menos de dez observações. Como o ensaio usa 3 leituras (ν = n−1 = 2), o k é obtido por ν_eff de Welch–Satterthwaite (eq. E.1) e t-Student a 95,45% (Tabela E.1); termos Tipo B têm ν=∞.",
    },
    {
      ref: "cg-04 v3.0 §6 / ISO 376",
      note: "O modelo de erro de indicação E = indicação média − valor de referência segue a calibração de instrumentos de medição de força (ISO 376) descrita na Seção 6.",
    },
  ],
  verificarItems: [
    {
      ref: "cg-04 v3.0 §7.1 (w_drift)",
      item: "VALOR a informar: incerteza-padrão da deriva de sensibilidade (u_deriva). Retangular, ± a maior variação entre calibrações adjacentes dividida por √3. Use 0 só se não houver histórico de deriva; do contrário informe o valor do seu instrumento.",
      severity: "action",
      fieldKeys: ["u_deriva"],
    },
    {
      ref: "cg-04 v3.0 §7.1 eq. (29) (w_TCS)",
      item: "VALOR a informar: incerteza-padrão por efeito de temperatura na sensibilidade (u_temperatura), eq. 29, retangular. Use 0 quando o uso for na temperatura de calibração; fora dela, informe o valor pelo coeficiente TCS do seu sensor.",
      severity: "action",
      fieldKeys: ["u_temperatura"],
    },
    {
      ref: 'cg-04 v3.0 §7.1 ("Calibration uncertainty" = W_cal/2)',
      item: "O valor convencional, a incerteza expandida U e o fator k do padrão de referência são preenchidos automaticamente a partir do padrão de referência selecionado (editável); confira-os contra o certificado do padrão antes de emitir.",
      severity: "action",
      fieldKeys: ["k_referencia", "incerteza_referencia"],
    },
    {
      ref: "cg-04 v3.0 §6.1 / ISO 376",
      item: "Repetibilidade (Tipo A) usa a incerteza-padrão da MÉDIA = s/√n (n=3). Se o resultado se aplicar a uma leitura única em vez da média, usa-se s diretamente — ponto de decisão para revisão.",
      severity: "info",
      fieldKeys: ["u_repetibilidade", "desvio_padrao"],
    },
    {
      ref: "cg-04 v3.0 §7.1 (contribuições situacionais)",
      item: "As contribuições situacionais da cg-04 §7.1 (reversibilidade, carregamento de extremidade, parasitas/reprodutibilidade, perfil tempo-carga, aproximações à interpolação, indicador substituto, força dinâmica, eletromagnéticas) NÃO estão no modelo; some-as quando o uso se enquadrar no caso indicado em Componentes omitidos.",
      severity: "action",
      fieldKeys: ["u_combinada"],
    },
  ],
  omittedComponents: [
    {
      ref: "cg-04 v3.0 §7.1 eq. (27)",
      component:
        "Reversibilidade / histerese — w_rev = v/(100%·√3) (retangular), v = erro de reversibilidade relativo (ISO 376)",
      appliesWhen:
        "uso em medições de força decrescente, sem correção pelos dados de calibração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (carregamento de extremidade)",
      component:
        "Condições de carregamento de extremidade (end-loading) — ensaio do bearing pad da ISO 376",
      appliesWhen:
        "uso em compressão fora das condições do ensaio de carregamento da ISO 376, ou uso em tração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (parasitas / reprodutibilidade)",
      component:
        "Componentes parasitas / reprodutibilidade (rotação/reposicionamento) — a reprodutibilidade só vale para a média de 3 corridas na máquina de calibração",
      appliesWhen:
        "uso sujeito a forças parasitas maiores que as da calibração; some o componente girando o instrumento no eixo entre corridas",
    },
    {
      ref: "cg-04 v3.0 §7.1 (perfil tempo-carga)",
      component:
        "Perfil tempo-carga — diferença entre a espera de 30 s da ISO 376 e o uso subsequente (p.ex. ISO 7500-1)",
      appliesWhen:
        "instrumento sensível ao tempo de carga; some quando creep/deriva não cobrirem o efeito",
    },
    {
      ref: "cg-04 v3.0 §7.1 (aproximações à equação)",
      component:
        "Aproximações lineares à equação de interpolação / equação de calibração",
      appliesWhen:
        "uso de interpolação linear entre pontos no indicador em vez da equação de calibração do certificado",
    },
    {
      ref: "cg-04 v3.0 §7.1 (indicador substituto)",
      component:
        "Efeito de indicador substituto — desvio entre o indicador da calibração e o de uso",
      appliesWhen:
        "transdutor usado com indicador diferente daquele da calibração",
    },
    {
      ref: "cg-04 v3.0 §7.1 (força dinâmica)",
      component:
        "Natureza dinâmica da força medida — exige análise de medição dinâmica (não detalhada na cg-04)",
      appliesWhen: "uso sob condições dinâmicas (resposta em frequência)",
    },
    {
      ref: "cg-04 v3.0 §7.1 (efeitos eletromagnéticos)",
      component:
        "Efeitos eletromagnéticos (EMC) — podem afetar significativamente a medição",
      appliesWhen:
        "uso em ambiente sujeito a interferência eletromagnética relevante",
    },
  ],
  workedExample: {
    scenarioKey: "ponto_1kN",
    provenance: "engine_characterization",
    source: "Motor (modo decimal)",
    expected: {
      erro: 0.2,
      u_combinada: 0.2598076211353316,
      fator_k: 2.0030557938668547,
      u_expandida: 0.5204091608058906,
    },
  },
  reviewStatus: "draft_pending_revalidation",
};

export const forceIndicationTemplate: TemplateModule = {
  key: "force-indication",
  templateVersion: 3,
  discipline: "force",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-04 v3.0", "EA-4/02 M:2022"],
  buildDraft,
  productDefinition: forceProductDefinition,
  previewScenarios,
  governance,
};
