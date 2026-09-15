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
  MetrologyGovernance,
  TemplateModule,
  TemplateProductDefinition,
} from "../types";

/**
 * Relative-humidity indication-error calibration of a thermohygrometer against
 * a dew-point reference, using the Magnus saturation-vapour-pressure formula.
 *
 * ⚠️ DRAFT — pending metrologist review. The Magnus formula + coefficients were
 * read from the cited source; uncertainty is propagated through the exp() terms
 * by the GUM engine (no hand-derived sensitivity coefficients). Sources READ in
 * full from their PDFs (not merely cited):
 *   - WMO No. 8, Guide to Instruments and Methods of Observation (CIMO Guide),
 *     Annex 4.B (read) — saturation vapour pressure over water:
 *     e_w(t) = 6.112·exp(17.62·t/(243.12 + t)), t in °C, e_w in hPa, declared
 *     VALID over WATER from −45 to 60 °C (pure phase); the annex also gives RH
 *     directly as U = 100·e'_w(p,t_d)/e'_w(p,t), with the enhancement factor
 *     f(p) cancelling in the ratio. Over ice it uses a DIFFERENT set
 *     (6.112·exp(22.46·t/(272.62 + t)), −65 to 0 °C) — out of scope here.
 *     Primary record: https://library.wmo.int/records/item/41650
 *     Programme page:  https://community.wmo.int/en/activity-areas/imop/wmo-no_8
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration" (read): §5.1 — k = 2 when a normal distribution applies and
 *     u_c is reliable; §5.2 — Central Limit Theorem (N ≥ 3 well-behaved
 *     distributions ⇒ output normal); §5.3 — reliability holds unless a Type A
 *     term rests on fewer than ten observations; Appendix E2(b) — a Type B
 *     contribution is taken with infinite degrees of freedom (ν = ∞); Table E.1
 *     — ν_eff = ∞ ⇒ k = 2,00. All inputs here are Type B ⇒ ν_eff = ∞ ⇒ k = 2.
 *     https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *
 * Model: RH_ref = 100·e_w(t_d)/e_w(t) (actual vapour pressure at the reference
 * dew point t_d over saturation at air temperature t); E = RH_ind − RH_ref. A
 * dimensionless factor c_aprox (nominal 1) carries the formula-approximation
 * uncertainty of the Magnus fit (see below).
 *
 * Magnus-approximation uncertainty (the one substantive numerical gap, now
 * MODELLED): the Magnus fit with the 6.112/17.62/243.12 coefficients is the
 * Sonntag-1990 set (SA90). Alduchov & Eskridge (1996, J. Appl. Meteor. 35:601,
 * Table III) report a MAXIMUM relative error of 0,597 % for this SA90 set over
 * −40…50 °C (worst case near −35 °C) versus the reference formulations — NOT a
 * k = 2 figure and NOT stated in the WMO annex. It is a deviation BOUND, so it
 * is modelled as a rectangular half-width a = 0,597 % ⇒ u = a/√3 (ν = ∞) on the
 * RH reference. [VERIFICAR] the magnitude: at typical room points the deviation
 * is well below the −35 °C worst case, so a metrologist may justify a smaller a.
 *
 * Coverage: k = 2 is DECIDED, not assumed. The three measured inputs are Type B
 * ⇒ ν_eff = ∞ (EA-4/02 App. E2(b)) ⇒ Table E.1 gives k = 2,00, consistent with
 * §5.1 (normal + reliable). The coverageFactor is therefore set to 2 below.
 * NOTE for future revisions: if a Type A term based on FEW observations is ever
 * introduced (e.g. a repeated-reading column), DROP the explicit coverageFactor
 * so the engine derives a Student-t k from ν_eff (Welch–Satterthwaite) — the
 * engine supports that for measurement models (see force-indication).
 *
 * Magnus coefficients (6.112 hPa, 17.62, 243.12 °C) match the WMO Annex 4.B
 * over-water set EXACTLY — DO NOT change them.
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived via the shared buildDraftFromProduct.
 */

