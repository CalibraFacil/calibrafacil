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
  MetrologyGovernance,
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
 *   - EURAMET cg-19 v4.1 (12/2025) "Guidelines on the Determination of
 *     Uncertainty in Gravimetric Volume Calibration":
 *     https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-019_Calibration_Guide_No._19_web.pdf
 *   - ISO 4787:2010 (the source of the volume equation, referenced by cg-19 §3).
 *   - EA-4/02 M:2022, Appendix E (Welch–Satterthwaite + Table E.1 coverage k).
 *
 * Conformance to cg-19 v4.1 (read from the text):
 *   - §6.1 Eq. (5) / §6.4 Eq. (16): the full model is
 *       V0 = Δm·A·B·C + ΔVop + ΔVevap + ΔVrep, where the ΔV terms are auxiliary
 *     quantities of expected value 0 carrying their own uncertainty + DoF. Here
 *     Δm = I_L − I_E, A = 1/(ρ_W − ρ_A), B = 1 − ρ_A/ρ_B, C = 1 − γ(t − t0).
 *     This template models Δm·A·B·C + ΔV_men (meniscus, §6.3.7.1) + ΔV_rep
 *     (repeatability, §6.3.9); evaporation (§6.3.8) stays in omittedComponents.
 *   - §3 / Eq. (2): water density ρ_W via the Tanaka formula with coefficients
 *     a1=−3.983035, a2=301.797, a3=522528.9, a4=69.34881, a5=0.999974950 g/mL
 *     (verbatim from p.6). Inlined into the V0 expression so the temperature
 *     uncertainty propagates through both ρ_W and the γ term (correctly
 *     correlated).
 *   - §6.3.5: ρ_B (density of reference weights) promoted to an input quantity
 *     (from the weight-set certificate or OIML R 111-1 class); t0 = 20 °C.
 *   - §6.7 Eq. (28) / §6.8 / §7.1.5 + EA-4/02 App. E: the coverage factor k is
 *     NOT fixed at 2 — the engine derives effective degrees of freedom ν_eff by
 *     Welch–Satterthwaite and the Student-t k for 95 %. The finite ν of the
 *     repeatability term (ν = n−1) makes ν_eff finite, so k > 2 (the worked
 *     example §7.1.5 yields ν_eff = 19 → k ≈ 2,15).
 *
 * [VERIFICAR] The input STANDARD UNCERTAINTIES below (including u(ΔV_men),
 * u(ΔV_rep) = s(V0)/√n and u(ρ_B)) are representative placeholders — the
 * metrologist must set them from the actual balance / sensor / weight-set /
 * air-density (cg-19 §6.3.4 / CIPM) certificates and from the laboratory's own
 * repeatability series. Only the STRUCTURE (terms, distributions, ν = n−1) is
 * taken from the guide; the magnitudes stay lab inputs. ρ_A is taken as an
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
    // cg-19 §6.3.5: density of the reference weights, from the weight-set / balance
    // certificate or the OIML R 111-1 class (cg-19 default 8,0 g/mL). [VERIFICAR].
    key: "rho_b",
    label: "Densidade dos pesos de referência (ρ_B)",
    type: "number",
    unit: "g/mL",
    quantityKind: "reference",
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
// V0 — cg-19 §6.1 Eq. (5) / §6.4 Eq. (16): Δm·A·B·C + ΔV_men + ΔV_rep, with
// t0 = 20 °C inlined and ρ_B taken as an input quantity (cg-19 §6.3.5). The two
// ΔV auxiliary terms have expected value 0 (so they do not shift V0) and carry
// the meniscus (Type B, §6.3.7.1) and repeatability (Type A, §6.3.9) components.
const V0_EXPRESSION = `(I_L - I_E) / (${RHO_W} - rho_a) * (1 - rho_a / rho_b) * (1 - gamma * (t_w - 20)) + dv_men + dv_rep`;

