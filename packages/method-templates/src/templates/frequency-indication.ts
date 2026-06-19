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
 * Rotational-speed (RPM) indication-error calibration of a tachometer by
 * comparison against a reference rotation rate.
 *
 * ⚠️ DRAFT — pending metrologist review. No uncertainty MAGNITUDE is invented:
 * every STRUCTURAL decision (divisor / distribution / coverage) is taken from
 * the cited guide, which was READ IN FULL from its PDF (not merely cited).
 * Lab-specific magnitudes (reference k, reference drift/aging, reference-readout
 * resolution) stay as lab-filled inputs marked [VERIFICAR] on the VALUE only.
 *
 * HONEST SCOPE NOTE (kept on purpose): there is NO dedicated EURAMET discipline
 * guide for frequency / rotational-speed indication. EA-4/02 is the only source,
 * and it is GENERIC — its §1.1 states the method "may have to be supplemented by
 * more specific advice for different fields". So discipline-specific structure
 * (optical vs. contact pickup, stroboscope/gate-time quantization, time-base
 * traceability beyond what the reference certificate already carries) MUST be
 * supplied/confirmed by the metrologist; those terms stay in omittedComponents.
 * Source:
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" (read): §3.2.2 (Type A of the mean s/√n + Warning n<10),
 *     §3.3.2(a) (single/certificate value: adopt the standard uncertainty AS
 *     GIVEN by the cert — read the cert's own k), §3.3.2(c) eq. (3.8)
 *     rectangular a/√3, §5.1 (U = k·u_c; flat k=2 needs a normal distribution
 *     AND sufficient reliability), §5.3 (the reliability criterion is satisfied
 *     only if NO Type A contribution comes from fewer than ten observations — the
 *     3 readings here FAIL that), §5.5 (→ use Appendix E), Appendix E eq. (E.1)
 *     Welch–Satterthwaite ν_eff with Type A ν=n−1 and Type B ν=∞, then Table E.1
 *     (Student-t at 95,45%): ν=2→k=4,53; ν=3→3,31; ν=4→2,87; ν=∞→2,00.
 *     https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *
 * Conformance + scope (verified against the read EA-4/02 text):
 *   - MODELLED: repeatability of the indication (Type A, s/√n, §3.2.2),
 *     instrument resolution (rectangular r/2 ÷ √3, eq. 3.8), the reference-
 *     standard calibration uncertainty (U_ref ÷ the cert's own k, §3.3.2(a)),
 *     plus lab-magnitude reference drift/aging and reference-readout resolution
 *     (default 0, §3.3.2(c)/§3.3.2(a)). Combined by RSS (§4.1 eq. 4.1); U = k·u_c
 *     with k DERIVED from ν_eff (Welch–Satterthwaite, App. E) + Student-t at
 *     95,45% — NOT a flat k=2 (forbidden by §5.3 with only 3 readings).
 *   - SITUATIONAL / DISCIPLINE-SPECIFIC (see governance.omittedComponents, each
 *     with a clear `appliesWhen`): reproducibility across mounting/angle,
 *     time-base / gate-time quantization, stroboscope quantization (optical vs.
 *     contact pickup). EA-4/02 is generic (§1.1) and does not model these for
 *     rotation; the lab adds them when the cited situation applies, and the
 *     certificate text points the reader to that list rather than hiding scope.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived generically via buildDraftFromProduct (see product-to-draft.ts).
 */

const METHOD_NAME = "Calibração de Tacômetro por Erro de Indicação";
const TACHOMETER_ASSET_TYPE_SLUG = "tacometro";
const methodDescription =
  "Calibração de tacômetros por comparação direta da rotação indicada contra uma referência (rpm). Erro de indicação E = leitura média − valor de referência; incerteza expandida combinando repetibilidade (Tipo A), resolução do instrumento, a contribuição do padrão (U do certificado ÷ o k do próprio certificado), deriva/envelhecimento do padrão e resolução de leitura do padrão, por soma quadrática (EA-4/02 §4.1). Fator de abrangência k por Welch–Satterthwaite + t-Student a 95,45% (EA-4/02 Apêndice E). Não há guia de disciplina dedicado para frequência/rotação — apenas a EA-4/02 genérica (§1.1). Rascunho pendente de revisão metrológica.";

// Each table row is one calibration point.
const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_rotacao" } as const;

// --- Product-format inputs -----------------------------------------------------
const tachometerColumns = [
  {
    // role:"standard_value": ao selecionar o padrão de referência registrado, o
    // ponto é casado por nominal a um certifiedValue do padrão e preenche
    // automaticamente o valor convencional, a incerteza expandida (U), o k do
    // certificado e a deriva/envelhecimento do padrão nas colunas-alvo abaixo
    // (editável; confira contra o certificado). EA-4/02 §3.3.2(a)/(c).
    key: "valor_referencia",
    label: "Rotação de referência (valor convencional)",
    type: "number",
    unit: "rpm",
    quantityKind: "reference",
    role: "standard_value",
    standardValue: {
      matchBy: "nominal",
      targetColumns: {
        value: "valor_referencia",
        expandedUncertainty: "incerteza_referencia",
        coverageFactor: "k_referencia",
        drift: "u_deriva_padrao",
      },
    },
  },
  {
    // A incerteza EXPANDIDA U da rotação de referência: preenchida automaticamente
    // a partir do padrão de referência selecionado (editável) e reduzida a
    // incerteza-padrão abaixo dividindo pelo k do próprio certificado (coluna
    // k_referencia). EA-4/02 §3.3.2(a).
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "rpm",
    quantityKind: "uncertainty",
  },
  {
    // EA-4/02 §3.3.2(a): o fator de abrangência do CERTIFICADO do padrão.
    // Preenchido automaticamente a partir do padrão de referência selecionado
    // (editável); confira contra o certificado.
    key: "k_referencia",
    label: "Fator k do certificado do padrão",
    type: "number",
    quantityKind: "other",
  },
  {
    key: "resolucao",
    label: "Resolução do instrumento",
    type: "number",
    unit: "rpm",
    quantityKind: "resolution",
  },
  {
    // Incerteza-padrão da deriva/envelhecimento do padrão de referência desde a
    // sua calibração (EA-4/02 §3.3.2(c), retangular: ± a variação máxima dividida
    // por √3). Preenchida automaticamente a partir do padrão de referência
    // selecionado quando o certificado declara deriva (editável); 0 na falta de
    // histórico — confira contra o certificado.
    key: "u_deriva_padrao",
    label: "Incerteza de deriva/envelhecimento do padrão",
    type: "number",
    unit: "rpm",
    quantityKind: "uncertainty",
  },
  {
    // [VERIFICAR] VALOR: incerteza-padrão da resolução de LEITURA do padrão de
    // referência, quando a referência é LIDA (estroboscópio/contador) em vez de
    // ser um valor convencional certificado (EA-4/02 §3.3.2(c)/§3.3.2(a),
    // retangular). Padrão 0 quando a referência for um set-point certificado —
    // informe o valor da casa decimal do seu padrão.
    key: "u_resolucao_referencia",
    label: "Incerteza de resolução de leitura do padrão",
    type: "number",
    unit: "rpm",
    quantityKind: "uncertainty",
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

// --- Product-format formulas (per calibration point) ---------------------------
// Expressions use only +, -, *, / , ^, sqrt + the math-engine SAFE_FUNCTIONS
// `if_zero` and `student_t_inverse_2t` (both allow-listed; see weighing-instrument).
const formulas = [
  {
    outputKey: "media",
    label: "Indicação média",
    // EA-4/02 §3.2.2 eq. (3.1): 3 leituras repetidas; média aritmética.
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // Convenção de sinal E = indicação média − valor de referência.
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
    // EA-4/02 §3.2.2 eq. (3.2): desvio-padrão amostral, divisor (n−1)=2 para n=3
    // leituras. n=3 fixado para corresponder às 3 colunas de leitura.
    expression:
      "sqrt(((leitura_1 - media) ^ 2 + (leitura_2 - media) ^ 2 + (leitura_3 - media) ^ 2) / 2)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    // [VERIFICAR] EA-4/02 §3.2.2 eq. (3.3)/(3.4): incerteza-padrão da MÉDIA =
    // s/√n (n=3). Se o resultado se aplicar a uma leitura única em vez da média,
    // usa-se s diretamente — ponto de decisão para revisão.
    expression: "desvio_padrao / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    // EA-4/02 §3.3.2(c) eq. (3.8): distribuição retangular, semi-largura =
    // resolução/2, divisor √3. Equivale a resolução/√12.
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    // EA-4/02 §3.3.2(a): reduz a incerteza EXPANDIDA do certificado a
    // incerteza-padrão dividindo pelo k do PRÓPRIO certificado (coluna
    // k_referencia, não fixo em 2).
    expression: "incerteza_referencia / k_referencia",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // EA-4/02 §4.1 eq. (4.1): soma quadrática (RSS) de repetibilidade, resolução,
    // padrão de referência, deriva/envelhecimento do padrão e resolução de leitura
    // do padrão. As contribuições situacionais/de disciplina (reprodutibilidade,
    // base de tempo, quantização de estroboscópio) entram quando se aplicarem —
    // ver "Componentes omitidos" na governança.
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2 + u_deriva_padrao ^ 2 + u_resolucao_referencia ^ 2)",
    scope: ROW_SCOPE,
    unit: "rpm",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "veff",
    label: "Graus de liberdade efetivos (Welch–Satterthwaite)",
    // EA-4/02 App. E eq. (E.1): ν_eff = u_c⁴ / Σ(uᵢ⁴/νᵢ). Só a repetibilidade
    // (Tipo A) tem ν finito (ν = n−1 = 2, pois são 3 leituras); os termos Tipo B
    // (resolução, padrão, deriva, resolução de leitura) têm ν=∞ e somem do
    // denominador.
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
    // EA-4/02 §5.1 eq. (5.1): U = k·u_c, com k pelo Welch–Satterthwaite /
    // t-Student acima (≈2 quando os termos Tipo B predominam; >2, p.ex. ≈4,53 em
    // ν_eff=2, quando a repetibilidade predomina).
    expression: "fator_k * u_combinada",
    scope: ROW_SCOPE,
    unit: "rpm",
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
  referenceStandards: ["EA-4/02 M:2022"],
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
        {
          term: "VC",
          definition: "Valor convencional da rotação de referência.",
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
        "A incerteza-padrão combinada foi determinada conforme a EA-4/02 (§4.1), combinando por soma quadrática as contribuições de repetibilidade (Tipo A), resolução do instrumento, padrão de referência, deriva/envelhecimento do padrão e resolução de leitura do padrão.",
        "A incerteza expandida é U = k·u_c, com o fator de abrangência k determinado a partir dos graus de liberdade efetivos (Welch–Satterthwaite) e da distribuição t-Student para uma probabilidade de abrangência de aproximadamente 95,45% (EA-4/02 Apêndice E). Como o ensaio usa 3 leituras (menos de 10 observações), um k = 2 fixo não é aplicável (EA-4/02 §5.3): k tende a 2 quando os termos Tipo B predominam e aumenta quando a repetibilidade predomina.",
        "Rastreabilidade: a rotação de referência é rastreável ao SI (segundo / hertz) pela cadeia de calibração do padrão de referência declarada no seu certificado; este método não adiciona padrão de tempo/frequência próprio. Não há guia de disciplina dedicado para rotação/frequência — aplica-se a EA-4/02 genérica, que pode precisar de complemento específico do campo (§1.1).",
        "Contribuições de disciplina não modeladas (reprodutibilidade entre montagem/ângulo, base de tempo/gate-time, quantização de estroboscópio para captação óptica vs. contato) são incluídas pelo laboratório quando aplicáveis — ver a lista “Componentes omitidos” do método, que indica onde e quando cada uma se aplica.",
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

// --- Preview scenarios ---------------------------------------------------------
// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. They lock the formula arithmetic
// AND the coverage change (Welch–Satterthwaite + Student-t); the metrology MODEL
// still requires [VERIFICAR] review of the lab-supplied magnitudes.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_1500rpm",
    label: "Ponto de 1500 rpm, U_padrão 1,0 rpm (k=2), resolução 1 rpm",
    inputs: {
      pontos_rotacao: [
        {
          valor_referencia: 1500,
          incerteza_referencia: 1.0,
          k_referencia: 2,
          resolucao: 1,
          u_deriva_padrao: 0,
          u_resolucao_referencia: 0,
          leitura_1: 1502,
          leitura_2: 1501,
          leitura_3: 1503,
        },
      ],
    },
    expected: {
      // Row-scoped formulas yield one value per row. Pinned from the engine
      // (decimal mode), within 1e-9. The coverage factor now COMES FROM
      // Welch–Satterthwaite + Student-t (no longer a flat k=2). In THIS point the
      // Type A repeatability (0,577) and the Type B terms are comparable, so
      // ν_eff ≈ 8 → k ≈ 2,43 (Tabela E.1, ν=8). A flat k=2 would understate U.
      formulas: {
        erro: [2],
        u_repetibilidade: [0.5773502691896258],
        u_resolucao: [0.2886751345948129],
        u_referencia: [0.5],
        u_combinada: [0.816496580927726],
        veff: [7.999999999999996],
        fator_k: [2.4288090822342374],
        u_expandida: [1.983114311370463],
      },
    },
  },
  {
    // Same point, but with a SMALL reference uncertainty and resolution so the
    // Type A repeatability now DOMINATES u_c → ν_eff falls to its floor of 2 and
    // the Student-t factor jumps to ≈4,53 (Tabela E.1, ν=2). This is the headline
    // correction made visible: a flat k=2 would understate U by ~2,3×.
    key: "ponto_1500rpm_repeti_domina",
    label: "Ponto de 1500 rpm com U_padrão 0,02 rpm — repetibilidade domina",
    inputs: {
      pontos_rotacao: [
        {
          valor_referencia: 1500,
          incerteza_referencia: 0.02,
          k_referencia: 2,
          resolucao: 0.02,
          u_deriva_padrao: 0,
          u_resolucao_referencia: 0,
          leitura_1: 1502,
          leitura_2: 1501,
          leitura_3: 1503,
        },
      ],
    },
    expected: {
      formulas: {
        erro: [2],
        u_repetibilidade: [0.5773502691896258],
        u_resolucao: [0.005773502691896258],
        u_referencia: [0.01],
        u_combinada: [0.5774657276987671],
        veff: [2.001600319999999],
        fator_k: [4.526550760081983],
        u_expandida: [2.6139279286361496],
      },
    },
  },
];

// --- Metrology governance ------------------------------------------------------
// Structured transcription of the header docblock — FAITHFUL ONLY, no invented
// metrology. See the docblock at the top of this file for the prose source.
const governance = {
  summary:
    "Calibração de tacômetro por erro de indicação (rpm) por comparação direta contra uma rotação de referência. RASCUNHO pendente de revisão metrológica: modela repetibilidade, resolução, padrão de referência, deriva/envelhecimento do padrão e resolução de leitura do padrão; contribuições de disciplina (reprodutibilidade, base de tempo, quantização de estroboscópio) são situacionais (ver Componentes omitidos). Não há guia de disciplina dedicado — apenas a EA-4/02 genérica (§1.1).",
  measurand: "E = leitura média − valor de referência (rpm)",
  model: "formulas",
  sources: [
    {
      title: "EA-4/02",
      edition: "M:2022",
      section:
        "§3.2.2 + §3.3.2 eq. (3.8) + §4.1 + §5.1/§5.3/§5.5 + Apêndice E (eq. E.1 + Tabela E.1) + §1.1",
      url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
    },
  ],
  conformanceNotes: [
    {
      ref: "EA-4/02 M:2022 §4.1 eq. (4.1)",
      note: "As contribuições são somadas por quadratura (RSS) e a incerteza expandida é U = k·u_c (§5.1). Este template soma repetibilidade, resolução, padrão de referência, deriva/envelhecimento do padrão e resolução de leitura do padrão nessa forma; o k é calculado, não fixado em 2.",
    },
    {
      ref: "EA-4/02 M:2022 §3.3.2(a)",
      note: "A contribuição do padrão de referência adota a incerteza-padrão COMO DADA pelo certificado: a incerteza expandida do certificado dividida pelo fator k DESSE certificado. Por isso u_referencia = incerteza_referencia / k_referencia (o k é informado, não presumido).",
    },
    {
      ref: "EA-4/02 M:2022 §3.3.2(c) eq. (3.8)",
      note: "A resolução do instrumento é tratada como distribuição retangular de semi-largura resolução/2, dividida por √3. Por isso u_resolucao = (resolucao/2)/√3.",
    },
    {
      ref: "EA-4/02 M:2022 §5.3 + Apêndice E",
      note: "Um k = 2 fixo exige que nenhum termo Tipo A venha de menos de dez observações. Como o ensaio usa 3 leituras (ν = n−1 = 2), o k é obtido por ν_eff de Welch–Satterthwaite (eq. E.1) e t-Student a 95,45% (Tabela E.1); termos Tipo B têm ν=∞.",
    },
    {
      ref: "EA-4/02 M:2022 §1.1 (rastreabilidade)",
      note: "A rotação de referência é rastreável ao SI (segundo / hertz) pela cadeia de calibração do padrão, declarada no certificado do padrão; este método não adiciona padrão de tempo/frequência próprio. Não há guia de disciplina dedicado para rotação/frequência: aplica-se a EA-4/02 genérica, que pode precisar de complemento específico do campo (§1.1).",
    },
  ],
  verificarItems: [
    {
      ref: "EA-4/02 M:2022 §3.3.2(a)",
      item: "O valor convencional, a incerteza expandida U e o fator k do padrão de referência são preenchidos automaticamente a partir do padrão de referência selecionado (editável); confira-os contra o certificado do padrão antes de emitir.",
      severity: "action",
      fieldKeys: ["k_referencia", "incerteza_referencia"],
    },
    {
      ref: "EA-4/02 M:2022 §3.3.2(c)",
      item: "A incerteza-padrão da deriva/envelhecimento do padrão de referência (u_deriva_padrao), retangular ± a variação máxima dividida por √3, é preenchida automaticamente a partir do padrão de referência selecionado quando o certificado declara deriva (editável); 0 na falta de histórico — confira contra o certificado.",
      severity: "action",
      fieldKeys: ["u_deriva_padrao"],
    },
    {
      ref: "EA-4/02 M:2022 §3.3.2(c)/§3.3.2(a)",
      item: "VALOR a informar: incerteza-padrão da resolução de LEITURA do padrão (u_resolucao_referencia), quando a referência é LIDA (estroboscópio/contador) em vez de um valor convencional certificado. Use 0 quando a referência for um set-point certificado; do contrário informe a casa decimal do seu padrão.",
      severity: "action",
      fieldKeys: ["u_resolucao_referencia"],
    },
    {
      ref: "EA-4/02 M:2022 §3.2.2",
      item: "Repetibilidade (Tipo A) usa a incerteza-padrão da MÉDIA = s/√n (n=3). Se o resultado se aplicar a uma leitura única em vez da média, usa-se s diretamente — ponto de decisão para revisão.",
      severity: "info",
      fieldKeys: ["u_repetibilidade", "desvio_padrao"],
    },
    {
      ref: "EA-4/02 M:2022 §1.1 (sem guia de disciplina)",
      item: "Não há EURAMET cg específico para rotação/frequência — apenas a EA-4/02 genérica. O procedimento de calibração, o método de captação (óptico vs. contato) e a rastreabilidade ao SI (segundo/hertz) devem ser confirmados pelo metrologista; informe o código de procedimento real do laboratório.",
      severity: "action",
      fieldKeys: ["u_combinada"],
    },
    {
      ref: "EA-4/02 M:2022 §1.1 (contribuições de disciplina)",
      item: "As contribuições de disciplina (reprodutibilidade entre montagem/ângulo, base de tempo/gate-time, quantização de estroboscópio) NÃO estão no modelo; some-as quando o uso se enquadrar no caso indicado em Componentes omitidos.",
      severity: "action",
      fieldKeys: ["u_combinada"],
    },
  ],
  omittedComponents: [
    {
      ref: "EA-4/02 M:2022 §1.1",
      component:
        "Reprodutibilidade entre montagem/ângulo de captação — variação ao reposicionar o sensor no eixo entre corridas",
      appliesWhen:
        "uso sujeito a montagem/ângulo de leitura diferentes dos da calibração; some o componente repetindo corridas em posições distintas",
    },
    {
      ref: "EA-4/02 M:2022 §1.1",
      component:
        "Base de tempo / gate-time — janela de contagem do contador de frequência do padrão ou do instrumento",
      appliesWhen:
        "leitura por contagem de pulsos com janela de tempo curta, em que a quantização da base de tempo é relevante face à resolução",
    },
    {
      ref: "EA-4/02 M:2022 §1.1",
      component:
        "Quantização de estroboscópio — passo de varredura de frequência na captação óptica por estroboscópio",
      appliesWhen:
        "captação óptica por estroboscópio (ao invés de pickup de contato); some o passo de varredura como retangular",
    },
  ],
  workedExample: {
    scenarioKey: "ponto_1500rpm",
    provenance: "engine_characterization",
    source: "Motor (modo decimal)",
    expected: {
      erro: 2,
      u_combinada: 0.816496580927726,
      fator_k: 2.4288090822342374,
      u_expandida: 1.983114311370463,
    },
  },
  reviewStatus: "draft_pending_revalidation",
} satisfies MetrologyGovernance;

export const frequencyIndicationTemplate: TemplateModule = {
  key: "frequency-indication",
  templateVersion: 3,
  discipline: "frequency",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EA-4/02 M:2022"],
  buildDraft,
  productDefinition: frequencyProductDefinition,
  previewScenarios,
  governance,
};
