import {
  emptyMethodDraft,
  type MethodRecordData,
  type MethodDraft,
  type MethodDraftSavePayload,
} from './types'

export function methodDataToDraft(
  method?: MethodRecordData | null,
): MethodDraft {
  if (!method) {
    return structuredClone(emptyMethodDraft)
  }

  return {
    id: method.id,
    name: method.name ?? '',
    description: method.description ?? '',
    assetTypeId: method.assetTypeId ?? undefined,
    accreditedScope: method.accreditedScope ?? false,
    version: method.version ?? 1,
    status: method.status ?? 'DRAFT',
    inputs: method.dataFields ?? [],
    variables: method.variableBindings ?? [],
    formulas: method.formulas ?? [],
    measurementModels: method.measurementModels ?? [],
    validations: method.validations ?? [],
    uncertainty: method.uncertaintyParams ?? [],
    certificate: method.certificateContent ?? {
      referenceStandards: [],
      sections: [],
    },
  }
}

export function draftToMethodSavePayload(
  draft: MethodDraft,
): MethodDraftSavePayload {
  return {
    name: draft.name.trim(),
    description: draft.description?.trim() || null,
    assetTypeId: draft.assetTypeId ?? null,
    accreditedScope: draft.accreditedScope ?? false,
    dataFields: draft.inputs,
    variableBindings: draft.variables,
    formulas: draft.formulas,
    measurementModels: draft.measurementModels,
    validations: draft.validations,
    uncertaintyParams: draft.uncertainty,
    certificateContent: draft.certificate,
  }
}

export function cloneMethodDraft(draft: MethodDraft): MethodDraft {
  return structuredClone(draft)
}

export function draftToEngineMethodDraft(draft: MethodDraft) {
  return {
    id: String(draft.id ?? slugifyIdentifier(draft.name) ?? 'method_draft'),
    version: draft.version,
    status: mapDraftStatus(draft.status),
    name: draft.name || 'Método sem nome',
    description: draft.description || undefined,
    assetTypeId:
      draft.assetTypeId === undefined ? undefined : String(draft.assetTypeId),
    inputs: draft.inputs.map((input) => {
      if (input.type === 'number') {
        return {
          kind: 'scalar',
          key: input.key,
          label: input.label,
          unit: input.unit || undefined,
          required: Boolean(input.required),
          defaultValue: input.defaultValue,
          quantityKind: 'other',
        }
      }

      if (input.type === 'select') {
        return {
          kind: 'select',
          key: input.key,
          label: input.label,
          options: input.options ?? [],
          required: Boolean(input.required),
          defaultValue:
            typeof input.defaultValue === 'string'
              ? input.defaultValue
              : undefined,
        }
      }

      if (input.type === 'table') {
        return {
          kind: 'table',
          key: input.key,
          label: input.label,
          required: Boolean(input.required),
          columns: input.columns ?? [],
        }
      }

      return {
        kind: 'text',
        key: input.key,
        label: input.label,
        required: Boolean(input.required),
        defaultValue:
          typeof input.defaultValue === 'string'
            ? input.defaultValue
            : undefined,
      }
    }),
    formulas: draft.formulas.map((formula) => ({
      key: formula.outputKey,
      label: formula.label || formula.outputKey,
      expression: formula.expression,
      scope: formula.scope,
      outputUnit: formula.unit || undefined,
      outputKind:
        formula.reporting?.role === 'primary_result' ? 'display' : undefined,
      required: true,
      reporting: formula.reporting,
    })),
    measurementModels: draft.measurementModels,
    acceptanceCriteria: draft.validations.map((validation, index) => ({
      key: `criterion_${index + 1}`,
      label: validation.message || `Critério ${index + 1}`,
      expression: `${validation.leftExpression} ${validation.operator} ${validation.rightExpression}`,
      severity: validation.severity === 'error' ? 'blocking' : 'warning',
      message: validation.message,
    })),
    previewScenarios: [],
    metadata: {
      validationStatus: 'pending_revalidation',
      editedIn: 'method-builder',
    },
  }
}

function mapDraftStatus(status: MethodDraft['status']) {
  switch (status) {
    case 'PENDING_APPROVAL':
      return 'ready_for_review'
    case 'TECHNICAL_REVIEWED':
      return 'under_review'
    case 'PUBLISHED':
      return 'published'
    case 'ARCHIVED':
      return 'archived'
    case 'DRAFT':
    default:
      return 'draft'
  }
}

function slugifyIdentifier(value: string): string | null {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!sanitized) return null
  return /^[a-zA-Z]/.test(sanitized) ? sanitized : `method_${sanitized}`
}