const METHOD_NAME = "Calibração de Termohigrômetro (UR) por Erro de Indicação";
const HYGROMETER_ASSET_TYPE_SLUG = "termohigrometro";
const methodDescription =
  "Calibração de termohigrômetros em umidade relativa por comparação contra uma referência de ponto de orvalho. A UR de referência é calculada por UR = 100·e_w(t_d)/e_w(t) com a fórmula de Magnus (WMO CIMO Anexo 4.B, sobre água, válida de −45 a 60 °C); o erro de indicação é E = UR indicada − UR de referência. A incerteza-padrão combinada é propagada pelo motor GUM pelos termos exp() (EA-4/02) e inclui um termo de aproximação da própria fórmula de Magnus (limite de desvio retangular). O fator de abrangência é k = 2: como todas as entradas são do Tipo B, ν_eff = ∞ (EA-4/02 Apêndice E) e a Tabela E.1 dá k = 2,00. Rascunho pendente de revisão metrológica.";

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
    reporting: {
      includeInCertificate: true,
      role: "auxiliary",
      group: "calibration_result",
    },
  },
];

// Magnus formula-approximation half-width (rectangular bound), as a RELATIVE
// fraction on the RH reference. From Alduchov & Eskridge (1996) Table III, the
// SA90 (6.112/17.62/243.12) over-water set has a MAXIMUM relative error of
// 0,597 % over −40…50 °C — a deviation bound, not a k=2 figure. Modelled as a
// rectangular half-width a ⇒ u = a/√3 (ν = ∞). [VERIFICAR] the magnitude.
const MAGNUS_APPROX_HALF_WIDTH = 0.00597;
// u = a/√3. Entered as a reduced standard uncertainty (distribution documented
// in governance.verificarItems) so the clean Type B input does not trip the
// engine's INVALID_TYPE_B_CONFIGURATION "do-not-split-source-fields" guard.
const MAGNUS_APPROX_STANDARD_UNCERTAINTY =
  MAGNUS_APPROX_HALF_WIDTH / Math.sqrt(3);

// GUM model for the indication error, propagating through the exp() terms.
const measurementModels = [
  {
    key: "erro_ur",
    label: "Erro de indicação de UR (E)",
    scope: ROW_SCOPE,
    measurand: "E",
    // E = RH_ind − c_aprox·100·e_w(t_d)/e_w(t); Magnus inlined in the base
    // quantities so the engine differentiates through exp() (correct sensitivity
    // coefficients). c_aprox (nominal 1) carries the Magnus-fit approximation
    // uncertainty onto the RH-reference term.
    expression: `leitura_ur - c_aprox * 100 * (${e_w("ponto_orvalho")}) / (${e_w("temperatura")})`,
    outputUnit: "%RH",
    // k = 2 is DECIDED: all quantities are Type B ⇒ ν_eff = ∞ (EA-4/02 App.
    // E2(b)) ⇒ Table E.1 ⇒ k = 2,00, consistent with §5.1 (normal + reliable).
    // If a Type A term based on FEW observations is added later, DROP this
    // explicit coverageFactor so the engine derives a Student-t k from ν_eff.
    coverageFactor: 2,
    correlations: [],
    covariances: [],
    options: { allowNonSmoothWithExplicitSensitivities: false },
    quantities: [
      {
        symbol: "leitura_ur",
        source: {
          kind: "table_column",
          tableKey: "pontos_umidade",
          columnKey: "leitura_ur",
        },
        unit: "%RH",
        // [VERIFICAR] resolution + short-term instability of the DUT reading.
        uncertainty: {
          kind: "direct_standard_uncertainty",
          standardUncertainty: 0.2,
        },
      },
      {
        symbol: "temperatura",
        source: {
          kind: "table_column",
          tableKey: "pontos_umidade",
          columnKey: "temperatura",
        },
        unit: "°C",
        // [VERIFICAR] reference thermometer standard uncertainty.
        uncertainty: {
          kind: "direct_standard_uncertainty",
          standardUncertainty: 0.1,
        },
      },
      {
        symbol: "ponto_orvalho",
        source: {
          kind: "table_column",
          tableKey: "pontos_umidade",
          columnKey: "ponto_orvalho",
        },
        unit: "°C",
        // [VERIFICAR] dew-point mirror reference standard uncertainty.
        uncertainty: {
          kind: "direct_standard_uncertainty",
          standardUncertainty: 0.2,
        },
      },
      {
        // Magnus formula-approximation term (Alduchov & Eskridge 1996, Table III,
        // SA90 set). Nominal 1; its standard uncertainty is the rectangular bound
        // reduced by √3 (ν = ∞, Type B). [VERIFICAR] the magnitude per operating
        // range. Not stated in the WMO annex — never present this as a WMO value.
        symbol: "c_aprox",
        // Dimensionless ("1") correction factor, nominal value 1.
        unit: "1",
        source: { kind: "constant", value: 1 },
        uncertainty: {
          kind: "direct_standard_uncertainty",
          standardUncertainty: MAGNUS_APPROX_STANDARD_UNCERTAINTY,
          degreesOfFreedom: "Infinity",
        },
      },
    ],
  },
];

