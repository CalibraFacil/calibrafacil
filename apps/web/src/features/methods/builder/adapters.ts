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
