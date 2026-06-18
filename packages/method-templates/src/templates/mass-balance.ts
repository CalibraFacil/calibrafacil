import type { MethodDraft } from "@calibra-facil/method-definition";

import { buildDraftFromProduct } from "../product-to-draft";
import type { BuildDraftArgs } from "../types";

/**
 * Exemplo "Calibração Rastreável de Balanças - FOR 50/51" — mass indication-error
 * method (indication before/after adjustment, repeatability, eccentricity,
 * weight composition, full GUM uncertainty budget).
 *
 * This is a faithful extraction of the draft-builder in
 * `packages/db/scripts/seed-exemplo-balance-method.mjs`. `buildDraft` produces the
 * exact same draft that seed's `buildDefinitionDraft` produced, so it
 * reproduces the production method fingerprint
 * `method:a614c64c40b142acec5681ffe73c8de04b15fa223300103599efdde750394da4`
 * (asserted by `fingerprint.test.ts`). The seed script imports `buildDraft`
 * from here so there is a single source of truth.
 *
 * NOTE: `certificateContent` and `uncertaintyParams` live with the seed/DB row,
 * NOT in the draft — they are not part of `buildDefinitionDraft` and do not
 * affect the fingerprint, so they are intentionally not ported here.
 */

export const METHOD_NAME = "Calibração Rastreável de Balanças - FOR 50/51";
export const BALANCE_ASSET_TYPE_SLUG = "balanca-digital";
export const methodDescription =
  "Método importado do workbook FOR 50/FOR 51 rastreável da Laboratório Exemplo, contemplando indicação antes e após ajuste, repetibilidade, excentricidade, composição de pesos e orçamento de incerteza com resolução por faixa, repetibilidade, erro dos pesos, incerteza dos pesos, empuxo, deriva e excentricidade. As condições ambientais são registradas pelo fluxo de execução e congeladas no job.";

function safeVeffExpression(
  combinedUncertaintyKey: string,
  repeatabilityKey: string,
): string {
  return `if_zero(${repeatabilityKey}, 1000000000, ((${combinedUncertaintyKey} ^ 4) / ((${repeatabilityKey} ^ 4) / 2)))`;
}

function safeCoverageFactorExpression(
  veffKey: string,
  repeatabilityKey: string,
): string {
  return `if_zero(${repeatabilityKey}, 2, student_t_inverse_2t(0.0455, ${veffKey}))`;
}

const rowScope = (tableKey: string) => ({ kind: "table_row", tableKey });