// No literal "[VERIFICAR]" is rendered in certificate text: a certificate must
// not announce its own incompleteness. The procedure code defaults to an em-dash
// placeholder (the [VERIFICAR] lives only in governance.verificarItems).
const certificateContent = {
  procedureCode: "—",
  referenceStandards: ["WMO No. 8 (CIMO Guide) Anexo 4.B", "EA-4/02 M:2022"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A UR de referência é calculada a partir do ponto de orvalho e da temperatura do ar pela fórmula de Magnus (WMO CIMO Anexo 4.B): UR = 100·e_w(t_d)/e_w(t), com e_w(T) = 6,112·exp(17,62·T/(243,12+T)) hPa. O erro de indicação é E = UR indicada − UR de referência. A fórmula sobre água é válida de −45 a 60 °C (WMO Anexo 4.B); abaixo de 0 °C aplica-se o conjunto sobre gelo, fora do escopo deste método.",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        {
          term: "e_w",
          definition:
            "Pressão de saturação de vapor sobre água (Magnus, WMO Anexo 4.B, válida de −45 a 60 °C).",
        },
        { term: "t_d", definition: "Ponto de orvalho de referência." },
        {
          term: "E",
          definition: "Erro de indicação de UR (indicada − referência).",
        },
        { term: "U", definition: "Incerteza expandida (U = k·u_c, k = 2)." },
        {
          term: "k",
          definition:
            "Fator de abrangência igual a 2 (todas as entradas são do Tipo B, ν_eff = ∞; EA-4/02 §5.1, Apêndice E, Tabela E.1).",
        },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada é propagada conforme a EA-4/02 a partir das incertezas de entrada (UR indicada, temperatura, ponto de orvalho) através dos termos exp() da fórmula de Magnus, somada à incerteza de aproximação da própria fórmula (limite de desvio modelado como distribuição retangular).",
        "A incerteza expandida é U = k·u_c com k = 2. Como todas as grandezas de entrada são do Tipo B, os graus de liberdade efetivos são infinitos (EA-4/02 Apêndice E) e a Tabela E.1 fornece k = 2,00, condição compatível com a §5.1 (distribuição normal e incerteza confiável).",
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
  measurementModels:
    MethodMeasurementModelSchema.array().parse(measurementModels),
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
// within the preview's 1e-9 relative tolerance. They lock the formula arithmetic
// AND the Magnus-approximation term now folded into u_c (k stays 2). Second
// scenario = OUT-OF-DOMAIN engine smoke-test (see its annotation).
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_23C_orvalho12C",
    label:
      "Ponto: ar 23 °C, orvalho 12 °C, indicado 50,5 %RH (em domínio, −45…60 °C)",
    inputs: {
      pontos_umidade: [
        { temperatura: 23, ponto_orvalho: 12, leitura_ur: 50.5 },
      ],
    },
    expected: {
      // Row-scoped → one value per row. RH_ref = 100·e_w(12)/e_w(23) = 49.954 %RH
      // (WMO Magnus); E = 50.5 − 49.954 = 0.546 %RH; u_c now includes the Magnus
      // formula-approximation term (c_aprox) and U = 2·u_c (k stays 2 — all inputs
      // Type B ⇒ ν_eff = ∞). Pinned from the engine (decimal mode) within 1e-9.
      formulas: {
        ur_referencia: [49.95436074109317],
      },
      measurementModels: {
        erro_ur: {
          estimate: [0.5456392589068291],
          standardUncertainty: [0.770290122291377],
          expandedUncertainty: [1.540580244582754],
        },
      },
    },
  },
  {
    // OUT-OF-DOMAIN smoke-test, NOT an in-spec calibration point: 90/85 °C is
    // ABOVE the WMO Annex 4.B over-water validity range (−45 to 60 °C). It exists
    // only to confirm the exp() terms evaluate (no EXPONENT_TOO_LARGE/DOMAIN_ERROR)
    // at the engine envelope — it does NOT imply the Magnus fit is valid at 90 °C.
    key: "envelope_90C",
    label:
      "Envelope (FORA DO DOMÍNIO −45…60 °C): ar 90 °C, orvalho 85 °C — só teste numérico do motor",
    inputs: {
      pontos_umidade: [{ temperatura: 90, ponto_orvalho: 85, leitura_ur: 75 }],
    },
    // No expected assertion — confirms the exp() terms evaluate without error
    // beyond the declared validity range (numeric extrapolation only).
  },
];

