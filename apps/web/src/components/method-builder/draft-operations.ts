import type {
  MethodDraft,
  MethodDraftCertificateContent,
  MethodDraftFormula,
  MethodDraftInput,
  MethodDraftInputType,
  MethodDraftMeasurementModel,
  MethodDraftMeasurementModelSource,
  MethodDraftUncertaintyComponent,
  MethodDraftValidation,
  MethodDraftVariableBinding,
} from './types'

export function applyDraftPatch(
  draft: MethodDraft,
  patch: Partial<MethodDraft>,
): MethodDraft {
  return { ...draft, ...patch }
}

export function addDraftInput(draft: MethodDraft): MethodDraft {
  return applyDraftPatch(draft, {
    inputs: [
      ...draft.inputs,
      {
        key: `input_${draft.inputs.length + 1}`,
        label: 'Novo campo',
        type: 'number',
        required: false,
      },
    ],
  })
}

export function updateDraftInput(
  draft: MethodDraft,
  index: number,
  patch: Partial<MethodDraftInput>,
): MethodDraft {
  return applyDraftPatch(draft, {
    inputs: draft.inputs.map((input, itemIndex) =>
      itemIndex === index ? { ...input, ...patch } : input,
    ),
  })
}

export function setDraftInputType(
  draft: MethodDraft,
  index: number,
  type: MethodDraftInputType,
): MethodDraft {
  const input = draft.inputs[index]
  if (!input) return draft

  const nextInput: MethodDraftInput = {
    key: input.key,
    label: input.label,
    type,
    unit: input.unit,
    required: input.required,
    options: input.options,
    defaultValue: input.defaultValue,
    source: type === 'table' ? 'manual' : (input.source ?? 'manual'),
    assetSpecKey: type === 'table' ? undefined : input.assetSpecKey,
    allowOverride: type === 'table' ? undefined : input.allowOverride,
    eccentricityIndicator:
      type === 'table' ? input.eccentricityIndicator : undefined,
    weighingRangeResolver:
      type === 'table' ? input.weighingRangeResolver : undefined,
    columns:
      type === 'table'
        ? (input.columns ?? [
            {
              key: 'value',
              label: 'Valor',
              type: 'number',
            },
          ])
        : undefined,
  }

  return applyDraftPatch(draft, {
    inputs: draft.inputs.map((item, itemIndex) =>
      itemIndex === index ? nextInput : item,
    ),
  })
}

export function addDraftFormula(draft: MethodDraft): MethodDraft {
  return applyDraftPatch(draft, {
    formulas: [
      ...draft.formulas,
      {
        outputKey: `result_${draft.formulas.length + 1}`,
        label: 'Resultado',
        expression: '',
        scope: { kind: 'scalar' },
      },
    ],
  })
}

export function updateDraftFormula(
  draft: MethodDraft,
  index: number,
  patch: Partial<MethodDraftFormula>,
): MethodDraft {
  return applyDraftPatch(draft, {
    formulas: draft.formulas.map((formula, itemIndex) =>
      itemIndex === index ? { ...formula, ...patch } : formula,
    ),
  })
}

export function addDraftMeasurementModel(draft: MethodDraft): MethodDraft {
  const firstTable = draft.inputs.find((input) => input.type === 'table')
  return applyDraftPatch(draft, {
    measurementModels: [
      ...draft.measurementModels,
      {
        key: `gum_model_${draft.measurementModels.length + 1}`,
        label: 'Modelo GUM',
        scope: firstTable
          ? { kind: 'table_row', tableKey: firstTable.key }
          : { kind: 'scalar' },
        measurand: 'y',
        expression: 'y',
        quantities: [
          {
            symbol: 'y',
            source: firstNumericSource(
              draft.inputs,
              draft.formulas,
              firstTable?.key,
            ),
            uncertainty: {
              kind: 'direct_standard_uncertainty',
              standardUncertainty: 0,
              degreesOfFreedom: 'Infinity',
            },
          },
        ],
        coverageProbability: 0.9545,
      },
    ],
  })
}

export function updateDraftMeasurementModel(
  draft: MethodDraft,
  index: number,
  patch: Partial<MethodDraftMeasurementModel>,
): MethodDraft {
  return applyDraftPatch(draft, {
    measurementModels: draft.measurementModels.map((model, itemIndex) =>
      itemIndex === index ? { ...model, ...patch } : model,
    ),
  })
}

export function addDraftValidation(draft: MethodDraft): MethodDraft {
  return applyDraftPatch(draft, {
    validations: [
      ...draft.validations,
      {
        leftExpression: '',
        operator: '<=',
        rightExpression: '',
        message: 'Critério não atendido',
        severity: 'error',
      },
    ],
  })
}

