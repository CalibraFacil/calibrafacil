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
 * DC voltage indication-error calibration of a digital multimeter (DMM) against
 * a reference DC source/calibrator.
 *
 * ⚠️ DRAFT — pending metrologist review. No uncertainty MAGNITUDE is invented:
 * every structural decision (divisor / distribution / coverage) is taken from
 * the cited guides, which were READ IN FULL from their PDFs (not merely cited).
 * Lab-specific magnitudes (reference U + its k) stay as lab-filled inputs marked
 * [VERIFICAR] on the VALUE only. Sources:
 *   - EURAMET cg-15 v2.0 (03/2011) "Guidelines on the Calibration of Digital
 *     Multimeters" (formerly EA-10/15) (read):
 *     - §5.1.4.1 is only the certificate COLUMN HEADINGS ("Applied Value",
 *       "Instrument Reading", "Error of Indication", "Measurement Uncertainty")
 *       — it does NOT state the measurement model; the model is EA-4/02 §S9.3.
 *     - §5.1.5.1 — the reported uncertainty must take into account the resolution
 *       and the short-term instability of the instrument, joined to the reference
 *       (calibration) uncertainty. Those are the three components modelled here.
 *     - §5.1.5.3 — the standard k=2 sentence (≈95%) for the general case.
 *     - §5.1.5.4 NOTE for low-resolution DMM — when the budget has a rectangular
 *       (resolution) component and a normal component, the 95% coverage factor
 *       varies from k=1.65 (rectangular dominates) to k=2 (normal dominates);
 *       "it is not possible to write a closed-form formula for k", so the Guide's
 *       RECOMMENDATION is that "a coverage factor of k = 2 is used overall in
 *       these cases" (with the modified ≥95% sentence). That is this template's
 *       DECIDED, cited treatment — NOT the Appendix-E / Welch–Satterthwaite path
 *       used by force/frequency/weighing.
 *     https://www.euramet.org/Media/docs/Publications/calguides/EURAMET_cg-15__v_2.0_Guidelines_Calibration_Digital_Multimeters.pdf
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" — Supplement 2 §S9 "Calibration of a hand-held digital
 *     multimeter at 100 V DC" (read):
 *     - §S9.3 eq. (S9.1): E_X = Vi_X − V_S + δVi_X − δV_S ⇒ the indication-error
 *       MODEL E = leitura − valor aplicado (this, not cg-15 §5.1.4.1).
 *     - §S9.6: the calibrator certificate states its OWN k (k=2 in the example);
 *       reduce its expanded U by THAT k ⇒ u_referencia = incerteza_referencia /
 *       k_referencia (not a hardcoded /2).
 *     - §S9.7: the resolution correction has limits of ½ LSD ⇒ rectangular
 *       (½·LSD)/√3 (this, not cg-15 §5.1.5.4).
 *     - §S9.8: the calibrator correction δV_S decomposes into (1) drift since last
 *       calibration, (2) combined offset/non-linearity/gain, (3) ambient-
 *       temperature deviations, (4) mains-voltage deviations, (5) input-loading;
 *       enumerated as situational omitted components (magnitudes are lab inputs).
 *     - §S9.11: when resolution dominates, the result is "essentially rectangular"
 *       so "the method of effective degrees of freedom described in Annex E … is
 *       not applicable" — the reason Welch is NOT applied here.
 *     - §S9.12: for its specific 100 V example, k=1,65 (rectangular) — acknowledged
 *       in the certificate text, not silently contradicted.
 *     https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *
 * Conformance + scope (verified against the read cg-15 v2.0 + EA-4/02 §S9 text):
 *   - MODELLED: repeatability/short-term instability (Type A, s/√n), resolution
 *     (rectangular ½-LSD/√3, EA-4/02 §S9.7), and the reference-standard calibration
 *     uncertainty (its expanded U ÷ the cert's own k, EA-4/02 §S9.6). Combined by
 *     RSS (EA-4/02); U = 2·u_c with a DECIDED flat k=2 per cg-15 §5.1.5.4 for a
 *     resolution-dominated low-resolution DMM (EA-4/02 §S9.11 forbids Annex E here).
 *   - SITUATIONAL (see governance.omittedComponents, each with a cited
 *     `appliesWhen`): the EA-4/02 §S9.8 calibrator δV_S terms (drift, offset/non-
 *     linearity/gain, ambient temperature, mains voltage, input-loading), thermal
 *     EMF (cg-15 §3.4.6.1), and AC/reactance (DC-only v1). These are added by the
 *     lab only when the cited situation applies.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived via the shared buildDraftFromProduct.
 */

const METHOD_NAME = "Calibração de Multímetro (Tensão DC) por Erro de Indicação";
const DMM_ASSET_TYPE_SLUG = "multimetro-digital";
const methodDescription =
  "Calibração de multímetros digitais em tensão contínua (DC) por comparação direta da indicação contra uma fonte/calibrador de referência. Erro de indicação E = leitura média − valor aplicado (EA-4/02 §S9.3, eq. S9.1); incerteza por soma quadrática de repetibilidade/instabilidade de curto prazo (Tipo A), resolução (retangular, ½·resolução/√3, EA-4/02 §S9.7) e do padrão (U expandida do certificado dividida pelo k do próprio certificado, EA-4/02 §S9.6). Para um DMM de baixa resolução o orçamento é dominado pela resolução (essencialmente retangular): o método dos graus de liberdade efetivos do Anexo E NÃO se aplica (EA-4/02 §S9.11) e adota-se o fator k=2 recomendado pela cg-15 §5.1.5.4. DC apenas; AC adiado. Rascunho pendente de revisão metrológica.";

// Each table row is one calibration point.
const ROW_SCOPE = { kind: "table_row", tableKey: "pontos_tensao" } as const;

const voltageColumns = [
  {
    key: "valor_referencia",
    label: "Tensão aplicada de referência (valor convencional)",
    type: "number",
    unit: "V",
    quantityKind: "reference",
  },
  {
    // EA-4/02 §S9.6: the reference (calibrator) calibration uncertainty.
    // [VERIFICAR] VALOR: enter the EXPANDED uncertainty U from the calibrator's
    // certificate; reduced to a standard uncertainty below by the cert's own k
    // (column k_referencia).
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "V",
    quantityKind: "uncertainty",
  },
  {
    // EA-4/02 §S9.6: the calibrator certificate states its OWN coverage factor
    // (k=2 in the §S9 example). Enter the k from your calibrator's certificate.
    key: "k_referencia",
    label: "Fator k do certificado do padrão",
    type: "number",
    quantityKind: "other",
  },
  {
    key: "resolucao",
    label: "Resolução do instrumento",
    type: "number",
    unit: "V",
    quantityKind: "resolution",
  },
  {
    key: "leitura_1",
    label: "Leitura 1",
    type: "number",
    unit: "V",
    quantityKind: "indication",
  },
  {
    key: "leitura_2",
    label: "Leitura 2",
    type: "number",
    unit: "V",
    quantityKind: "indication",
  },
  {
    key: "leitura_3",
    label: "Leitura 3",
    type: "number",
    unit: "V",
    quantityKind: "indication",
  },
];

const dataFields = [
  {
    key: "pontos_tensao",
    label: "Pontos de calibração de tensão DC",
    type: "table",
    required: true,
    columns: voltageColumns,
  },
];

// Expressions use only +, -, *, / , ^ and sqrt (math-engine SAFE_FUNCTIONS).
const formulas = [
  {
    outputKey: "media",
    label: "Indicação média",
    // 3 repeated readings; arithmetic mean. cg-15 §5.1.5.1 treats the short-term
    // instability of the reading as a contribution to the reported uncertainty.
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // EA-4/02 §S9.3 eq. (S9.1): E_X = Vi_X − V_S (+ corrections) ⇒ E = indicação
    // média − valor aplicado. (cg-15 §5.1.4.1 is only the column headings.)
    expression: "media - valor_referencia",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_padrao",
    label: "Desvio-padrão experimental",
    // EA-4/02 Type A: sample standard deviation, divisor (n−1)=2 for n=3 readings.
    // [VERIFICAR] n=3 hardcoded to match the 3 reading columns.
    expression:
      "sqrt(((leitura_1 - media) ^ 2 + (leitura_2 - media) ^ 2 + (leitura_3 - media) ^ 2) / 2)",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_repetibilidade",
    label: "Incerteza de repetibilidade (Tipo A)",
    // [VERIFICAR] standard uncertainty of the MEAN = s/√n (n=3). If the reported
    // result applies to a single reading, EA-4/02 would use s directly.
    expression: "desvio_padrao / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    // EA-4/02 §S9.7: the resolution correction has limits of ½ LSD ⇒ rectangular
    // half-width = resolução/2, divisor √3 ⇒ u = (resolução/2)/√3. (cg-15 §5.1.5.4
    // is the coverage-factor NOTE, not the resolution divisor.)
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    // EA-4/02 §S9.6: reduce the calibrator's EXPANDED certificate U to a standard
    // uncertainty by dividing by the k of THAT certificate (column k_referencia,
    // not hardcoded /2).
    expression: "incerteza_referencia / k_referencia",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // EA-4/02: RSS of the three cg-15 §5.1.5.1 contributions (repeatability,
    // resolution, reference). Situational EA-4/02 §S9.8 calibrator δV_S terms
    // (drift, offset/non-linearity/gain, temperature, mains, input-loading) and
    // thermal EMF (cg-15 §3.4.6.1) are added by the lab when they apply — see
    // "Componentes omitidos" in the governance block.
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2)",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_expandida",
    label: "Incerteza expandida (U)",
    // cg-15 §5.1.5.4 (DECIDED, not punted): for a low-resolution DMM the budget is
    // resolution-dominated (essentially rectangular), so the 95% coverage factor
    // lies between 1.65 (rectangular) and 2 (normal); the Guide explicitly states
    // "it is not possible to write a closed-form formula for k" and RECOMMENDS a
    // flat k=2 overall (≥95%). EA-4/02 §S9.11 confirms the Annex-E / Welch path is
    // "not applicable" to this essentially-rectangular result. Hence U = 2·u_c.
    expression: "2 * u_combinada",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
];

// No literal "[VERIFICAR]" is rendered in certificate text: a certificate must
// not announce its own incompleteness. The lab-fill procedure code defaults to an
// em-dash placeholder (the [VERIFICAR] lives only in governance.verificarItems),
// and the scope note points the reader to the explicit "Componentes omitidos"
// list rather than hiding it.
const certificateContent = {
  procedureCode: "—",
  referenceStandards: ["EURAMET cg-15 v2.0", "EA-4/02 M:2022"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por comparação direta entre a tensão DC aplicada de referência (fonte/calibrador) e a indicação do multímetro. O erro de indicação é E = leitura média − valor aplicado (EA-4/02 §S9.3, eq. S9.1).",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "VC", definition: "Valor convencional da tensão aplicada de referência." },
        { term: "E", definition: "Erro de indicação (indicação − VC)." },
        { term: "U", definition: "Incerteza expandida (U = k·u_c), com k = 2." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada foi determinada conforme a EA-4/02, por soma quadrática das contribuições de repetibilidade/instabilidade de curto prazo, resolução (componente retangular de meia-largura ½·resolução, EA-4/02 §S9.7) e do padrão de referência (EA-4/02 §S9.6); as três contribuições reportadas seguem a cg-15 §5.1.5.1.",
        "Para um multímetro de baixa resolução, o orçamento é dominado pela resolução e a distribuição resultante é essencialmente retangular. Nesse caso, o método dos graus de liberdade efetivos do Anexo E da EA-4/02 não se aplica (EA-4/02 §S9.11). A incerteza expandida é declarada como a incerteza-padrão multiplicada por um fator de abrangência k = 2, correspondendo a uma probabilidade de abrangência de pelo menos 95% — o fator recomendado de forma geral pela cg-15 §5.1.5.4, que situa k entre 1,65 (quando a parcela retangular domina) e 2 (quando a parcela normal domina) e indica não existir fórmula fechada para k.",
        "Observação: para o exemplo específico de 100 V da EA-4/02 §S9.12, dominado pela resolução, o guia reporta k = 1,65 (distribuição retangular). Este método adota k = 2 conforme a recomendação geral da cg-15 §5.1.5.4 — ponto a confirmar pelo metrologista para cada faixa de uso.",
        "Aplica-se somente a tensão DC; AC adiado. Contribuições situacionais (deriva, offset/não-linearidade/ganho, temperatura ambiente e tensão de rede do calibrador — EA-4/02 §S9.8; EMF térmica — cg-15 §3.4.6.1) são incluídas pelo laboratório quando aplicáveis (ver a lista “Componentes omitidos” do método).",
      ],
    },
    {
      kind: "bullets",
      items: [
        "Os resultados referem-se exclusivamente ao instrumento calibrado, no momento da calibração (cg-15 §5.1.6.1).",
        "Este certificado não tem valor para fins de metrologia legal.",
      ],
    },
  ],
};

