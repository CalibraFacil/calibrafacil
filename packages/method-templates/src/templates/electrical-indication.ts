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
 * DC voltage indication-error calibration of a digital multimeter (DMM) against
 * a reference DC source/calibrator.
 *
 * ⚠️ DRAFT — pending metrologist review. The uncertainty model below was
 * checked against the cited guide text (not just attributed to it):
 *   - EURAMET cg-15 v2.0 "Guidelines on the Calibration of Digital Multimeters"
 *     (formerly EA-10/15):
 *     https://www.euramet.org/Media/docs/Publications/calguides/EURAMET_cg-15__v_2.0_Guidelines_Calibration_Digital_Multimeters.pdf
 *   - EA-4/02 M:2022 "Evaluation of the Uncertainty of Measurement in
 *     Calibration": https://www.enac.es/documents/7020/635abf3f-262a-4b3b-952f-10336cdfae9e
 *
 * Conformance to cg-15 (read from the v2.0 text):
 *   - §5.1.4.1 — reported quantity is "Error of Indication" = Instrument Reading
 *     − Applied Value ⇒ E = indicação − referência.
 *   - §5.1.5.1 — the reported uncertainty "take[s] into account the resolution
 *     and the short-term instability of the instrument", combined with the
 *     reference (calibration) uncertainty. Those are exactly the three
 *     components modelled here.
 *   - §5.1.5.4 — resolution is a RECTANGULAR component of width = N digits of
 *     resolution (N = 1 for a stable reading) ⇒ u = (resolução/2)/√3; other
 *     contributions are normal; combined per EA-4/02.
 *   - §5.1.5.3 — expanded uncertainty U = k·u_c with k = 2 (~95%).
 *
 * [VERIFICAR] SCOPE: DC voltage only (cg-15 also covers DC current, resistance,
 * AC voltage/current — Tables 1–2). AC is DEFERRED for v1. DC current and
 * resistance use the identical indication-error + RSS model with their own units
 * (separate templates, to be added after review).
 *
 * The template authors a SINGLE product-format definition; the compilable draft
 * is derived via the shared buildDraftFromProduct.
 */