const measurementModels = [
  {
    key: "volume_v0",
    label: "Volume a 20 °C (V₀)",
    scope: ROW_SCOPE,
    measurand: "V0",
    expression: V0_EXPRESSION,
    outputUnit: "mL",
    // Coverage k is DERIVED by the engine, not fixed: with coverageFactor omitted
    // and coverageProbability = 0,95 the engine computes ν_eff (Welch–Satterthwaite,
    // cg-19 §6.7 Eq. 28 / EA-4/02 App. E.1) and the Student-t k for 95 %. The
    // finite ν of the repeatability term (dv_rep, ν = n−1) makes ν_eff finite, so
    // k > 1,96 (cf. cg-19 §7.1.5: ν_eff = 19 → k ≈ 2,15).
    coverageProbability: 0.95,
    // No correlations modelled between the input quantities ([VERIFICAR] cg-19
    // §6.6 — e.g. water-density/temperature handled via the inlined ρ_W(t_w)).
    correlations: [],
    covariances: [],
    // V0 is smooth (no abs/min/max/floor) → numeric/symbolic sensitivities apply.
    options: { allowNonSmoothWithExplicitSensitivities: false },
    quantities: [
      // [VERIFICAR] As incertezas-padrão de entrada abaixo são valores
      // REPRESENTATIVOS retirados do exemplo trabalhado da cg-19 v4.1 §7.1
      // (Tabela 2). NÃO são do laboratório — o metrologista deve substituí-las
      // pelas dos seus próprios certificados / série de medições.
      {
        symbol: "I_L",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "I_L" },
        unit: "g",
        // [VERIFICAR] balance standard uncertainty (cg-19 §6.3.1). Tabela 2: u(Δm)=0,00127 g
        // → repartida entre I_L e I_E (0,0009 g cada → ~0,00127 g combinada). ν=∞ (Type B).
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.0009 },
        degreesOfFreedom: "Infinity",
      },
      {
        symbol: "I_E",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "I_E" },
        unit: "g",
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.0009 },
        degreesOfFreedom: "Infinity",
      },
      {
        symbol: "t_w",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "t_w" },
        unit: "°C",
        // [VERIFICAR] thermometer standard uncertainty (cg-19 §6.3.2). Tabela 2: u(t)=0,0152 °C. ν=∞.
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.0152 },
        degreesOfFreedom: "Infinity",
      },
      {
        symbol: "rho_a",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "rho_a" },
        unit: "g/mL",
        // [VERIFICAR] air-density uncertainty (cg-19 §6.3.4 / CIPM). Tabela 2: u(ρ_A)=1,76e-6 g/mL. ν=∞.
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.00000176 },
        degreesOfFreedom: "Infinity",
      },
      {
        symbol: "rho_b",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "rho_b" },
        unit: "g/mL",
        // [VERIFICAR] reference-weight density uncertainty (cg-19 §6.3.5: weight-set
        // certificate or OIML R 111-1 class). Tabela 2: u(ρ_B)=0,0346 g/mL. ν=∞ (Type B).
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.0346 },
        degreesOfFreedom: "Infinity",
      },
      {
        symbol: "gamma",
        source: { kind: "table_column", tableKey: "determinacoes", columnKey: "gamma" },
        unit: "1/°C",
        // [VERIFICAR] cubic expansion coefficient uncertainty (cg-19 §6.3.6). Tabela 2: u(γ)=2,89e-7 1/°C. ν=∞.
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.000000289 },
        degreesOfFreedom: "Infinity",
      },
      {
        // Meniscus / operator-reading term ΔV_men (cg-19 §6.3.7.1): auxiliary
        // quantity of expected value 0, sensitivity 1, contribuição Tipo B com
        // ν = ∞. O guia (Fig. 1) deriva a incerteza-padrão da resolução do menisco
        // por uma distribuição retangular (u = a/√3) ou triangular (u = a/√6); o
        // laboratório informa a incerteza-padrão já reduzida. Tabela 2: u(ΔV_men)=0,00866 mL.
        // [VERIFICAR] magnitude.
        symbol: "dv_men",
        source: { kind: "constant", value: 0 },
        unit: "mL",
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.00866 },
        degreesOfFreedom: "Infinity",
      },
      {
        // Repeatability term ΔV_rep (cg-19 §6.3.9 Eq. 15 / ISO 4787): auxiliary
        // quantity of expected value 0, Type A, sensitivity 1. The standard
        // uncertainty is s(V0)/√n; the DEGREES OF FREEDOM are ν = n − 1, which is
        // what makes ν_eff finite (so the engine derives k > 1,96). cg-19 §7.1.5 /
        // ISO 4787 use n = 10 fillings → ν = 9. Tabela 2: u(ΔV_rep)=0,014 mL, ν=9.
        // [VERIFICAR] the magnitude (laboratory series).
        symbol: "dv_rep",
        source: { kind: "constant", value: 0 },
        unit: "mL",
        uncertainty: { kind: "direct_standard_uncertainty", standardUncertainty: 0.014 },
        degreesOfFreedom: 9,
      },
    ],
  },
];