export function updateDraftValidation(
  draft: MethodDraft,
  index: number,
  patch: Partial<MethodDraftValidation>,
): MethodDraft {
  return applyDraftPatch(draft, {
    validations: draft.validations.map((validation, itemIndex) =>
      itemIndex === index ? { ...validation, ...patch } : validation,
    ),
  })
}

export function addDraftUncertainty(draft: MethodDraft): MethodDraft {
  return applyDraftPatch(draft, {
    uncertainty: [
      ...draft.uncertainty,
      {
        name: 'Componente',
        value: 0.01,
        distribution: 'normal',
        degreesOfFreedom: 50,
      },
    ],
  })
}

export function updateDraftUncertainty(
  draft: MethodDraft,
  index: number,
  patch: Partial<MethodDraftUncertaintyComponent>,
): MethodDraft {
  return applyDraftPatch(draft, {
    uncertainty: draft.uncertainty.map((component, itemIndex) =>
      itemIndex === index ? { ...component, ...patch } : component,
    ),
  })
}

export function addDraftVariable(draft: MethodDraft): MethodDraft {
  return applyDraftPatch(draft, {
    variables: [
      ...draft.variables,
      {
        key: `var_${draft.variables.length + 1}`,
        label: 'Variável',
        source: 'data_field',
        fieldKey: draft.inputs[0]?.key ?? '',
      },
    ],
  })
}

export function updateDraftVariable(
  draft: MethodDraft,
  index: number,
  binding: MethodDraftVariableBinding,
): MethodDraft {
  return applyDraftPatch(draft, {
    variables: draft.variables.map((item, itemIndex) =>
      itemIndex === index ? binding : item,
    ),
  })
}

export function updateDraftCertificate(
  draft: MethodDraft,
  patch: Partial<MethodDraftCertificateContent>,
): MethodDraft {
  return applyDraftPatch(draft, {
    certificate: {
      referenceStandards: [],
      sections: [],
      ...draft.certificate,
      ...patch,
    },
  })
}

export function addDraftCertificateSection(draft: MethodDraft): MethodDraft {
  return updateDraftCertificate(draft, {
    sections: [
      ...(draft.certificate?.sections ?? []),
      {
        kind: 'paragraphs',
        title: 'Seção',
        paragraphs: [''],
      },
    ],
  })
}

export function updateDraftCertificateSection(
  draft: MethodDraft,
  index: number,
  section: NonNullable<MethodDraftCertificateContent['sections']>[number],
): MethodDraft {
  return updateDraftCertificate(draft, {
    sections: (draft.certificate?.sections ?? []).map((item, itemIndex) =>
      itemIndex === index ? section : item,
    ),
  })
}

export function removeDraftCertificateSection(
  draft: MethodDraft,
  index: number,
): MethodDraft {
  return updateDraftCertificate(draft, {
    sections: (draft.certificate?.sections ?? []).filter(
      (_, itemIndex) => itemIndex !== index,
    ),
  })
}

export function firstNumericSource(
  inputs: Array<MethodDraftInput>,
  formulas: Array<MethodDraftFormula>,
  tableKey?: string,
): MethodDraftMeasurementModelSource {
  const tableInput = tableKey
    ? inputs.find((input) => input.type === 'table' && input.key === tableKey)
    : undefined
  const tableColumn = tableInput?.columns?.find(
    (column) => column.type === 'number',
  )
  if (tableInput && tableColumn) {
    return {
      kind: 'table_column',
      tableKey: tableInput.key,
      columnKey: tableColumn.key,
    }
  }

  const scalarFormula = formulas.find(
    (formula) =>
      !formula.scope ||
      formula.scope.kind === 'scalar' ||
      (tableKey &&
        formula.scope.kind === 'table_row' &&
        formula.scope.tableKey === tableKey),
  )
  if (scalarFormula) return { kind: 'formula', key: scalarFormula.outputKey }

  const numericInput = inputs.find((input) => input.type === 'number')
  if (numericInput) return { kind: 'input', key: numericInput.key }

  const firstTable = inputs.find((input) => input.type === 'table')
  const firstNumericColumn = firstTable?.columns?.find(
    (column) => column.type === 'number',
  )
  if (firstTable && firstNumericColumn) {
    return {
      kind: 'table_column',
      tableKey: firstTable.key,
      columnKey: firstNumericColumn.key,
    }
  }

  return { kind: 'constant', value: 0 }
}