export const dataFields = [
  {
    key: "pontos_indicacao",
    type: "table",
    label: "Resultados de indicação",
    required: true,
    phaseBlockKey: "indication",
    phaseBlockLabel: "Indicação",
    weighingRangeResolver: {
      enabled: true,
      assetSpecKey: "weighingRanges",
      pointColumn: "carga_nominal",
      pointUnit: "g",
      targetColumns: {
        resolution: "divisao",
      },
    },
    columns: [
      {
        key: "carga_nominal",
        type: "number",
        unit: "g",
        label: "Carga nominal",
      },
      {
        key: "valor_padrao",
        type: "number",
        unit: "g",
        label: "Valor convencional",
      },
      {
        key: "composicao",
        type: "text",
        label: "Composição dos pesos",
        role: "mass_standard_composition",
        massComposition: {
          targetUnit: "g",
          optionSource: "composition_profiles",
          targetColumns: {
            certifiedValue: "valor_padrao",
            compositionLabel: "composicao",
            expandedUncertainty: "incerteza_pesos",
            maxError: "erro_maximo_pesos",
            buoyancy: "efeito_empuxo",
            drift: "deriva_pesos",
          },
          uncertaintyMode: "expanded_rss",
          quantityMode: "profile_linear",
        },
      },
      { key: "divisao", type: "number", unit: "g", label: "Divisão usada" },
      {
        key: "erro_maximo_pesos",
        type: "number",
        unit: "g",
        label: "Erro máximo dos pesos",
      },
      {
        key: "incerteza_pesos",
        type: "number",
        unit: "g",
        label: "Incerteza dos pesos",
      },
      {
        key: "efeito_empuxo",
        type: "number",
        unit: "g",
        label: "Efeito empuxo",
      },
      {
        key: "deriva_pesos",
        type: "number",
        unit: "g",
        label: "Deriva dos pesos",
      },
      {
        key: "antes_leitura_1",
        type: "number",
        unit: "g",
        label: "Leitura 1",
        phase: "before",
      },
      {
        key: "antes_leitura_2",
        type: "number",
        unit: "g",
        label: "Leitura 2",
        phase: "before",
      },
      {
        key: "antes_leitura_3",
        type: "number",
        unit: "g",
        label: "Leitura 3",
        phase: "before",
      },
      {
        key: "apos_leitura_1",
        type: "number",
        unit: "g",
        label: "Leitura 1",
        phase: "after",
      },
      {
        key: "apos_leitura_2",
        type: "number",
        unit: "g",
        label: "Leitura 2",
        phase: "after",
      },
      {
        key: "apos_leitura_3",
        type: "number",
        unit: "g",
        label: "Leitura 3",
        phase: "after",
      },
    ],
  },
  {
    key: "repetibilidade",
    type: "table",
    label: "Repetibilidade",
    required: true,
    phaseBlockKey: "repeatability",
    phaseBlockLabel: "Repetibilidade",
    columns: [
      { key: "condicao", type: "text", label: "Condição" },
      {
        key: "leitura_1",
        type: "number",
        unit: "g",
        label: "Leitura 1",
        phase: "before",
      },
      {
        key: "leitura_2",
        type: "number",
        unit: "g",
        label: "Leitura 2",
        phase: "before",
      },
      {
        key: "leitura_3",
        type: "number",
        unit: "g",
        label: "Leitura 3",
        phase: "before",
      },
      {
        key: "leitura_4",
        type: "number",
        unit: "g",
        label: "Leitura 4",
        phase: "before",
      },
      {
        key: "leitura_5",
        type: "number",
        unit: "g",
        label: "Leitura 5",
        phase: "before",
      },
      {
        key: "apos_leitura_1",
        type: "number",
        unit: "g",
        label: "Leitura 1",
        phase: "after",
      },
      {
        key: "apos_leitura_2",
        type: "number",
        unit: "g",
        label: "Leitura 2",
        phase: "after",
      },
      {
        key: "apos_leitura_3",
        type: "number",
        unit: "g",
        label: "Leitura 3",
        phase: "after",
      },
      {
        key: "apos_leitura_4",
        type: "number",
        unit: "g",
        label: "Leitura 4",
        phase: "after",
      },
      {
        key: "apos_leitura_5",
        type: "number",
        unit: "g",
        label: "Leitura 5",
        phase: "after",
      },
    ],
  },
  {
    key: "excentricidade",
    type: "table",
    label: "Excentricidade",
    required: true,
    phaseBlockKey: "eccentricity",
    phaseBlockLabel: "Excentricidade",
    eccentricityIndicator: {
      enabled: true,
      variant: "circular_platform",
      pointColumn: "posicao",
      loadPoints: ["A", "B", "C", "D", "E"],
    },
    columns: [
      { key: "posicao", type: "text", label: "Posição" },
      {
        key: "antes",
        type: "number",
        unit: "g",
        label: "Antes do ajuste",
        phase: "before",
      },
      {
        key: "apos",
        type: "number",
        unit: "g",
        label: "Após o ajuste",
        phase: "after",
      },
    ],
  },
  {
    key: "observacao",
    type: "text",
    label: "Observação",
    required: false,
  },
];