const certificateContent = {
  // Method-level procedure reference (not lab-specific); the laboratory may
  // override with its own internal procedure code at publish time.
  procedureCode: "EURAMET cg-19 v4.1 / ISO 4787",
  referenceStandards: ["EURAMET cg-19 v4.1", "ISO 4787:2010", "EA-4/02 M:2022"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "Método gravimétrico (EURAMET cg-19 §6.1 Eq. 5 / §6.4 Eq. 16 / ISO 4787): a massa de água contida/escoada é convertida em volume a 20 °C, com a densidade da água pela fórmula de Tanaka (Eq. 2) e a densidade dos pesos de referência (ρ_B) como grandeza de entrada. O modelo soma parcelas auxiliares de valor esperado nulo para a leitura do menisco (ΔV_men) e para a repetibilidade (ΔV_rep).",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "V₀", definition: "Volume à temperatura de referência de 20 °C." },
        { term: "ρ_W", definition: "Densidade da água (Tanaka, cg-19 Eq. 2)." },
        { term: "ρ_B", definition: "Densidade dos pesos de referência (cg-19 §6.3.5)." },
        {
          term: "U",
          definition:
            "Incerteza expandida U = k·u_c, com k derivado dos graus de liberdade efetivos por Welch–Satterthwaite (Student-t, 95 %).",
        },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada é propagada conforme a EA-4/02 a partir das incertezas das grandezas de entrada (massa, temperatura, densidade do ar, densidade dos pesos de referência, coeficiente de expansão), além das parcelas auxiliares de leitura do menisco (cg-19 §6.3.7.1) e de repetibilidade (cg-19 §6.3.9).",
        "O fator de abrangência k não é fixado em 2: os graus de liberdade efetivos são estimados pela fórmula de Welch–Satterthwaite (cg-19 §6.7 Eq. 28 / EA-4/02 Apêndice E) e o k de Student-t para 95 % é derivado a partir deles; a parcela de repetibilidade, de graus de liberdade finitos (ν = n − 1), torna ν_eff finito (cf. cg-19 §7.1.5).",
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
          rho_b: 8.0,
          gamma: 0.00001,
        },
      ],
    },
    expected: {
      // Row-scoped model → one value per row. V0 = 100.1047 mL (cg-19 Eq. 5 +
      // Tanaka Eq. 2; ΔV_men + ΔV_rep = 0, não deslocam V0). u_c e U = k·u_c
      // propagados pelo motor; k = 2.1059 é DERIVADO (Student-t, 95 %) de
      // ν_eff = 17.43 pela fórmula de Welch–Satterthwaite (cg-19 §6.7 Eq. 28 /
      // EA-4/02 App. E) — o termo de repetibilidade (ν = 9) torna ν_eff finito,
      // por isso k > 1,96 (cf. cg-19 §7.1.5: ν_eff = 19 → k ≈ 2,15; aqui u_c ≈
      // 0,0165 mL e U ≈ 0,0348 mL conferem com a Tabela 2: u = 0,017, U = 0,036).
      // Pinned from the engine (decimal mode), within 1e-9.
      measurementModels: {
        volume_v0: {
          estimate: [100.104665735215],
          standardUncertainty: [0.01651493136661448],
          expandedUncertainty: [0.03477844990678303],
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
          rho_b: 8.0,
          gamma: 0.00001,
        },
      ],
    },
    // No expected assertion — this scenario only confirms the model evaluates
    // without error across the temperature envelope.
  },
];