export const electricalProductDefinition: TemplateProductDefinition = {
  assetTypeSlug: DMM_ASSET_TYPE_SLUG,
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
      assetTypeId: DMM_ASSET_TYPE_SLUG,
      dataFields,
      formulas,
      validations: [],
      metadata: {
        validationStatus: "pending_revalidation",
        source: "method-templates:electrical-indication",
      },
    },
    args,
  );
}

// Expected values are CHARACTERIZATION outputs (engine, decimal mode), pinned
// within the preview's 1e-9 relative tolerance. They lock the arithmetic; the
// metrology MODEL is checked against cg-15 + EA-4/02 §S9 (see header) but the
// [VERIFICAR] items remain for the metrologist.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_10V",
    label: "Ponto de 10 V DC, U_padrão 5 mV (k=2), resolução 1 mV",
    inputs: {
      pontos_tensao: [
        {
          valor_referencia: 10,
          incerteza_referencia: 0.005,
          k_referencia: 2,
          resolucao: 0.001,
          leitura_1: 10.002,
          leitura_2: 10.001,
          leitura_3: 10.003,
        },
      ],
    },
    expected: {
      // Hand-checked: E = 10.002 − 10 = 0.002 V; s = 0.001 V;
      // u_ref = 0.005/2 = 0.0025 V (k_referencia=2);
      // u_c = √(0.000577² + 0.000289² + 0.0025²) = 0.00258199 V; U = 2·u_c.
      // Pinned from the engine (decimal mode), within 1e-9.
      formulas: {
        erro: [0.002],
        u_repetibilidade: [0.0005773502691896258],
        u_resolucao: [0.0002886751345948129],
        u_referencia: [0.0025],
        u_combinada: [0.0025819888974716113],
        u_expandida: [0.0051639777949432225],
      },
    },
  },
];