export const formulas: Record<string, unknown>[] = [
  {
    outputKey: "media_indicacao_antes",
    label: "Média por ponto antes do ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression:
      "(pontos_indicacao_antes_leitura_1 + pontos_indicacao_antes_leitura_2 + pontos_indicacao_antes_leitura_3) / 3",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "erro_indicacao_antes",
    label: "Erro de indicação antes do ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "media_indicacao_antes - pontos_indicacao_valor_padrao",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "u_resolucao",
    label: "Incerteza da resolução",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "pontos_indicacao_divisao / sqrt(12)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_repetibilidade_indicacao_antes",
    label: "Incerteza por repetibilidade antes do ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression:
      "std([pontos_indicacao_antes_leitura_1, pontos_indicacao_antes_leitura_2, pontos_indicacao_antes_leitura_3], 1) / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_erro_pesos",
    label: "Incerteza por erro máximo dos pesos",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "pontos_indicacao_erro_maximo_pesos / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_incerteza_pesos",
    label: "Incerteza dos pesos padrão",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "pontos_indicacao_incerteza_pesos / 2",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_empuxo",
    label: "Incerteza por efeito de empuxo",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "pontos_indicacao_efeito_empuxo / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_deriva",
    label: "Incerteza por deriva dos pesos",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "pontos_indicacao_deriva_pesos / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_excentricidade_antes",
    label: "Incerteza por excentricidade antes do ajuste",
    unit: "g",
    expression:
      "(max(excentricidade_antes) - min(excentricidade_antes)) / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_combinada_antes",
    label: "Incerteza combinada antes do ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression:
      "sqrt((u_resolucao ^ 2) + (u_repetibilidade_indicacao_antes ^ 2) + (u_erro_pesos ^ 2) + (u_incerteza_pesos ^ 2) + (u_empuxo ^ 2) + (u_deriva ^ 2) + (u_excentricidade_antes ^ 2))",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "veff_antes",
    label: "Graus de liberdade efetivos antes do ajuste",
    scope: rowScope("pontos_indicacao"),
    expression: safeVeffExpression(
      "u_combinada_antes",
      "u_repetibilidade_indicacao_antes",
    ),
    reporting: {
      includeInCertificate: true,
      role: "auxiliary",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "fator_k_antes",
    label: "Fator de abrangência antes do ajuste",
    scope: rowScope("pontos_indicacao"),
    expression: safeCoverageFactorExpression(
      "veff_antes",
      "u_repetibilidade_indicacao_antes",
    ),
    reporting: {
      includeInCertificate: true,
      role: "coverage_factor",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "incerteza_expandida_antes",
    label: "Incerteza expandida antes do ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "fator_k_antes * u_combinada_antes",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
  {
    outputKey: "media_indicacao_apos",
    label: "Média por ponto após o ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression:
      "(pontos_indicacao_apos_leitura_1 + pontos_indicacao_apos_leitura_2 + pontos_indicacao_apos_leitura_3) / 3",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "erro_indicacao_apos",
    label: "Erro de indicação após o ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "media_indicacao_apos - pontos_indicacao_valor_padrao",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "u_repetibilidade_indicacao_apos",
    label: "Incerteza por repetibilidade após o ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression:
      "std([pontos_indicacao_apos_leitura_1, pontos_indicacao_apos_leitura_2, pontos_indicacao_apos_leitura_3], 1) / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_excentricidade_apos",
    label: "Incerteza por excentricidade após o ajuste",
    unit: "g",
    expression:
      "(max(excentricidade_apos) - min(excentricidade_apos)) / sqrt(3)",
    reporting: {
      includeInCertificate: true,
      role: "uncertainty_component",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "u_combinada_apos",
    label: "Incerteza combinada após o ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression:
      "sqrt((u_resolucao ^ 2) + (u_repetibilidade_indicacao_apos ^ 2) + (u_erro_pesos ^ 2) + (u_incerteza_pesos ^ 2) + (u_empuxo ^ 2) + (u_deriva ^ 2) + (u_excentricidade_apos ^ 2))",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "veff_apos",
    label: "Graus de liberdade efetivos após o ajuste",
    scope: rowScope("pontos_indicacao"),
    expression: safeVeffExpression(
      "u_combinada_apos",
      "u_repetibilidade_indicacao_apos",
    ),
    reporting: {
      includeInCertificate: true,
      role: "auxiliary",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "fator_k_apos",
    label: "Fator de abrangência após o ajuste",
    scope: rowScope("pontos_indicacao"),
    expression: safeCoverageFactorExpression(
      "veff_apos",
      "u_repetibilidade_indicacao_apos",
    ),
    reporting: {
      includeInCertificate: true,
      role: "coverage_factor",
      group: "uncertainty_budget",
    },
  },
  {
    outputKey: "incerteza_expandida_apos",
    label: "Incerteza expandida após o ajuste",
    unit: "g",
    scope: rowScope("pontos_indicacao"),
    expression: "fator_k_apos * u_combinada_apos",
    reporting: {
      includeInCertificate: true,
      role: "expanded_uncertainty",
      group: "calibration_result",
    },
  },
  {
    outputKey: "repetibilidade_desvio",
    label: "Repetibilidade por condição",
    unit: "g",
    scope: rowScope("repetibilidade"),
    expression:
      "std([repetibilidade_leitura_1, repetibilidade_leitura_2, repetibilidade_leitura_3, repetibilidade_leitura_4, repetibilidade_leitura_5], 1)",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "maior_repetibilidade",
    label: "Maior repetibilidade",
    unit: "g",
    expression: "max(repetibilidade_desvio)",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "repetibilidade_desvio_apos",
    label: "Repetibilidade após ajuste por condição",
    unit: "g",
    scope: rowScope("repetibilidade"),
    expression:
      "std([repetibilidade_apos_leitura_1, repetibilidade_apos_leitura_2, repetibilidade_apos_leitura_3, repetibilidade_apos_leitura_4, repetibilidade_apos_leitura_5], 1)",
    reporting: {
      includeInCertificate: false,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_excentricidade_antes",
    label: "Desvio de excentricidade antes do ajuste",
    unit: "g",
    scope: rowScope("excentricidade"),
    expression: "excentricidade_antes - mean(excentricidade_antes)",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_excentricidade_antes_abs",
    label: "Desvio absoluto de excentricidade antes do ajuste",
    unit: "g",
    scope: rowScope("excentricidade"),
    expression: "abs(desvio_excentricidade_antes)",
    reporting: {
      includeInCertificate: false,
      role: "auxiliary",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_excentricidade_apos_abs",
    label: "Desvio absoluto de excentricidade após o ajuste",
    unit: "g",
    scope: rowScope("excentricidade"),
    expression: "abs(desvio_excentricidade_apos)",
    reporting: {
      includeInCertificate: false,
      role: "auxiliary",
      group: "calibration_result",
    },
  },
  {
    outputKey: "maior_desvio_excentricidade_antes",
    label: "Maior desvio de excentricidade antes do ajuste",
    unit: "g",
    expression: "max(desvio_excentricidade_antes_abs)",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "desvio_excentricidade_apos",
    label: "Desvio de excentricidade após o ajuste",
    unit: "g",
    scope: rowScope("excentricidade"),
    expression: "excentricidade_apos - mean(excentricidade_apos)",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
  {
    outputKey: "maior_desvio_excentricidade_apos",
    label: "Maior desvio de excentricidade após o ajuste",
    unit: "g",
    expression: "max(desvio_excentricidade_apos_abs)",
    reporting: {
      includeInCertificate: true,
      role: "primary_result",
      group: "calibration_result",
    },
  },
];

// Phase metadata for row-scoped formulas. The seed attaches this to each
// formula BEFORE compiling (a module-level mutation), so it flows into the
// compiled formula metadata and into the method fingerprint — it is NOT merely
// post-compile enrichment.
type PhaseMetadata = { phaseBlock: string; phase: string };
const phaseFormulaMetadata = new Map<string, PhaseMetadata>([
  ...[
    "media_indicacao_antes",
    "erro_indicacao_antes",
    "u_repetibilidade_indicacao_antes",
    "u_combinada_antes",
    "veff_antes",
    "fator_k_antes",
    "incerteza_expandida_antes",
  ].map((key): [string, PhaseMetadata] => [
    key,
    { phaseBlock: "indication", phase: "before" },
  ]),
  ...[
    "media_indicacao_apos",
    "erro_indicacao_apos",
    "u_repetibilidade_indicacao_apos",
    "u_combinada_apos",
    "veff_apos",
    "fator_k_apos",
    "incerteza_expandida_apos",
  ].map((key): [string, PhaseMetadata] => [
    key,
    { phaseBlock: "indication", phase: "after" },
  ]),
  ...["repetibilidade_desvio", "maior_repetibilidade"].map(
    (key): [string, PhaseMetadata] => [
      key,
      { phaseBlock: "repeatability", phase: "before" },
    ],
  ),
  ...["repetibilidade_desvio_apos"].map((key): [string, PhaseMetadata] => [
    key,
    { phaseBlock: "repeatability", phase: "after" },
  ]),
  ...[
    "desvio_excentricidade_antes",
    "desvio_excentricidade_antes_abs",
    "maior_desvio_excentricidade_antes",
  ].map((key): [string, PhaseMetadata] => [
    key,
    { phaseBlock: "eccentricity", phase: "before" },
  ]),
  ...[
    "desvio_excentricidade_apos",
    "desvio_excentricidade_apos_abs",
    "maior_desvio_excentricidade_apos",
  ].map((key): [string, PhaseMetadata] => [
    key,
    { phaseBlock: "eccentricity", phase: "after" },
  ]),
]);

for (const formula of formulas) {
  const key = formula.outputKey;
  if (typeof key !== "string") continue;
  const metadata = phaseFormulaMetadata.get(key);
  if (metadata) {
    formula.metadata = metadata;
  }
}

export const validations: unknown[] = [];

export const uncertaintyParams: unknown[] = [];

/**
 * Certificate-content template. NOT part of `buildDraft`/the fingerprint — the
 * seed stores it on the `calibration_method` row, and the from-template route
 * carries it into the new method. Exported raw so the seed writes a byte-
 * identical row.
 */
export const certificateContent = {
  procedureCode: "PBT09",
  referenceStandards: ["UKAS LAB 14", "EURAMET cg-18"],
  certifiedValuesDisplay: "hidden",
  massCompositionDisplay: "hidden",
  uncertaintyBudgetDisplay: "hidden",
  sections: [
    {
      kind: "paragraphs",
      title: "MÉTODO",
      paragraphs: [
        "A calibração é realizada por meio de comparação direta entre os valores dos pesos padrão e a indicação da balança.",
      ],
    },
    {
      kind: "definition_list",
      title: "CONVENÇÕES",
      items: [
        {
          term: "VC",
          definition:
            "Valor Convencional, valor correspondente ao padrão utilizado.",
        },
        {
          term: "EI",
          definition: "Erro de Indicação, (VI - VC).",
        },
        {
          term: "U",
          definition: "Incerteza expandida.",
        },
      ],
    },
    {
      kind: "paragraphs",
      title: "INCERTEZA DE MEDIÇÃO",
      paragraphs: [
        "A incerteza expandida de medição relatada é declarada como a incerteza padrão de medição multiplicada pelo fator de abrangência k, o qual para uma distribuição t-Student, com Veff graus de liberdade efetivos corresponde a uma probabilidade de abrangência de aproximadamente 95%.",
        "A incerteza padrão de medição foi determinada de acordo com a publicação EA-4/02. Os valores de k e Veff são apresentados na tabela de resultados.",
      ],
    },
    {
      kind: "bullets",
      items: [
        "Os resultados deste certificado referem-se exclusivamente ao instrumento submetido à calibração específica, não sendo extensivo a quaisquer lotes.",
        "Este certificado não tem valor para fins de metrologia legal.",
        "Os resultados são válidos somente para o estado do instrumento no momento da calibração.",
      ],
    },
  ],
};
export function buildDraft(args: BuildDraftArgs = {}): MethodDraft {
  return buildDraftFromProduct(
    {
      name: METHOD_NAME,
      description: methodDescription,
      assetTypeId: BALANCE_ASSET_TYPE_SLUG,
      dataFields,
      formulas,
      validations,
      // Must stay "seed-exemplo-balance-method" — this is part of the fingerprint.
      metadata: {
        validationStatus: "pending_revalidation",
        source: "seed-exemplo-balance-method",
      },
    },
    args,
  );
}