// Structured transcription of the header docblock's metrology context. Faithful
// to the docblock only — see the [VERIFICAR] markers throughout this file.
const governance: MetrologyGovernance = {
  summary:
    "Calibração gravimétrica de vidraria volumétrica (balão volumétrico / pipeta) à temperatura de referência t0 = 20 °C. A equação de medição foi lida do guia citado e confere; a incerteza é propagada pelo motor GUM (sem coeficientes de sensibilidade derivados à mão). RASCUNHO pendente de revisão metrológica.",
  measurand:
    "V0 = (I_L − I_E)·[1/(ρ_W − ρ_A)]·(1 − ρ_A/ρ_B)·[1 − γ(t − t0)] + ΔV_men + ΔV_rep (ISO 4787 / cg-19 §6.1 Eq. 5, §6.4 Eq. 16)",
  model: "gum_measurement_model",
  sources: [
    {
      title: "EURAMET cg-19",
      edition: "v4.1 (12/2025)",
      url: "https://www.euramet.org/Media/docs/Publications/calguides/I-CAL-GUI-019_Calibration_Guide_No._19_web.pdf",
    },
    {
      title: "ISO 4787",
      edition: "2010",
      section: "fonte da equação de volume, referenciada por cg-19 §3",
    },
    {
      title: "EA-4/02",
      edition: "M:2022",
      section: "Apêndice E (E.1 Welch–Satterthwaite + Tabela E.1)",
      url: "https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e",
    },
  ],
  conformanceNotes: [
    {
      ref: "cg-19 §6.1 Eq. (5) / §6.4 Eq. (16)",
      note: "V0 = Δm·A·B·C + ΔV_men + ΔV_rep, sendo Δm = I_L − I_E, A = 1/(ρ_W − ρ_A), B = 1 − ρ_A/ρ_B, C = 1 − γ(t − t0). As parcelas ΔV têm valor esperado nulo: carregam apenas incerteza-padrão e graus de liberdade próprios.",
    },
    {
      ref: "cg-19 §3 / Eq. (2)",
      note: "Densidade da água ρ_W pela fórmula de Tanaka com coeficientes a1=−3.983035, a2=301.797, a3=522528.9, a4=69.34881, a5=0.999974950 g/mL (transcrição literal da p.6). Embutida na expressão de V0 para que a incerteza da temperatura se propague por ρ_W e pelo termo γ (correlacionados corretamente).",
    },
    {
      ref: "cg-19 §6.3.5",
      note: "ρ_B (densidade dos pesos de referência) promovida a grandeza de entrada, vinda do certificado do jogo de pesos ou da classe OIML R 111-1 (padrão cg-19 = 8,0 g/mL); t0 = 20 °C.",
    },
    {
      ref: "cg-19 §6.3.9 / §6.3.7.1",
      note: "ΔV_rep (repetibilidade, Tipo A, u = s(V0)/√n, ν = n − 1) e ΔV_men (leitura do menisco, Tipo B, ν = ∞). cg-19 §7.1.5 / ISO 4787 usam n = 10 enchimentos → ν = 9.",
    },
    {
      ref: "cg-19 §6.7 Eq. (28) / §6.8 / EA-4/02 Apêndice E",
      note: "Fator de abrangência k NÃO fixado em 2: ν_eff estimado por Welch–Satterthwaite e k de Student-t para 95 % derivado pelo motor. A parcela ΔV_rep, de ν finito, torna ν_eff finito → k > 1,96 (cf. cg-19 §7.1.5: ν_eff = 19 → k ≈ 2,15).",
    },
  ],
  verificarItems: [
    {
      ref: "cg-19 §6.3.4 / CIPM",
      item: "As INCERTEZAS-PADRÃO de entrada são valores REPRESENTATIVOS, retirados do exemplo trabalhado da cg-19 v4.1 §7.1 (Tabela 2). O metrologista deve substituí-las pelas dos seus próprios certificados (balança, termômetro, jogo de pesos, densidade do ar) e pela série de repetibilidade do laboratório.",
      severity: "action",
      fieldKeys: ["I_L", "I_E", "t_w", "rho_a", "rho_b", "gamma", "dv_men", "dv_rep"],
    },
    {
      ref: "cg-19 §6.3.4",
      item: "ρ_A é tomada como entrada; cg-19 §6.3.4 a deriva de T/P/UR ambientes (CIPM). Inserida diretamente nesta versão.",
      severity: "action",
      fieldKeys: ["rho_a"],
    },
    {
      ref: "cg-19 §6.3.5",
      item: "ρ_B (densidade dos pesos de referência) vem do certificado do jogo de pesos ou da classe OIML R 111-1; o padrão 8,0 g/mL é apenas representativo.",
      severity: "action",
      fieldKeys: ["rho_b"],
    },
    {
      ref: "cg-19 §6.3.9 / ISO 4787",
      item: "ΔV_rep (repetibilidade): magnitude provisória; o laboratório define u = s(V0)/√n da sua própria série. Os graus de liberdade ν = n − 1 (n = 10 enchimentos → ν = 9) é o que torna ν_eff finito e faz o motor derivar k > 1,96.",
      severity: "action",
      fieldKeys: ["dv_rep"],
    },
    {
      ref: "cg-19 §6.3.7.1",
      item: "ΔV_men (leitura do menisco): magnitude provisória, distribuição retangular (divisor √3) ou triangular (divisor √6) conforme o arranjo óptico; o laboratório informa a incerteza-padrão já reduzida.",
      severity: "action",
      fieldKeys: ["dv_men"],
    },
    {
      item: "O slug do tipo de equipamento é 'pipeta' — vale também para balão volumétrico / bureta.",
      severity: "info",
    },
    {
      ref: "cg-19 §3 (nota)",
      item: "Coeficiente de expansão cúbica = 3 × linear (cg-19 §3, nota).",
      severity: "action",
      fieldKeys: ["gamma"],
    },
    {
      ref: "cg-19 §6.6",
      item: "Sem correlações modeladas entre as grandezas de entrada (p.ex. densidade-da-água/temperatura tratadas pela ρ_W(t_w) embutida).",
      severity: "info",
    },
  ],
  omittedComponents: [
    {
      ref: "cg-19 §6.3.7.2",
      component: "manuseio do instrumento (pipetas de pistão)",
      appliesWhen: "instrumentos de pistão ou variabilidade de manuseio relevante",
    },
    {
      ref: "cg-19 §6.3.8",
      component: "evaporação",
      appliesWhen: "exposição prolongada ou balança sem proteção",
    },
  ],
  workedExample: {
    scenarioKey: "balao_100mL_20C",
    provenance: "engine_characterization",
    source: "Motor (modo decimal); k = 2.1059 derivado de ν_eff = 17.43 (Welch–Satterthwaite, Student-t 95 %)",
    expected: {
      estimate: 100.104665735215,
      standardUncertainty: 0.01651493136661448,
      expandedUncertainty: 0.03477844990678303,
    },
  },
  reviewStatus: "draft_pending_revalidation",
};

export const volumeGlasswareTemplate: TemplateModule = {
  key: "volume-glassware",
  templateVersion: 2,
  discipline: "volume",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-19 v4.1", "ISO 4787:2010", "EA-4/02 M:2022"],
  buildDraft,
  productDefinition: volumeProductDefinition,
  previewScenarios,
  governance,
};