const METHOD_NAME = "Calibração de Multímetro (Tensão DC) por Erro de Indicação";
const DMM_ASSET_TYPE_SLUG = "multimetro-digital";
const methodDescription =
  "Calibração de multímetros digitais em tensão contínua (DC) por comparação direta da indicação contra uma fonte/calibrador de referência. Erro de indicação E = leitura média − valor aplicado (cg-15 §5.1.4.1); incerteza combinando repetibilidade/instabilidade de curto prazo (Tipo A), resolução (retangular, cg-15 §5.1.5.4) e a incerteza do padrão, conforme EA-4/02, com k = 2 (cg-15 §5.1.5.3). DC apenas; AC adiado. Rascunho pendente de revisão metrológica.";

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
    // cg-15 §4.1 + EA-4/02: the reference (calibrator) calibration uncertainty.
    // [VERIFICAR] enter the EXPANDED uncertainty U from the source's certificate;
    // reduced to a standard uncertainty below by the certificate's k.
    key: "incerteza_referencia",
    label: "Incerteza expandida do padrão (U)",
    type: "number",
    unit: "V",
    quantityKind: "uncertainty",
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
    // [VERIFICAR] 3 repeated readings assumed; arithmetic mean. cg-15 §5.1.5.1
    // treats short-term instability of the reading as a contribution.
    expression: "(leitura_1 + leitura_2 + leitura_3) / 3",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "auxiliary", group: "raw_calculation" },
  },
  {
    outputKey: "erro",
    label: "Erro de indicação (E)",
    // cg-15 §5.1.4.1: E = Instrument Reading − Applied Value. CONFIRMED vs guide.
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
    // cg-15 §5.1.5.4: rectangular component, width = N digits of resolution
    // (N=1 stable reading) ⇒ half-width resolução/2, divisor √3. CONFIRMED vs guide.
    expression: "(resolucao / 2) / sqrt(3)",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_referencia",
    label: "Incerteza do padrão de referência",
    // cg-15 §4.1 / EA-4/02: calibration uncertainty of the reference.
    // [VERIFICAR] k_ref=2 ASSUMED to reduce the cert's EXPANDED U to standard u —
    // read the actual k from the reference standard's certificate.
    expression: "incerteza_referencia / 2",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_combinada",
    label: "Incerteza-padrão combinada",
    // EA-4/02: combination by RSS of the three cg-15 §5.1.5.1 contributions
    // (repeatability, resolution, reference). [VERIFICAR] add any lab-specific
    // contribution (e.g. thermal EMF if zero is not nulled per cg-15 §3.4.6.1,
    // input-loading) when the setup requires it.
    expression:
      "sqrt(u_repetibilidade ^ 2 + u_resolucao ^ 2 + u_referencia ^ 2)",
    scope: ROW_SCOPE,
    unit: "V",
    reporting: { role: "uncertainty_component", group: "uncertainty_budget" },
  },
  {
    outputKey: "u_expandida",
    label: "Incerteza expandida (U)",
    // cg-15 §5.1.5.3: U = k·u_c, k = 2 (~95%). [VERIFICAR] §5.1.5.4 notes k may
    // fall toward 1.65 when the rectangular (resolution) component dominates; the
    // guide recommends k=2 overall, which is used here.
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

const certificateContent = {
  procedureCode: "[VERIFICAR]",
  referenceStandards: ["EURAMET cg-15 v2.0", "EA-4/02"],
  certifiedValuesDisplay: "hidden",
  uncertaintyBudgetDisplay: "full",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por comparação direta entre a tensão DC aplicada de referência (fonte/calibrador) e a indicação do multímetro. O erro de indicação é E = leitura média − valor aplicado (EURAMET cg-15 §5.1.4.1).",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        { term: "VC", definition: "Valor convencional da tensão aplicada de referência." },
        { term: "E", definition: "Erro de indicação (indicação − VC)." },
        { term: "U", definition: "Incerteza expandida (k = 2)." },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza-padrão combinada foi determinada conforme a EA-4/02, combinando por soma quadrática as contribuições de repetibilidade/instabilidade de curto prazo, resolução (componente retangular, cg-15 §5.1.5.4) e do padrão de referência (cg-15 §5.1.5.1).",
        "A incerteza expandida de medição é declarada como a incerteza-padrão multiplicada por um fator de abrangência k = 2, correspondendo a uma probabilidade de abrangência de aproximadamente 95% (cg-15 §5.1.5.3).",
        "[VERIFICAR] Aplica-se somente a tensão DC. AC adiado. Quando a resolução domina, cg-15 §5.1.5.4 indica que k pode tender a 1,65; adota-se k = 2 conforme recomendação do guia.",
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
// metrology MODEL is checked against cg-15 (see header) but [VERIFICAR] items
// remain for the metrologist.
const previewScenarios: readonly MethodPreviewScenario[] = [
  {
    key: "ponto_10V",
    label: "Ponto de 10 V DC, U_padrão 5 mV, resolução 1 mV",
    inputs: {
      pontos_tensao: [
        {
          valor_referencia: 10,
          incerteza_referencia: 0.005,
          resolucao: 0.001,
          leitura_1: 10.002,
          leitura_2: 10.001,
          leitura_3: 10.003,
        },
      ],
    },
    expected: {
      // Hand-checked: E = 10.002 − 10 = 0.002 V; s = 0.001 V;
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

export const electricalIndicationTemplate: TemplateModule = {
  key: "electrical-indication",
  templateVersion: 1,
  discipline: "voltage",
  defaultName: METHOD_NAME,
  defaultAccreditedScope: false,
  citations: ["EURAMET cg-15 v2.0", "EA-4/02"],
  buildDraft,
  productDefinition: electricalProductDefinition,
  previewScenarios,
};