// Transcrição estruturada do docblock do cabeçalho — fiel, sem metrologia
// inventada. Fontes lidas em PDF (ver docblock).
const governance: MetrologyGovernance = {
  summary:
    "Calibração de termohigrômetro (umidade relativa) por erro de indicação contra referência de ponto de orvalho, pela fórmula de Magnus de pressão de vapor de saturação (válida de −45 a 60 °C sobre água). A incerteza-padrão é propagada pelos termos exp() do motor GUM (sem coeficientes de sensibilidade derivados à mão) e inclui um termo de aproximação da própria fórmula. O fator k = 2 é DECIDIDO: todas as entradas são do Tipo B, logo ν_eff = ∞ e a Tabela E.1 da EA-4/02 dá k = 2,00. RASCUNHO pendente de revisão metrológica.",
  measurand:
    "E = UR indicada − UR de referência; UR_ref = 100·e_w(t_d)/e_w(t) por Magnus (WMO CIMO Anexo 4.B, sobre água, −45 a 60 °C)",
  model: "gum_measurement_model",
  sources: [
    {
      title: "WMO No. 8 (Guia CIMO)",
      edition: "ed. 2018 (Vol. I)",
      section:
        "Anexo 4.B — pressão de saturação sobre água e_w(t) = 6.112·exp(17.62·t/(243.12 + t)) hPa, válida de −45 a 60 °C; RH = 100·e'_w(p,t_d)/e'_w(p,t)",
      url: "https://library.wmo.int/records/item/41650",
    },
    {
      title: "WMO No. 8 (Guia CIMO) — página do programa",
      edition: "OMM/CIMO",
      section: "página oficial do guia (acesso aos volumes/capítulos)",
      url: "https://community.wmo.int/en/activity-areas/imop/wmo-no_8",
    },
    {
      title: "Alduchov & Eskridge (1996), J. Appl. Meteor. 35:601",
      edition: "Tabela III (conjunto SA90)",
      section:
        "erro relativo máximo de 0,597 % do conjunto 6.112/17.62/243.12 sobre água (−40 a 50 °C) — fonte do termo de aproximação, NÃO da WMO",
      url: "https://www.osti.gov/biblio/548871",
    },
    {
      title: "EA-4/02",
      edition: "M:2022",
      section:
        "§5.1 (k=2 normal+confiável) + §5.3 + Apêndice E2(b) (Tipo B ⇒ ν=∞) + Tabela E.1 (ν=∞ ⇒ k=2,00)",
      url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
    },
  ],
  conformanceNotes: [
    {
      ref: "WMO No. 8 Anexo 4.B",
      note: "Modelo: UR_ref = 100·e_w(t_d)/e_w(t) (pressão de vapor real no ponto de orvalho de referência t_d sobre a saturação à temperatura do ar t); E = UR_ind − UR_ref. O multiplicador 6,112 hPa e o fator de intensificação f(p) se cancelam na razão.",
    },
    {
      ref: "WMO No. 8 Anexo 4.B",
      note: "Domínio de validade: a fórmula sobre água vale de −45 a 60 °C (fase pura). Abaixo de 0 °C há um conjunto distinto sobre gelo (6,112·exp(22,46·t/(272,62 + t)), de −65 a 0 °C), não modelado aqui.",
    },
    {
      ref: "Alduchov & Eskridge (1996) Tabela III",
      note: "O conjunto 6,112/17,62/243,12 é o de Sonntag-1990 (SA90); seu erro relativo máximo é 0,597 % sobre −40 a 50 °C (pior caso perto de −35 °C). É um LIMITE de desvio, modelado como meia-largura retangular a = 0,597 % ⇒ u = a/√3 (ν = ∞) sobre a UR de referência. Esse número NÃO consta do anexo da WMO.",
    },
    {
      ref: "EA-4/02 M:2022 §5.1 + Apêndice E + Tabela E.1",
      note: "Fator de abrangência DECIDIDO: como nenhuma entrada é do Tipo A com poucas observações, a §5.3 dá confiabilidade suficiente; sendo todas do Tipo B, ν_eff = ∞ (E2(b)) e a Tabela E.1 dá k = 2,00, compatível com a §5.1 (normal + confiável). Por isso k é fixado em 2 no modelo.",
    },
    {
      ref: "EA-4/02 M:2022",
      note: "A incerteza-padrão é propagada das entradas (UR indicada, temperatura, ponto de orvalho) pelos termos exp() da fórmula de Magnus, somada ao termo de aproximação; a expandida é U = k·u_c (sensibilidades simbólicas, sem coeficientes derivados à mão).",
    },
  ],
  verificarItems: [
    {
      ref: "Alduchov & Eskridge (1996) Tabela III",
      item: "VALOR a confirmar: a meia-largura do termo de aproximação de Magnus (c_aprox). Padrão 0,597 % (limite máximo de −40 a 50 °C, conjunto SA90), retangular ⇒ u = a/√3, ν = ∞. Em pontos de uso típicos o desvio é menor que esse pior caso — o metrologista pode justificar um valor menor. Atribuído a Alduchov & Eskridge, NÃO à WMO.",
      severity: "action",
      fieldKeys: ["c_aprox"],
    },
    {
      ref: "WMO No. 8 Anexo 4.B",
      item: "Os coeficientes de Magnus (6,112 hPa, 17,62, 243,12 °C) conferem EXATAMENTE com o conjunto sobre água do Anexo 4.B — não devem ser alterados.",
      severity: "info",
    },
    {
      ref: "WMO No. 8 Anexo 4.B",
      item: "Domínio de validade: este método cobre apenas a fase sobre água, de −45 a 60 °C. Abaixo de 0 °C usa-se o conjunto sobre gelo (fora do escopo). Mantenha os pontos de calibração dentro de −45 a 60 °C.",
      severity: "action",
      fieldKeys: ["temperatura", "ponto_orvalho"],
    },
    {
      item: "As incertezas-padrão de entrada são valores representativos provisórios (defina-as a partir dos certificados do espelho de ponto de orvalho / termômetro / resolução do equipamento).",
      severity: "action",
      fieldKeys: ["leitura_ur", "temperatura", "ponto_orvalho"],
    },
    {
      ref: "EA-4/02 M:2022 §5.1 + Apêndice E",
      item: "k = 2 é decidido (todas as entradas Tipo B ⇒ ν_eff = ∞ ⇒ Tabela E.1 dá 2,00), não presumido. Se um dia entrar um termo Tipo A com poucas observações (p.ex. coluna de leituras repetidas), remova o coverageFactor fixo para o motor derivar k por t-Student (ν_eff).",
      severity: "info",
    },
    {
      item: "Suposição t_d ≈ t_água; sem termo de gradiente de temperatura entre o sensor e a referência.",
      severity: "info",
    },
    {
      item: "Resolução e instabilidade de curto prazo da leitura do equipamento.",
      severity: "action",
      fieldKeys: ["leitura_ur"],
    },
    {
      item: "Incerteza-padrão do termômetro de referência.",
      severity: "action",
      fieldKeys: ["temperatura"],
    },
    {
      item: "Incerteza-padrão do espelho de ponto de orvalho de referência.",
      severity: "action",
      fieldKeys: ["ponto_orvalho"],
    },
    {
      item: "O campo procedureCode usa um traço (—) como espaço reservado; defina o código do procedimento do laboratório no conteúdo do certificado.",
      severity: "action",
    },
  ],
  omittedComponents: [
    {
      ref: "WMO No. 8 Anexo 4.B",
      component:
        "Coeficientes de Magnus sobre gelo (conjunto de coeficientes diferente)",
      appliesWhen: "temperatura abaixo de 0 °C",
    },
    {
      ref: "WMO No. 8 Anexo 4.B",
      component: "Termo de gradiente de temperatura (suposição t_d ≈ t_água)",
      appliesWhen: "gradiente térmico relevante entre o sensor e a referência",
    },
  ],
  workedExample: {
    scenarioKey: "ponto_23C_orvalho12C",
    provenance: "engine_characterization",
    source: "Motor (modo decimal)",
    expected: {
      ur_referencia: 49.95436074109317,
      estimate: 0.5456392589068291,
      expandedUncertainty: 1.540580244582754,
    },
  },
  reviewStatus: "draft_pending_revalidation",
};

export const humidityMagnusTemplate: TemplateModule = {
  key: "humidity-magnus",
  templateVersion: 2,
  discipline: "humidity",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["WMO No. 8 (CIMO Guide) Annex 4.B", "EA-4/02"],
  buildDraft,
  productDefinition: humidityProductDefinition,
  previewScenarios,
  governance,
};