// Metrology context faithfully transcribed from the header docblock + inline
// [VERIFICAR] markers above (sources, conformance, open decisions, omissions).
// Never invented — the registry oracle cross-checks this against the compiled
// definition (verificarItems count, fieldKeys, worked-example scenario).
const governance: MetrologyGovernance = {
  summary:
    "Calibração de multímetro digital em tensão DC por erro de indicação. RASCUNHO pendente de revisão metrológica: soma por quadratura (RSS) de repetibilidade/instabilidade (Tipo A), resolução (retangular ½·resolução/√3, EA-4/02 §S9.7) e do padrão (U do certificado ÷ o k do próprio certificado, EA-4/02 §S9.6). Por ser dominado pela resolução (essencialmente retangular), o Anexo E da EA-4/02 não se aplica (§S9.11) e adota-se o fator k=2 recomendado pela cg-15 §5.1.5.4.",
  measurand: "E = leitura média − valor aplicado (EA-4/02 §S9.3, eq. S9.1)",
  model: "formulas",
  sources: [
    {
      title: "EURAMET cg-15",
      edition: "v2.0 (03/2011)",
      section: "§5.1.5.1, §5.1.5.3, §5.1.5.4 (NOTA p/ DMM de baixa resolução)",
      url: "https://www.euramet.org/Media/docs/Publications/calguides/EURAMET_cg-15__v_2.0_Guidelines_Calibration_Digital_Multimeters.pdf",
    },
    {
      title: "EA-4/02",
      edition: "M:2022",
      section: "Suplemento 2 §S9 (§S9.3, §S9.6, §S9.7, §S9.8, §S9.11–§S9.13)",
      url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
    },
  ],
  conformanceNotes: [
    {
      ref: "EA-4/02 M:2022 §S9.3 eq. (S9.1)",
      note: "O modelo de erro de indicação E = leitura − valor aplicado segue a eq. (S9.1): E_X = Vi_X − V_S (+ correções). A cg-15 §5.1.4.1 traz apenas os títulos das colunas do certificado, não o modelo.",
    },
    {
      ref: "cg-15 §5.1.5.1",
      note: "A incerteza reportada leva em conta a resolução e a instabilidade de curto prazo do instrumento, por soma quadrática à parcela do padrão (calibração). São as três parcelas modeladas aqui.",
    },
    {
      ref: "EA-4/02 M:2022 §S9.7",
      note: "A correção de resolução tem limites de ½ do dígito menos significativo (½·resolução) ⇒ parcela RETANGULAR u = (resolução/2)/√3. (A cg-15 §5.1.5.4 é a NOTA sobre o fator de abrangência, não o divisor de resolução.)",
    },
    {
      ref: "EA-4/02 M:2022 §S9.6",
      note: "O certificado do calibrador declara seu PRÓPRIO fator de abrangência (k=2 no exemplo §S9). Por isso u_referencia = incerteza_referencia / k_referencia — o k é informado, não fixado em 2.",
    },
    {
      ref: "cg-15 §5.1.5.4 + EA-4/02 §S9.11",
      note: "Para um DMM de baixa resolução o orçamento é dominado pela resolução: a distribuição resultante é essencialmente retangular, então o método dos graus de liberdade efetivos do Anexo E NÃO se aplica (EA-4/02 §S9.11). A cg-15 §5.1.5.4 situa o fator de 95% entre 1,65 (parcela retangular domina) e 2 (parcela normal domina), afirma não haver fórmula fechada para k e RECOMENDA k=2 no geral. Daí U = 2·u_c — decisão citada, não o caminho do Apêndice E usado por força/frequência/pesagem.",
    },
    {
      ref: "cg-15 §5.1.5.3",
      note: "Frase de declaração padrão da incerteza expandida: U é a incerteza-padrão multiplicada por k = 2 (≈95%).",
    },
  ],
  verificarItems: [
    {
      ref: "cg-15 Tabelas 1–2",
      item: "ESCOPO: apenas tensão DC (a cg-15 também cobre corrente DC, resistência e tensão/corrente AC — Tabelas 1–2). AC ADIADO para a v1. Corrente DC e resistência usam o mesmo modelo de erro de indicação + RSS com suas próprias unidades (templates separados, a adicionar após revisão).",
      severity: "info",
    },
    {
      ref: "EA-4/02 M:2022 §S9.6",
      item: "VALOR a informar: a incerteza EXPANDIDA U do certificado do calibrador (incerteza_referencia); reduzida abaixo à incerteza-padrão pelo k do próprio certificado.",
      severity: "action",
      fieldKeys: ["incerteza_referencia"],
    },
    {
      ref: "cg-15 §5.1.5.1",
      item: "3 leituras repetidas; média aritmética. A cg-15 §5.1.5.1 trata a instabilidade de curto prazo da leitura como parcela do orçamento.",
      severity: "info",
      fieldKeys: ["leitura_1", "leitura_2", "leitura_3", "media"],
    },
    {
      item: "n=3 fixo para corresponder às 3 colunas de leitura.",
      severity: "info",
      fieldKeys: ["leitura_1", "leitura_2", "leitura_3", "desvio_padrao"],
    },
    {
      item: "Incerteza-padrão da MÉDIA = s/√n (n=3). Se o resultado reportado se referir a uma leitura única, a EA-4/02 usaria s diretamente.",
      severity: "action",
      fieldKeys: ["u_repetibilidade", "desvio_padrao"],
    },
    {
      ref: "EA-4/02 M:2022 §S9.6",
      item: "VALOR a informar: o fator k do certificado do calibrador (k_referencia). Na maioria dos certificados k=2 — leia-o no seu certificado em vez de presumir.",
      severity: "action",
      fieldKeys: ["k_referencia", "incerteza_referencia"],
    },
    {
      ref: "EA-4/02 M:2022 §S9.8 / cg-15 §3.4.6.1",
      item: "Some parcelas situacionais quando o arranjo exigir: as correções do calibrador da EA-4/02 §S9.8 (deriva desde a última calibração, offset/não-linearidade/ganho, temperatura ambiente, tensão de rede, carregamento de entrada) e a EMF térmica (zero não anulado, cg-15 §3.4.6.1). Não modeladas — ver Componentes omitidos.",
      severity: "action",
      fieldKeys: ["u_combinada"],
    },
    {
      ref: "cg-15 §5.1.5.4 + EA-4/02 §S9.11",
      item: "DECISÃO citada (não pendência): para DMM de baixa resolução o orçamento é dominado pela resolução (essencialmente retangular) — Anexo E da EA-4/02 não se aplica (§S9.11) e a cg-15 §5.1.5.4 recomenda k=2 no geral. Para o exemplo de 100 V a EA-4/02 §S9.12 reporta k=1,65 (retangular puro); confirme por faixa de uso se a parcela de resolução de fato domina antes de fixar k=2.",
      severity: "action",
      fieldKeys: ["u_expandida", "u_combinada"],
    },
  ],
  omittedComponents: [
    {
      ref: "EA-4/02 M:2022 §S9.8 (1)",
      component:
        "Deriva do calibrador desde a última calibração — parcela retangular da correção δV_S (não modelada; magnitude é entrada do laboratório).",
      appliesWhen:
        "calibrador fora da janela de calibração ou com histórico de deriva relevante",
    },
    {
      ref: "EA-4/02 M:2022 §S9.8 (2)",
      component:
        "Efeito de offset, não-linearidade e diferenças de ganho do calibrador — parcela retangular da correção δV_S.",
      appliesWhen:
        "uso fora das condições da especificação de exatidão do calibrador, ou ponto distante dos pontos de ajuste",
    },
    {
      ref: "EA-4/02 M:2022 §S9.8 (3)",
      component:
        "Desvio de temperatura ambiente fora da faixa especificada do calibrador — parcela retangular da correção δV_S.",
      appliesWhen:
        "temperatura ambiente fora da faixa da especificação do calibrador (p.ex. 18 °C a 23 °C)",
    },
    {
      ref: "EA-4/02 M:2022 §S9.8 (4)",
      component:
        "Desvio da tensão de rede que alimenta o calibrador fora da faixa especificada — parcela retangular da correção δV_S.",
      appliesWhen:
        "tensão de rede fora da faixa da especificação do calibrador (p.ex. 210 V a 250 V)",
    },
    {
      ref: "EA-4/02 M:2022 §S9.8 (5)",
      component:
        "Efeito de carregamento de entrada devido à resistência de entrada finita do DMM — parcela da correção δV_S.",
      appliesWhen:
        "resistência de carga nos terminais do calibrador abaixo do mínimo especificado (p.ex. < 100 kΩ)",
    },
    {
      ref: "cg-15 §3.4.6.1",
      component: "Força eletromotriz (EMF) térmica — zero não anulado.",
      appliesWhen: "zero não anulado conforme cg-15 §3.4.6.1",
    },
    {
      ref: "cg-15 Tabelas 1–2",
      component:
        "Tensão/corrente AC, reatância e fase — método apenas DC; AC adiado para a v1.",
      appliesWhen: "calibração em corrente/tensão alternada (AC)",
    },
  ],
  workedExample: {
    scenarioKey: "ponto_10V",
    provenance: "engine_characterization",
    source: "Motor (modo decimal)",
    expected: {
      erro: 0.002,
      u_combinada: 0.0025819888974716113,
      u_expandida: 0.0051639777949432225,
    },
  },
  reviewStatus: "draft_pending_revalidation",
};

export const electricalIndicationTemplate: TemplateModule = {
  key: "electrical-indication",
  templateVersion: 2,
  discipline: "voltage",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-15 v2.0", "EA-4/02 M:2022"],
  buildDraft,
  productDefinition: electricalProductDefinition,
  previewScenarios,
  governance,
};
