import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  CheckmarkCircle02Icon,
  Delete02Icon,
  FloppyDiskIcon,
  PlayIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'

import { cloneMethodDraft } from './adapters'
import {
  compileMethodDraft,
  previewMethodDraft,
  publishMethodDraft,
  requestMethodApproval,
} from './api'
import type {
  MethodCompileResult,
  MethodDraftCertificateContent,
  MethodDiagnostic,
  MethodDraft,
  MethodDraftFormula,
  MethodDraftInput,
  MethodDraftInputType,
  MethodDraftMeasurementModel,
  MethodDraftMeasurementModelQuantity,
  MethodDraftMeasurementModelSource,
  MethodDraftTableColumn,
  MethodDraftUncertaintyComponent,
  MethodDraftValidation,
  MethodDraftVariableBinding,
  MethodPreviewResult,
} from './types'

interface MethodBuilderProps {
  initialDraft: MethodDraft
  onSave: (draft: MethodDraft) => void | Promise<unknown>
  onCancel: () => void
  onPublished?: () => void
  isSaving?: boolean
  isNew?: boolean
}

const inputTypes: Array<MethodDraftInputType> = [
  'text',
  'number',
  'select',
  'table',
]

const validationOperators: Array<MethodDraftValidation['operator']> = [
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
]

const distributionOptions: Array<
  MethodDraftUncertaintyComponent['distribution']
> = ['normal', 'rectangular', 'triangular', 'u-shaped']

const reportingGroups: Array<
  NonNullable<MethodDraftFormula['reporting']>['group']
> = ['calibration_result', 'uncertainty_budget', 'raw_calculation']

const reportingRoles: Array<
  NonNullable<MethodDraftFormula['reporting']>['role']
> = [
  'primary_result',
  'expanded_uncertainty',
  'coverage_factor',
  'conformity_margin',
  'uncertainty_component',
  'auxiliary',
]

const formulaScopes = ['scalar', 'table_row'] as const

const measurementModelScopes = ['scalar', 'table_row'] as const

const gumUncertaintyKinds = [
  'type_a',
  'type_b',
  'direct_standard_uncertainty',
] as const

const gumDistributions = [
  'normal',
  'rectangular',
  'triangular',
  'u_shaped',
  'custom',
] as const

const certificateDisplayOptions = ['full', 'hidden'] as const

export function MethodBuilder({
  initialDraft,
  onSave,
  onCancel,
  onPublished,
  isSaving = false,
  isNew = false,
}: MethodBuilderProps) {
  const [draft, setDraft] = useState(() => cloneMethodDraft(initialDraft))
  const [sampleDataText, setSampleDataText] = useState(() =>
    JSON.stringify(buildInitialSampleData(initialDraft), null, 2),
  )
  const [compileResult, setCompileResult] =
    useState<MethodCompileResult | null>(null)
  const [previewResult, setPreviewResult] =
    useState<MethodPreviewResult | null>(null)

  const { data: assetTypesData } = useQuery({
    queryKey: ['asset-types'],
    queryFn: () => calibraApi.assetTypes.list(),
    staleTime: 60_000,
  })

  const compileMutation = useMutation({
    mutationFn: compileMethodDraft,
    onSuccess: (result) => {
      setCompileResult(result)
      setPreviewResult(null)
      toast.success('Compilação concluída')
    },
    onError: (error) => {
      toast.error(error.message)
      setCompileResult({
        diagnostics: [
          {
            severity: 'warning',
            message: `Endpoint de compilação ainda não respondeu: ${error.message}`,
          },
        ],
        normalizedFormulas: [],
      })
    },
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      const sampleData = parseJsonObject(sampleDataText)
      return previewMethodDraft({ draft, sampleData })
    },
    onSuccess: (result) => {
      setPreviewResult(result)
      toast.success('Preview calculado')
    },
    onError: (error) => {
      toast.error(error.message)
      setPreviewResult({
        diagnostics: [
          {
            severity: 'warning',
            message: `Endpoint de preview ainda não respondeu: ${error.message}`,
          },
        ],
        results: {},
      })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!draft.id) {
        throw new Error('Salve o método antes de enviar para revisão')
      }

      if (draft.status === 'DRAFT') {
        await onSave(draft)
        const sampleData = parseJsonObject(sampleDataText)
        return requestMethodApproval(draft.id, sampleData)
      }

      const sampleData = parseJsonObject(sampleDataText)
      return publishMethodDraft({
        methodId: draft.id,
        sampleData,
        reasonForChange: 'Publicação pelo Method Builder',
      })
    },
    onSuccess: () => {
      toast.success(
        draft.status === 'DRAFT'
          ? 'Método enviado para revisão'
          : 'Método publicado',
      )
      onPublished?.()
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const diagnostics = useMemo(() => {
    return [
      ...(compileResult?.diagnostics ?? []),
      ...(previewResult?.diagnostics ?? []),
    ]
  }, [compileResult, previewResult])

  const hasCompileErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  )

  function updateDraft(patch: Partial<MethodDraft>) {
    setCompileResult(null)
    setPreviewResult(null)
    setDraft((current) => ({ ...current, ...patch }))
  }

  function addInput() {
    updateDraft({
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

  function updateInput(index: number, patch: Partial<MethodDraftInput>) {
    updateDraft({
      inputs: draft.inputs.map((input, itemIndex) =>
        itemIndex === index ? { ...input, ...patch } : input,
      ),
    })
  }

  function updateInputType(index: number, type: MethodDraftInputType) {
    const input = draft.inputs[index]
    if (!input) return

    const manualInput: MethodDraftInput = {
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
    updateDraft({
      inputs: draft.inputs.map((item, itemIndex) =>
        itemIndex === index ? manualInput : item,
      ),
    })
  }

  function addFormula() {
    updateDraft({
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

  function updateFormula(index: number, patch: Partial<MethodDraftFormula>) {
    updateDraft({
      formulas: draft.formulas.map((formula, itemIndex) =>
        itemIndex === index ? { ...formula, ...patch } : formula,
      ),
    })
  }

  function addMeasurementModel() {
    const firstTable = draft.inputs.find((input) => input.type === 'table')
    updateDraft({
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

  function updateMeasurementModel(
    index: number,
    patch: Partial<MethodDraftMeasurementModel>,
  ) {
    updateDraft({
      measurementModels: draft.measurementModels.map((model, itemIndex) =>
        itemIndex === index ? { ...model, ...patch } : model,
      ),
    })
  }

  function addValidation() {
    updateDraft({
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

  function updateValidation(
    index: number,
    patch: Partial<MethodDraftValidation>,
  ) {
    updateDraft({
      validations: draft.validations.map((validation, itemIndex) =>
        itemIndex === index ? { ...validation, ...patch } : validation,
      ),
    })
  }

  function addUncertainty() {
    updateDraft({
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

  function updateUncertainty(
    index: number,
    patch: Partial<MethodDraftUncertaintyComponent>,
  ) {
    updateDraft({
      uncertainty: draft.uncertainty.map((component, itemIndex) =>
        itemIndex === index ? { ...component, ...patch } : component,
      ),
    })
  }

  function addVariable() {
    updateDraft({
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

  function updateVariable(index: number, binding: MethodDraftVariableBinding) {
    updateDraft({
      variables: draft.variables.map((item, itemIndex) =>
        itemIndex === index ? binding : item,
      ),
    })
  }

  function updateCertificate(patch: Partial<MethodDraftCertificateContent>) {
    updateDraft({
      certificate: {
        referenceStandards: [],
        sections: [],
        ...draft.certificate,
        ...patch,
      },
    })
  }

  function addCertificateSection() {
    updateCertificate({
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

  function updateCertificateSection(
    index: number,
    section: NonNullable<MethodDraftCertificateContent['sections']>[number],
  ) {
    updateCertificate({
      sections: (draft.certificate?.sections ?? []).map((item, itemIndex) =>
        itemIndex === index ? section : item,
      ),
    })
  }

  function removeCertificateSection(index: number) {
    updateCertificate({
      sections: (draft.certificate?.sections ?? []).filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    })
  }

  function handleSave() {
    onSave(draft)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {isNew ? 'Novo método' : 'Editar método'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Method Builder edita rascunhos, compila fórmulas e valida o preview
            no servidor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => compileMutation.mutate(draft)}
            disabled={compileMutation.isPending}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 h-4 w-4"
            />
            Compilar
          </Button>
          <Button
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
          >
            <HugeiconsIcon icon={PlayIcon} className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button
            variant="outline"
            onClick={() => publishMutation.mutate()}
            disabled={
              !draft.id || publishMutation.isPending || hasCompileErrors
            }
          >
            {draft.status === 'DRAFT' ? 'Enviar para revisão' : 'Publicar'}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <HugeiconsIcon icon={FloppyDiskIcon} className="mr-2 h-4 w-4" />
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="min-h-0 overflow-auto pr-1">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Identificação</CardTitle>
                <CardDescription>
                  Dados persistidos no rascunho do método.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Nome">
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft({ name: event.target.value })
                    }
                    placeholder="Ex.: Calibração de balança"
                  />
                </Field>
                <Field label="Tipo de ativo">
                  <Select
                    value={
                      draft.assetTypeId ? String(draft.assetTypeId) : 'none'
                    }
                    onValueChange={(value) =>
                      updateDraft({
                        assetTypeId:
                          value === 'none' ? undefined : Number(value),
                      })
                    }
                  >
                    <SelectTrigger>
                      <span>
                        {draft.assetTypeId
                          ? (assetTypesData?.data.find(
                              (type) => type.id === draft.assetTypeId,
                            )?.name ?? 'Tipo selecionado')
                          : 'Sem vínculo'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem vínculo</SelectItem>
                      {assetTypesData?.data.map((type) => (
                        <SelectItem key={type.id} value={String(type.id)}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Descrição">
                  <Textarea
                    value={draft.description ?? ''}
                    onChange={(event) =>
                      updateDraft({ description: event.target.value })
                    }
                    rows={3}
                    className="md:col-span-2"
                  />
                </Field>
              </CardContent>
            </Card>

            <SectionCard
              title="Entradas"
              description="Campos recebidos durante a execução da calibração."
              actionLabel="Adicionar entrada"
              onAction={addInput}
            >
              {draft.inputs.map((input, index) => (
                <div
                  key={`${input.key}-${index}`}
                  className="rounded-md border p-3"
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_100px_auto]">
                    <Field label="Chave">
                      <Input
                        value={input.key}
                        onChange={(event) =>
                          updateInput(index, { key: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Rótulo">
                      <Input
                        value={input.label}
                        onChange={(event) =>
                          updateInput(index, { label: event.target.value })
                        }
                      />
                    </Field>
                    <Field label="Tipo">
                      <Select
                        value={input.type}
                        onValueChange={(value) =>
                          updateInputType(index, value as MethodDraftInputType)
                        }
                      >
                        <SelectTrigger>
                          <span>{input.type}</span>
                        </SelectTrigger>
                        <SelectContent>
                          {inputTypes.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Unidade">
                      <Input
                        value={input.unit ?? ''}
                        onChange={(event) =>
                          updateInput(index, { unit: event.target.value })
                        }
                      />
                    </Field>
                    <div className="flex items-end justify-end">
                      <IconButton
                        label="Remover entrada"
                        icon={Delete02Icon}
                        onClick={() =>
                          updateDraft({
                            inputs: draft.inputs.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Checkbox
                      checked={Boolean(input.required)}
                      onCheckedChange={(checked) =>
                        updateInput(index, { required: checked === true })
                      }
                    />
                    <span className="text-sm text-muted-foreground">
                      Obrigatório
                    </span>
                  </div>
                  <div className="mt-3 grid gap-3 md:grid-cols-3">
                    <Field label="Origem">
                      <Select
                        value={
                          input.type === 'table'
                            ? 'manual'
                            : (input.source ?? 'manual')
                        }
                        onValueChange={(source) =>
                          updateInput(
                            index,
                            source === 'asset_spec'
                              ? {
                                  source: 'asset_spec',
                                  assetSpecKey: input.assetSpecKey ?? '',
                                  allowOverride: Boolean(input.allowOverride),
                                  columns: undefined,
                                }
                              : {
                                  source: 'manual',
                                  assetSpecKey: undefined,
                                  allowOverride: undefined,
                                },
                          )
                        }
                      >
                        <SelectTrigger>
                          <span>
                            {input.type === 'table'
                              ? 'manual'
                              : (input.source ?? 'manual')}
                          </span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="manual">manual</SelectItem>
                          {input.type !== 'table' && (
                            <SelectItem value="asset_spec">
                              asset_spec
                            </SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </Field>
                    {input.type !== 'table' &&
                      input.source === 'asset_spec' && (
                        <>
                          <Field label="Especificação">
                            <Input
                              value={input.assetSpecKey ?? ''}
                              onChange={(event) =>
                                updateInput(index, {
                                  assetSpecKey: event.target.value,
                                })
                              }
                            />
                          </Field>
                          <div className="flex items-end gap-2 pb-2">
                            <Checkbox
                              checked={Boolean(input.allowOverride)}
                              onCheckedChange={(checked) =>
                                updateInput(index, {
                                  allowOverride: checked === true,
                                })
                              }
                            />
                            <span className="text-sm text-muted-foreground">
                              Permitir override
                            </span>
                          </div>
                        </>
                      )}
                  </div>
                  {input.type === 'select' && (
                    <Field label="Opções">
                      <Textarea
                        value={(input.options ?? []).join('\n')}
                        onChange={(event) =>
                          updateInput(index, {
                            options: event.target.value
                              .split('\n')
                              .map((item) => item.trim())
                              .filter(Boolean),
                          })
                        }
                        rows={3}
                      />
                    </Field>
                  )}
                  {input.type === 'table' && (
                    <div className="mt-3 space-y-3">
                      <TableColumnsEditor
                        columns={input.columns ?? []}
                        onChange={(columns) => updateInput(index, { columns })}
                      />
                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="rounded-md border p-3">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={Boolean(
                                input.weighingRangeResolver?.enabled,
                              )}
                              onCheckedChange={(checked) =>
                                updateInput(index, {
                                  weighingRangeResolver: {
                                    ...input.weighingRangeResolver,
                                    enabled: checked === true,
                                  },
                                })
                              }
                            />
                            <span className="text-sm text-muted-foreground">
                              Resolver faixas por especificação
                            </span>
                          </div>
                          {input.weighingRangeResolver?.enabled && (
                            <div className="mt-3 grid gap-2">
                              <Input
                                value={
                                  input.weighingRangeResolver.assetSpecKey ?? ''
                                }
                                onChange={(event) =>
                                  updateInput(index, {
                                    weighingRangeResolver: {
                                      ...input.weighingRangeResolver,
                                      enabled: true,
                                      assetSpecKey: event.target.value,
                                    },
                                  })
                                }
                                placeholder="assetSpecKey"
                              />
                              <Input
                                value={
                                  input.weighingRangeResolver.pointColumn ?? ''
                                }
                                onChange={(event) =>
                                  updateInput(index, {
                                    weighingRangeResolver: {
                                      ...input.weighingRangeResolver,
                                      enabled: true,
                                      pointColumn: event.target.value,
                                    },
                                  })
                                }
                                placeholder="Coluna do ponto"
                              />
                            </div>
                          )}
                        </div>
                        <div className="rounded-md border p-3">
                          <div className="flex items-center gap-2">
                            <Checkbox
                              checked={Boolean(
                                input.eccentricityIndicator?.enabled,
                              )}
                              onCheckedChange={(checked) =>
                                updateInput(index, {
                                  eccentricityIndicator: {
                                    ...input.eccentricityIndicator,
                                    enabled: checked === true,
                                    variant:
                                      input.eccentricityIndicator?.variant ??
                                      'circular_platform',
                                  },
                                })
                              }
                            />
                            <span className="text-sm text-muted-foreground">
                              Indicador de excentricidade
                            </span>
                          </div>
                          {input.eccentricityIndicator?.enabled && (
                            <Select
                              value={
                                input.eccentricityIndicator.variant ??
                                'circular_platform'
                              }
                              onValueChange={(variant) =>
                                updateInput(index, {
                                  eccentricityIndicator: {
                                    ...input.eccentricityIndicator,
                                    enabled: true,
                                    variant: variant as NonNullable<
                                      MethodDraftInput['eccentricityIndicator']
                                    >['variant'],
                                  },
                                })
                              }
                            >
                              <SelectTrigger className="mt-3">
                                <span>
                                  {input.eccentricityIndicator.variant ??
                                    'circular_platform'}
                                </span>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="circular_platform">
                                  circular_platform
                                </SelectItem>
                                <SelectItem value="road_scale">
                                  road_scale
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </SectionCard>

            <SectionCard
              title="Variáveis"
              description="Bindings usados pelas fórmulas compiladas."
              actionLabel="Adicionar variável"
              onAction={addVariable}
            >
              {draft.variables.map((variable, index) => (
                <VariableEditor
                  key={`${variable.key}-${index}`}
                  variable={variable}
                  inputs={draft.inputs}
                  onChange={(binding) => updateVariable(index, binding)}
                  onRemove={() =>
                    updateDraft({
                      variables: draft.variables.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </SectionCard>

            <SectionCard
              title="Fórmulas"
              description="Expressões que serão normalizadas pelo compilador."
              actionLabel="Adicionar fórmula"
              onAction={addFormula}
            >
              {draft.formulas.map((formula, index) => (
                <FormulaEditor
                  key={`${formula.outputKey}-${index}`}
                  formula={formula}
                  index={index}
                  inputs={draft.inputs}
                  onChange={(patch) => updateFormula(index, patch)}
                  onRemove={() =>
                    updateDraft({
                      formulas: draft.formulas.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </SectionCard>

            <SectionCard
              title="Validações"
              description="Critérios avaliados pelo servidor."
              actionLabel="Adicionar validação"
              onAction={addValidation}
            >
              {draft.validations.map((validation, index) => (
                <div
                  key={`${validation.message}-${index}`}
                  className="rounded-md border p-3"
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_90px_1fr_120px_auto]">
                    <Field label="Esquerda">
                      <Input
                        value={validation.leftExpression}
                        onChange={(event) =>
                          updateValidation(index, {
                            leftExpression: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Operador">
                      <Select
                        value={validation.operator}
                        onValueChange={(value) =>
                          updateValidation(index, {
                            operator:
                              value as MethodDraftValidation['operator'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <span>{validation.operator}</span>
                        </SelectTrigger>
                        <SelectContent>
                          {validationOperators.map((operator) => (
                            <SelectItem key={operator} value={operator}>
                              {operator}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Direita">
                      <Input
                        value={validation.rightExpression}
                        onChange={(event) =>
                          updateValidation(index, {
                            rightExpression: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Severidade">
                      <Select
                        value={validation.severity}
                        onValueChange={(value) =>
                          updateValidation(index, {
                            severity:
                              value as MethodDraftValidation['severity'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <span>{validation.severity}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="error">error</SelectItem>
                          <SelectItem value="warning">warning</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="flex items-end justify-end">
                      <IconButton
                        label="Remover validação"
                        icon={Delete02Icon}
                        onClick={() =>
                          updateDraft({
                            validations: draft.validations.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                  <Field label="Mensagem">
                    <Input
                      value={validation.message}
                      onChange={(event) =>
                        updateValidation(index, { message: event.target.value })
                      }
                    />
                  </Field>
                </div>
              ))}
            </SectionCard>

            <SectionCard
              title="Modelos GUM"
              description="Modelos explícitos de mensurando, fontes de incerteza, fator de abrangência e orçamento."
              actionLabel="Adicionar modelo"
              onAction={addMeasurementModel}
            >
              {draft.measurementModels.map((model, index) => (
                <MeasurementModelEditor
                  key={`${model.key}-${index}`}
                  model={model}
                  inputs={draft.inputs}
                  formulas={draft.formulas}
                  onChange={(patch) => updateMeasurementModel(index, patch)}
                  onRemove={() =>
                    updateDraft({
                      measurementModels: draft.measurementModels.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </SectionCard>

            <SectionCard
              title="Incerteza Tipo B"
              description="Componentes padrão do orçamento de incerteza."
              actionLabel="Adicionar componente"
              onAction={addUncertainty}
            >
              {draft.uncertainty.length > 0 ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Componentes Type B legados exigem modelo GUM explícito antes
                  da publicação regulada.
                </div>
              ) : null}
              {draft.uncertainty.map((component, index) => (
                <div
                  key={`${component.name}-${index}`}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_120px_160px_120px_auto]"
                >
                  <Field label="Nome">
                    <Input
                      value={component.name}
                      onChange={(event) =>
                        updateUncertainty(index, { name: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Valor">
                    <Input
                      type="number"
                      value={component.value}
                      onChange={(event) =>
                        updateUncertainty(index, {
                          value: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Distribuição">
                    <Select
                      value={component.distribution}
                      onValueChange={(value) =>
                        updateUncertainty(index, {
                          distribution:
                            value as MethodDraftUncertaintyComponent['distribution'],
                        })
                      }
                    >
                      <SelectTrigger>
                        <span>{component.distribution}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {distributionOptions.map((distribution) => (
                          <SelectItem key={distribution} value={distribution}>
                            {distribution}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Graus">
                    <Input
                      type="number"
                      value={component.degreesOfFreedom ?? 50}
                      onChange={(event) =>
                        updateUncertainty(index, {
                          degreesOfFreedom: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <div className="flex items-end justify-end">
                    <IconButton
                      label="Remover componente"
                      icon={Delete02Icon}
                      onClick={() =>
                        updateDraft({
                          uncertainty: draft.uncertainty.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </SectionCard>

            <Card>
              <CardHeader>
                <CardTitle>Certificado</CardTitle>
                <CardDescription>
                  Conteúdo persistido no rascunho para emissão.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Field label="Código do procedimento">
                  <Input
                    value={draft.certificate?.procedureCode ?? ''}
                    onChange={(event) =>
                      updateCertificate({ procedureCode: event.target.value })
                    }
                  />
                </Field>
                <div className="grid gap-3 md:grid-cols-3">
                  <CertificateDisplaySelect
                    label="Valores certificados"
                    value={draft.certificate?.certifiedValuesDisplay ?? 'full'}
                    onChange={(value) =>
                      updateCertificate({ certifiedValuesDisplay: value })
                    }
                  />
                  <CertificateDisplaySelect
                    label="Composição de massa"
                    value={draft.certificate?.massCompositionDisplay ?? 'full'}
                    onChange={(value) =>
                      updateCertificate({ massCompositionDisplay: value })
                    }
                  />
                  <CertificateDisplaySelect
                    label="Orçamento de incerteza"
                    value={
                      draft.certificate?.uncertaintyBudgetDisplay ?? 'full'
                    }
                    onChange={(value) =>
                      updateCertificate({ uncertaintyBudgetDisplay: value })
                    }
                  />
                </div>
                <Field label="Padrões de referência">
                  <Textarea
                    value={(draft.certificate?.referenceStandards ?? []).join(
                      '\n',
                    )}
                    onChange={(event) =>
                      updateCertificate({
                        referenceStandards: event.target.value
                          .split('\n')
                          .map((item) => item.trim())
                          .filter(Boolean),
                      })
                    }
                    rows={3}
                  />
                </Field>
                <Separator />
                <div className="flex items-center justify-between gap-3">
                  <Label>Seções fixas</Label>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCertificateSection}
                  >
                    <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
                    Adicionar seção
                  </Button>
                </div>
                <div className="space-y-3">
                  {(draft.certificate?.sections ?? []).map((section, index) => (
                    <CertificateSectionEditor
                      key={`${section.kind}-${index}`}
                      section={section}
                      onChange={(nextSection) =>
                        updateCertificateSection(index, nextSection)
                      }
                      onRemove={() => removeCertificateSection(index)}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <aside className="min-h-0 overflow-auto">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Compilação</CardTitle>
                <CardDescription>
                  Fingerprint, fórmulas normalizadas e diagnósticos retornados
                  pelo servidor.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <ResultLine
                  label="Fingerprint"
                  value={compileResult?.fingerprint}
                />
                <DiagnosticsList diagnostics={diagnostics} />
                <Separator />
                <div className="space-y-2">
                  <Label>Fórmulas normalizadas</Label>
                  {compileResult?.normalizedFormulas.length ? (
                    <div className="space-y-2">
                      {compileResult.normalizedFormulas.map((formula) => (
                        <div
                          key={formula.outputKey}
                          className="rounded-md bg-muted p-3 font-mono text-xs"
                        >
                          <div className="font-semibold">
                            {formula.outputKey}
                          </div>
                          <div>{formula.normalizedExpression}</div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Nenhuma fórmula normalizada ainda.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Preview</CardTitle>
                <CardDescription>
                  Dados de exemplo enviados ao endpoint de preview.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Textarea
                  value={sampleDataText}
                  onChange={(event) => setSampleDataText(event.target.value)}
                  rows={10}
                  className="font-mono text-xs"
                />
                <JsonBlock label="Resultados" value={previewResult?.results} />
                {previewResult?.normalizedData && (
                  <JsonBlock
                    label="Dados normalizados"
                    value={previewResult.normalizedData}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
    </div>
  )
}

function SectionCard({
  title,
  description,
  actionLabel,
  onAction,
  children,
}: {
  title: string
  description: string
  actionLabel: string
  onAction: () => void
  children: ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAction}>
          <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
          {actionLabel}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: typeof Delete02Icon
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} className="h-4 w-4" />
    </Button>
  )
}

function TableColumnsEditor({
  columns,
  onChange,
}: {
  columns: Array<MethodDraftTableColumn>
  onChange: (columns: Array<MethodDraftTableColumn>) => void
}) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label>Colunas</Label>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange([
              ...columns,
              {
                key: `column_${columns.length + 1}`,
                label: 'Coluna',
                type: 'number',
              },
            ])
          }
        >
          <HugeiconsIcon icon={Add01Icon} className="mr-2 h-4 w-4" />
          Coluna
        </Button>
      </div>
      {columns.map((column, index) => (
        <div
          key={`${column.key}-${index}`}
          className="grid gap-2 md:grid-cols-[1fr_1fr_110px_100px_auto]"
        >
          <Input
            value={column.key}
            onChange={(event) =>
              onChange(
                columns.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, key: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Input
            value={column.label}
            onChange={(event) =>
              onChange(
                columns.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, label: event.target.value }
                    : item,
                ),
              )
            }
          />
          <Select
            value={column.type}
            onValueChange={(value) =>
              onChange(
                columns.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, type: value as MethodDraftTableColumn['type'] }
                    : item,
                ),
              )
            }
          >
            <SelectTrigger>
              <span>{column.type}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="number">number</SelectItem>
              <SelectItem value="text">text</SelectItem>
            </SelectContent>
          </Select>
          <Input
            value={column.unit ?? ''}
            onChange={(event) =>
              onChange(
                columns.map((item, itemIndex) =>
                  itemIndex === index
                    ? { ...item, unit: event.target.value }
                    : item,
                ),
              )
            }
          />
          <IconButton
            label="Remover coluna"
            icon={Delete02Icon}
            onClick={() =>
              onChange(columns.filter((_, itemIndex) => itemIndex !== index))
            }
          />
        </div>
      ))}
    </div>
  )
}

function FormulaEditor({
  formula,
  inputs,
  onChange,
  onRemove,
}: {
  formula: MethodDraftFormula
  index: number
  inputs: Array<MethodDraftInput>
  onChange: (patch: Partial<MethodDraftFormula>) => void
  onRemove: () => void
}) {
  const tableInputs = inputs.filter((input) => input.type === 'table')
  const scopeKind = formula.scope?.kind ?? 'scalar'
  const selectedTableKey =
    formula.scope?.kind === 'table_row'
      ? formula.scope.tableKey
      : (tableInputs[0]?.key ?? '')

  function changeScope(kind: (typeof formulaScopes)[number]) {
    if (kind === 'table_row') {
      onChange({ scope: { kind: 'table_row', tableKey: selectedTableKey } })
      return
    }

    onChange({ scope: { kind: 'scalar' } })
  }

  return (
    <div className="rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_100px_auto]">
        <Field label="Saída">
          <Input
            value={formula.outputKey}
            onChange={(event) => onChange({ outputKey: event.target.value })}
          />
        </Field>
        <Field label="Rótulo">
          <Input
            value={formula.label ?? ''}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>
        <Field label="Unidade">
          <Input
            value={formula.unit ?? ''}
            onChange={(event) => onChange({ unit: event.target.value })}
          />
        </Field>
        <div className="flex items-end justify-end">
          <IconButton
            label="Remover fórmula"
            icon={Delete02Icon}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Escopo">
          <Select
            value={scopeKind}
            onValueChange={(value) =>
              changeScope(value as (typeof formulaScopes)[number])
            }
          >
            <SelectTrigger>
              <span>{scopeKind}</span>
            </SelectTrigger>
            <SelectContent>
              {formulaScopes.map((scope) => (
                <SelectItem key={scope} value={scope}>
                  {scope}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {scopeKind === 'table_row' && (
          <Field label="Tabela">
            <Select
              value={selectedTableKey}
              onValueChange={(tableKey) => {
                if (tableKey)
                  onChange({ scope: { kind: 'table_row', tableKey } })
              }}
            >
              <SelectTrigger>
                <span>{selectedTableKey || 'Tabela'}</span>
              </SelectTrigger>
              <SelectContent>
                {tableInputs.map((input) => (
                  <SelectItem key={input.key} value={input.key}>
                    {input.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <Field label="Expressão">
        <Textarea
          value={formula.expression}
          onChange={(event) => onChange({ expression: event.target.value })}
          rows={2}
        />
      </Field>
      <div className="mt-3 flex items-center gap-2">
        <Checkbox
          checked={Boolean(formula.reporting?.includeInCertificate)}
          onCheckedChange={(checked) =>
            onChange({
              reporting: {
                ...formula.reporting,
                includeInCertificate: checked === true,
              },
            })
          }
        />
        <span className="text-sm text-muted-foreground">
          Incluir no certificado
        </span>
      </div>
      {formula.reporting?.includeInCertificate && (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <Field label="Grupo no certificado">
            <Select
              value={formula.reporting.group ?? 'calibration_result'}
              onValueChange={(value) =>
                onChange({
                  reporting: {
                    ...formula.reporting,
                    includeInCertificate: true,
                    group: value as NonNullable<
                      MethodDraftFormula['reporting']
                    >['group'],
                  },
                })
              }
            >
              <SelectTrigger>
                <span>{formula.reporting.group ?? 'calibration_result'}</span>
              </SelectTrigger>
              <SelectContent>
                {reportingGroups.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Papel">
            <Select
              value={formula.reporting.role ?? 'auxiliary'}
              onValueChange={(value) =>
                onChange({
                  reporting: {
                    ...formula.reporting,
                    includeInCertificate: true,
                    role: value as NonNullable<
                      MethodDraftFormula['reporting']
                    >['role'],
                  },
                })
              }
            >
              <SelectTrigger>
                <span>{formula.reporting.role ?? 'auxiliary'}</span>
              </SelectTrigger>
              <SelectContent>
                {reportingRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}
    </div>
  )
}

function MeasurementModelEditor({
  model,
  inputs,
  formulas,
  onChange,
  onRemove,
}: {
  model: MethodDraftMeasurementModel
  inputs: Array<MethodDraftInput>
  formulas: Array<MethodDraftFormula>
  onChange: (patch: Partial<MethodDraftMeasurementModel>) => void
  onRemove: () => void
}) {
  const tableInputs = inputs.filter((input) => input.type === 'table')
  const scopeKind = model.scope?.kind ?? 'scalar'
  const selectedTableKey =
    model.scope?.kind === 'table_row'
      ? model.scope.tableKey
      : (tableInputs[0]?.key ?? '')

  function updateQuantity(
    index: number,
    patch: Partial<MethodDraftMeasurementModelQuantity>,
  ) {
    onChange({
      quantities: model.quantities.map((quantity, itemIndex) =>
        itemIndex === index ? { ...quantity, ...patch } : quantity,
      ),
    })
  }

  function addQuantity() {
    const nextIndex = model.quantities.length + 1
    onChange({
      quantities: [
        ...model.quantities,
        {
          symbol: `x${nextIndex}`,
          source: firstNumericSource(inputs, formulas, selectedTableKey),
          uncertainty: {
            kind: 'direct_standard_uncertainty',
            standardUncertainty: 0,
            degreesOfFreedom: 'Infinity',
          },
        },
      ],
    })
  }

  function updateCorrelation(
    index: number,
    patch: NonNullable<MethodDraftMeasurementModel['correlations']>[number],
  ) {
    const correlations = [...(model.correlations ?? [])]
    correlations[index] = patch
    onChange({ correlations })
  }

  function updateCovariance(
    index: number,
    patch: NonNullable<MethodDraftMeasurementModel['covariances']>[number],
  ) {
    const covariances = [...(model.covariances ?? [])]
    covariances[index] = patch
    onChange({ covariances })
  }

  function changeScope(kind: (typeof measurementModelScopes)[number]) {
    if (kind === 'table_row') {
      onChange({ scope: { kind: 'table_row', tableKey: selectedTableKey } })
      return
    }
    onChange({ scope: { kind: 'scalar' } })
  }

  return (
    <div className="space-y-3 rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_auto]">
        <Field label="Chave">
          <Input
            value={model.key}
            onChange={(event) => onChange({ key: event.target.value })}
          />
        </Field>
        <Field label="Rótulo">
          <Input
            value={model.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>
        <Field label="Prob. cobertura">
          <Input
            type="number"
            step="0.0001"
            value={model.coverageProbability ?? 0.9545}
            onChange={(event) =>
              onChange({ coverageProbability: Number(event.target.value) })
            }
          />
        </Field>
        <div className="flex items-end justify-end">
          <IconButton
            label="Remover modelo"
            icon={Delete02Icon}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Escopo">
          <Select
            value={scopeKind}
            onValueChange={(value) =>
              changeScope(value as (typeof measurementModelScopes)[number])
            }
          >
            <SelectTrigger>
              <span>{scopeKind}</span>
            </SelectTrigger>
            <SelectContent>
              {measurementModelScopes.map((scope) => (
                <SelectItem key={scope} value={scope}>
                  {scope}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {scopeKind === 'table_row' && (
          <Field label="Tabela">
            <Select
              value={selectedTableKey}
              onValueChange={(tableKey) =>
                onChange({ scope: { kind: 'table_row', tableKey } })
              }
            >
              <SelectTrigger>
                <span>{selectedTableKey || 'Tabela'}</span>
              </SelectTrigger>
              <SelectContent>
                {tableInputs.map((input) => (
                  <SelectItem key={input.key} value={input.key}>
                    {input.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        <Field label="Mensurando">
          <Input
            value={model.measurand}
            onChange={(event) => onChange({ measurand: event.target.value })}
          />
        </Field>
      </div>
      <Field label="Expressão do modelo">
        <Input
          value={model.expression}
          onChange={(event) => onChange({ expression: event.target.value })}
        />
      </Field>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Quantidades</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addQuantity}
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Adicionar
          </Button>
        </div>
        {model.quantities.map((quantity, index) => (
          <MeasurementQuantityEditor
            key={`${quantity.symbol}-${index}`}
            quantity={quantity}
            inputs={inputs}
            formulas={formulas}
            tableKey={selectedTableKey}
            onChange={(patch) => updateQuantity(index, patch)}
            onRemove={() =>
              onChange({
                quantities: model.quantities.filter(
                  (_, itemIndex) => itemIndex !== index,
                ),
              })
            }
          />
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Correlações</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                correlations: [
                  ...(model.correlations ?? []),
                  { symbols: ['x1', 'x2'], coefficient: 0 },
                ],
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Adicionar
          </Button>
        </div>
        {(model.correlations ?? []).map((correlation, index) => (
          <div
            key={`correlation-${index}`}
            className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_140px_auto]"
          >
            <Field label="Símbolo A">
              <Input
                value={correlation.symbols[0]}
                onChange={(event) =>
                  updateCorrelation(index, {
                    ...correlation,
                    symbols: [event.target.value, correlation.symbols[1]],
                  })
                }
              />
            </Field>
            <Field label="Símbolo B">
              <Input
                value={correlation.symbols[1]}
                onChange={(event) =>
                  updateCorrelation(index, {
                    ...correlation,
                    symbols: [correlation.symbols[0], event.target.value],
                  })
                }
              />
            </Field>
            <Field label="Coeficiente">
              <Input
                value={correlation.coefficient}
                onChange={(event) =>
                  updateCorrelation(index, {
                    ...correlation,
                    coefficient: event.target.value,
                  })
                }
              />
            </Field>
            <div className="flex items-end justify-end">
              <IconButton
                label="Remover correlação"
                icon={Delete02Icon}
                onClick={() =>
                  onChange({
                    correlations: (model.correlations ?? []).filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Covariâncias</Label>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                covariances: [
                  ...(model.covariances ?? []),
                  { symbols: ['x1', 'x2'], covariance: 0 },
                ],
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Adicionar
          </Button>
        </div>
        {(model.covariances ?? []).map((covariance, index) => (
          <div
            key={`covariance-${index}`}
            className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_140px_auto]"
          >
            <Field label="Símbolo A">
              <Input
                value={covariance.symbols[0]}
                onChange={(event) =>
                  updateCovariance(index, {
                    ...covariance,
                    symbols: [event.target.value, covariance.symbols[1]],
                  })
                }
              />
            </Field>
            <Field label="Símbolo B">
              <Input
                value={covariance.symbols[1]}
                onChange={(event) =>
                  updateCovariance(index, {
                    ...covariance,
                    symbols: [covariance.symbols[0], event.target.value],
                  })
                }
              />
            </Field>
            <Field label="Covariância">
              <Input
                value={covariance.covariance}
                onChange={(event) =>
                  updateCovariance(index, {
                    ...covariance,
                    covariance: event.target.value,
                  })
                }
              />
            </Field>
            <div className="flex items-end justify-end">
              <IconButton
                label="Remover covariância"
                icon={Delete02Icon}
                onClick={() =>
                  onChange({
                    covariances: (model.covariances ?? []).filter(
                      (_, itemIndex) => itemIndex !== index,
                    ),
                  })
                }
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MeasurementQuantityEditor({
  quantity,
  inputs,
  formulas,
  tableKey,
  onChange,
  onRemove,
}: {
  quantity: MethodDraftMeasurementModelQuantity
  inputs: Array<MethodDraftInput>
  formulas: Array<MethodDraftFormula>
  tableKey: string
  onChange: (patch: Partial<MethodDraftMeasurementModelQuantity>) => void
  onRemove: () => void
}) {
  const uncertainty = quantity.uncertainty

  function changeUncertainty(kind: (typeof gumUncertaintyKinds)[number]) {
    if (kind === 'type_a') {
      onChange({
        uncertainty: {
          kind: 'type_a',
          observations: [
            firstNumericSource(inputs, formulas, tableKey),
            firstNumericSource(inputs, formulas, tableKey),
          ],
        },
      })
      return
    }
    if (kind === 'type_b') {
      onChange({
        uncertainty: {
          kind: 'type_b',
          distribution: 'rectangular',
          halfWidth: 0,
          degreesOfFreedom: 50,
        },
      })
      return
    }
    onChange({
      uncertainty: {
        kind: 'direct_standard_uncertainty',
        standardUncertainty: 0,
        degreesOfFreedom: 'Infinity',
      },
    })
  }

  return (
    <div className="space-y-3 rounded-md border bg-muted/20 p-3">
      <div className="grid gap-3 md:grid-cols-[120px_1fr_160px_auto]">
        <Field label="Símbolo">
          <Input
            value={quantity.symbol}
            onChange={(event) => onChange({ symbol: event.target.value })}
          />
        </Field>
        <Field label="Fonte">
          <QuantitySourceSelect
            source={quantity.source}
            inputs={inputs}
            formulas={formulas}
            tableKey={tableKey}
            onChange={(source) => onChange({ source })}
          />
        </Field>
        <Field label="Incerteza">
          <Select
            value={uncertainty.kind}
            onValueChange={(value) =>
              changeUncertainty(value as (typeof gumUncertaintyKinds)[number])
            }
          >
            <SelectTrigger>
              <span>{uncertainty.kind}</span>
            </SelectTrigger>
            <SelectContent>
              {gumUncertaintyKinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {kind}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end justify-end">
          <IconButton
            label="Remover quantidade"
            icon={Delete02Icon}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Unidade">
          <Input
            value={quantity.unit ?? ''}
            onChange={(event) => onChange({ unit: event.target.value })}
          />
        </Field>
        <Field label="Sensibilidade">
          <Input
            value={quantity.sensitivity ?? ''}
            onChange={(event) => onChange({ sensitivity: event.target.value })}
          />
        </Field>
        <Field label="Graus de liberdade">
          <Input
            value={quantity.degreesOfFreedom ?? ''}
            onChange={(event) =>
              onChange({
                degreesOfFreedom: parseOptionalNumericOrInfinity(
                  event.target.value,
                ),
              })
            }
          />
        </Field>
      </div>
      {uncertainty.kind === 'type_a' && (
        <div className="space-y-2">
          <div className="grid gap-3 md:grid-cols-[1fr_160px]">
            <Field label="Input repetido">
              <Input
                value={uncertainty.observationsInputKey ?? ''}
                onChange={(event) =>
                  onChange({
                    uncertainty: {
                      ...uncertainty,
                      observationsInputKey: event.target.value || undefined,
                    },
                  })
                }
              />
            </Field>
            <Field label="GL mínimo">
              <Input
                type="number"
                value={uncertainty.minDegreesOfFreedom ?? ''}
                onChange={(event) =>
                  onChange({
                    uncertainty: {
                      ...uncertainty,
                      minDegreesOfFreedom:
                        event.target.value === ''
                          ? undefined
                          : Number(event.target.value),
                    },
                  })
                }
              />
            </Field>
          </div>
          <Label>Observações Type A por fonte</Label>
          {(uncertainty.observations ?? []).map((source, index) => (
            <QuantitySourceSelect
              key={index}
              source={source}
              inputs={inputs}
              formulas={formulas}
              tableKey={tableKey}
              onChange={(nextSource) => {
                const observations = [...(uncertainty.observations ?? [])]
                observations[index] = nextSource
                onChange({ uncertainty: { ...uncertainty, observations } })
              }}
            />
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onChange({
                uncertainty: {
                  ...uncertainty,
                  observations: [
                    ...(uncertainty.observations ?? []),
                    firstNumericSource(inputs, formulas, tableKey),
                  ],
                },
              })
            }
          >
            <HugeiconsIcon icon={Add01Icon} size={14} />
            Observação
          </Button>
        </div>
      )}
      {uncertainty.kind === 'type_b' && (
        <div className="grid gap-3 md:grid-cols-4">
          <Field label="Distribuição">
            <Select
              value={uncertainty.distribution}
              onValueChange={(distribution) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    distribution:
                      distribution as (typeof gumDistributions)[number],
                  },
                })
              }
            >
              <SelectTrigger>
                <span>{uncertainty.distribution}</span>
              </SelectTrigger>
              <SelectContent>
                {gumDistributions.map((distribution) => (
                  <SelectItem key={distribution} value={distribution}>
                    {distribution}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Incerteza padrão">
            <Input
              value={uncertainty.standardUncertainty ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    standardUncertainty: event.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Semi-amplitude">
            <Input
              value={uncertainty.halfWidth ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    halfWidth: event.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Incerteza expandida">
            <Input
              value={uncertainty.expandedUncertainty ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    expandedUncertainty: event.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="k do certificado">
            <Input
              value={uncertainty.coverageFactor ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    coverageFactor: event.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Divisor">
            <Input
              value={uncertainty.divisor ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: { ...uncertainty, divisor: event.target.value },
                })
              }
            />
          </Field>
          <Field label="Limite inferior">
            <Input
              value={uncertainty.limits?.lower ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    limits: {
                      lower: event.target.value,
                      upper: uncertainty.limits?.upper ?? '',
                    },
                  },
                })
              }
            />
          </Field>
          <Field label="Limite superior">
            <Input
              value={uncertainty.limits?.upper ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    limits: {
                      lower: uncertainty.limits?.lower ?? '',
                      upper: event.target.value,
                    },
                  },
                })
              }
            />
          </Field>
          <Field label="Graus de liberdade">
            <Input
              type="number"
              value={uncertainty.degreesOfFreedom ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    degreesOfFreedom:
                      event.target.value === ''
                        ? undefined
                        : Number(event.target.value),
                  },
                })
              }
            />
          </Field>
        </div>
      )}
      {uncertainty.kind === 'direct_standard_uncertainty' && (
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Incerteza padrão">
            <Input
              value={uncertainty.standardUncertainty}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    standardUncertainty: event.target.value,
                  },
                })
              }
            />
          </Field>
          <Field label="Graus de liberdade">
            <Input
              value={uncertainty.degreesOfFreedom ?? ''}
              onChange={(event) =>
                onChange({
                  uncertainty: {
                    ...uncertainty,
                    degreesOfFreedom: parseOptionalNumericOrInfinity(
                      event.target.value,
                    ),
                  },
                })
              }
            />
          </Field>
        </div>
      )}
    </div>
  )
}

function QuantitySourceSelect({
  source,
  inputs,
  formulas,
  tableKey,
  onChange,
}: {
  source: MethodDraftMeasurementModelSource
  inputs: Array<MethodDraftInput>
  formulas: Array<MethodDraftFormula>
  tableKey: string
  onChange: (source: MethodDraftMeasurementModelSource) => void
}) {
  const baseOptions = numericSourceOptions(inputs, formulas, tableKey)
  const value = sourceToOptionValue(source)
  const options = baseOptions.some((option) => option.value === value)
    ? baseOptions
    : [
        {
          value,
          label: sourceLabel(source, inputs, formulas),
        },
        ...baseOptions,
      ]
  return (
    <Select
      value={value}
      onValueChange={(nextValue) =>
        onChange(optionValueToSource(nextValue, inputs, formulas, tableKey))
      }
    >
      <SelectTrigger>
        <span>{sourceLabel(source, inputs, formulas)}</span>
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function firstNumericSource(
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

function numericSourceOptions(
  inputs: Array<MethodDraftInput>,
  formulas: Array<MethodDraftFormula>,
  tableKey: string,
): Array<{ value: string; label: string }> {
  const scalarInputs = inputs
    .filter((input) => input.type === 'number')
    .map((input) => ({
      value: `input:${input.key}`,
      label: `Campo: ${input.label || input.key}`,
    }))

  const tableInputs = inputs.filter((input) => input.type === 'table')
  const tableColumns = tableInputs.flatMap((input) =>
    (input.columns ?? [])
      .filter((column) => column.type === 'number')
      .filter(() => !tableKey || input.key === tableKey)
      .map((column) => ({
        value: `table:${input.key}:${column.key}`,
        label: `Coluna: ${input.label || input.key} / ${
          column.label || column.key
        }`,
      })),
  )

  const formulaOptions = formulas
    .filter(
      (formula) =>
        !formula.scope ||
        formula.scope.kind === 'scalar' ||
        !tableKey ||
        (formula.scope.kind === 'table_row' &&
          formula.scope.tableKey === tableKey),
    )
    .map((formula) => ({
      value: `formula:${formula.outputKey}`,
      label: `Fórmula: ${formula.label || formula.outputKey}`,
    }))

  return [
    ...scalarInputs,
    ...tableColumns,
    ...formulaOptions,
    { value: 'constant:0', label: 'Constante: 0' },
  ]
}

function sourceToOptionValue(
  source: MethodDraftMeasurementModelSource,
): string {
  if (source.kind === 'table_column') {
    return `table:${source.tableKey}:${source.columnKey}`
  }
  if (source.kind === 'constant') return `constant:${String(source.value)}`
  return `${source.kind}:${source.key}`
}

function optionValueToSource(
  value: string,
  inputs: Array<MethodDraftInput>,
  formulas: Array<MethodDraftFormula>,
  tableKey: string,
): MethodDraftMeasurementModelSource {
  const [kind, first, second] = value.split(':')
  if (kind === 'table' && first && second) {
    return { kind: 'table_column', tableKey: first, columnKey: second }
  }
  if (kind === 'formula' && first) return { kind: 'formula', key: first }
  if (kind === 'input' && first) return { kind: 'input', key: first }
  if (kind === 'constant') {
    const rawValue = value.slice('constant:'.length)
    return { kind: 'constant', value: rawValue || 0 }
  }
  return firstNumericSource(inputs, formulas, tableKey)
}

function sourceLabel(
  source: MethodDraftMeasurementModelSource,
  inputs: Array<MethodDraftInput>,
  formulas: Array<MethodDraftFormula>,
): string {
  if (source.kind === 'constant') return `Constante: ${source.value}`
  if (source.kind === 'formula') {
    const formula = formulas.find((item) => item.outputKey === source.key)
    return `Fórmula: ${formula?.label || source.key}`
  }
  if (source.kind === 'table_column') {
    const table = inputs.find((input) => input.key === source.tableKey)
    const column = table?.columns?.find((item) => item.key === source.columnKey)
    return `Coluna: ${table?.label || source.tableKey} / ${
      column?.label || source.columnKey
    }`
  }
  const input = inputs.find((item) => item.key === source.key)
  return `Campo: ${input?.label || source.key}`
}

function parseOptionalNumericOrInfinity(
  value: string,
): number | 'Infinity' | undefined {
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (trimmed === 'Infinity') return 'Infinity'
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : undefined
}

function VariableEditor({
  variable,
  inputs,
  onChange,
  onRemove,
}: {
  variable: MethodDraftVariableBinding
  inputs: Array<MethodDraftInput>
  onChange: (binding: MethodDraftVariableBinding) => void
  onRemove: () => void
}) {
  const tableInputs = inputs.filter((input) => input.type === 'table')
  const numericInputs = inputs.filter((input) => input.type === 'number')
  const selectedTable =
    'fieldKey' in variable
      ? tableInputs.find((input) => input.key === variable.fieldKey)
      : undefined
  const selectedColumns = selectedTable?.columns ?? []

  function changeSource(source: MethodDraftVariableBinding['source']) {
    if (source === 'environment') {
      onChange({
        key: variable.key,
        label: variable.label,
        source,
        field: 'temperature',
      })
      return
    }

    if (source === 'standard') {
      onChange({
        key: variable.key,
        label: variable.label,
        source,
        valueKey: 'uncertainty',
      })
      return
    }

    if (source === 'table_column' || source === 'table_statistic') {
      const fieldKey = tableInputs[0]?.key ?? ''
      const columnKey = tableInputs[0]?.columns?.[0]?.key ?? ''
      if (source === 'table_statistic') {
        onChange({
          key: variable.key,
          label: variable.label,
          source,
          fieldKey,
          columnKey,
          statistic: 'mean',
        })
        return
      }

      onChange({
        key: variable.key,
        label: variable.label,
        source,
        fieldKey,
        columnKey,
      })
      return
    }

    onChange({
      key: variable.key,
      label: variable.label,
      source,
      fieldKey: numericInputs[0]?.key ?? '',
    })
  }

  return (
    <div className="rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_160px_auto]">
        <Field label="Chave">
          <Input
            value={variable.key}
            onChange={(event) =>
              onChange({ ...variable, key: event.target.value })
            }
          />
        </Field>
        <Field label="Rótulo">
          <Input
            value={variable.label ?? ''}
            onChange={(event) =>
              onChange({ ...variable, label: event.target.value })
            }
          />
        </Field>
        <Field label="Origem">
          <Select
            value={variable.source}
            onValueChange={(source) => {
              if (source) changeSource(source)
            }}
          >
            <SelectTrigger>
              <span>{variable.source}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="data_field">data_field</SelectItem>
              <SelectItem value="table_column">table_column</SelectItem>
              <SelectItem value="table_statistic">table_statistic</SelectItem>
              <SelectItem value="environment">environment</SelectItem>
              <SelectItem value="standard">standard</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end justify-end">
          <IconButton
            label="Remover variável"
            icon={Delete02Icon}
            onClick={onRemove}
          />
        </div>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        {'fieldKey' in variable && (
          <Field label="Campo">
            <Select
              value={variable.fieldKey}
              onValueChange={(fieldKey) => {
                if (fieldKey) onChange({ ...variable, fieldKey })
              }}
            >
              <SelectTrigger>
                <span>{variable.fieldKey || 'Campo'}</span>
              </SelectTrigger>
              <SelectContent>
                {(variable.source === 'data_field'
                  ? numericInputs
                  : tableInputs
                ).map((input) => (
                  <SelectItem key={input.key} value={input.key}>
                    {input.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {'columnKey' in variable && (
          <Field label="Coluna">
            <Select
              value={variable.columnKey}
              onValueChange={(columnKey) => {
                if (columnKey) onChange({ ...variable, columnKey })
              }}
            >
              <SelectTrigger>
                <span>{variable.columnKey || 'Coluna'}</span>
              </SelectTrigger>
              <SelectContent>
                {selectedColumns.map((column) => (
                  <SelectItem key={column.key} value={column.key}>
                    {column.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
        {variable.source === 'table_statistic' && (
          <Field label="Estatística">
            <Select
              value={variable.statistic}
              onValueChange={(statistic) =>
                onChange({
                  ...variable,
                  statistic: statistic as Extract<
                    MethodDraftVariableBinding,
                    { source: 'table_statistic' }
                  >['statistic'],
                })
              }
            >
              <SelectTrigger>
                <span>{variable.statistic}</span>
              </SelectTrigger>
              <SelectContent>
                {['mean', 'sample_stddev', 'count', 'min', 'max'].map(
                  (item) => (
                    <SelectItem key={item} value={item}>
                      {item}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
        )}
        {variable.source === 'environment' && (
          <Field label="Ambiente">
            <Select
              value={variable.field}
              onValueChange={(field) =>
                onChange({
                  ...variable,
                  field: field as Extract<
                    MethodDraftVariableBinding,
                    { source: 'environment' }
                  >['field'],
                })
              }
            >
              <SelectTrigger>
                <span>{variable.field}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="temperature">temperature</SelectItem>
                <SelectItem value="humidity">humidity</SelectItem>
                <SelectItem value="pressure">pressure</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
        {variable.source === 'standard' && (
          <Field label="Valor do padrão">
            <Input
              value={variable.valueKey}
              onChange={(event) =>
                onChange({ ...variable, valueKey: event.target.value })
              }
            />
          </Field>
        )}
      </div>
    </div>
  )
}

function CertificateDisplaySelect({
  label,
  value,
  onChange,
}: {
  label: string
  value: 'full' | 'hidden'
  onChange: (value: 'full' | 'hidden') => void
}) {
  return (
    <Field label={label}>
      <Select
        value={value}
        onValueChange={(nextValue) => onChange(nextValue as 'full' | 'hidden')}
      >
        <SelectTrigger>
          <span>{value === 'full' ? 'Exibir' : 'Ocultar'}</span>
        </SelectTrigger>
        <SelectContent>
          {certificateDisplayOptions.map((option) => (
            <SelectItem key={option} value={option}>
              {option === 'full' ? 'Exibir' : 'Ocultar'}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  )
}

function CertificateSectionEditor({
  section,
  onChange,
  onRemove,
}: {
  section: NonNullable<MethodDraftCertificateContent['sections']>[number]
  onChange: (
    section: NonNullable<MethodDraftCertificateContent['sections']>[number],
  ) => void
  onRemove: () => void
}) {
  const textValue =
    section.kind === 'paragraphs'
      ? section.paragraphs.join('\n')
      : section.kind === 'bullets'
        ? section.items.join('\n')
        : section.items
            .map((item) => `${item.term}: ${item.definition}`)
            .join('\n')

  return (
    <div className="rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-[150px_1fr_auto]">
        <Field label="Tipo">
          <Select
            value={section.kind}
            onValueChange={(kind) => {
              if (kind === 'definition_list') {
                onChange({
                  kind,
                  title: section.title ?? 'Definições',
                  items: [],
                })
                return
              }
              if (kind === 'bullets') {
                onChange({
                  kind,
                  title: section.title,
                  items: [],
                })
                return
              }
              onChange({
                kind: 'paragraphs',
                title: section.title ?? 'Seção',
                paragraphs: [],
              })
            }}
          >
            <SelectTrigger>
              <span>{section.kind}</span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="paragraphs">Parágrafos</SelectItem>
              <SelectItem value="bullets">Lista</SelectItem>
              <SelectItem value="definition_list">Definições</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Título">
          <Input
            value={section.title ?? ''}
            onChange={(event) =>
              onChange({ ...section, title: event.target.value })
            }
          />
        </Field>
        <div className="flex items-end justify-end">
          <IconButton
            label="Remover seção"
            icon={Delete02Icon}
            onClick={onRemove}
          />
        </div>
      </div>
      <Field label="Conteúdo">
        <Textarea
          value={textValue}
          onChange={(event) => {
            const lines = event.target.value
              .split('\n')
              .map((item) => item.trim())
              .filter(Boolean)

            if (section.kind === 'paragraphs') {
              onChange({ ...section, paragraphs: lines })
              return
            }
            if (section.kind === 'bullets') {
              onChange({ ...section, items: lines })
              return
            }
            onChange({
              ...section,
              items: lines.map((line) => {
                const [term, ...definition] = line.split(':')
                return {
                  term: term?.trim() || 'Termo',
                  definition: definition.join(':').trim(),
                }
              }),
            })
          }}
          rows={4}
        />
      </Field>
    </div>
  )
}

function DiagnosticsList({
  diagnostics,
}: {
  diagnostics: Array<MethodDiagnostic>
}) {
  if (diagnostics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Nenhum diagnóstico retornado.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {diagnostics.map((diagnostic, index) => (
        <div
          key={`${diagnostic.message}-${index}`}
          className="rounded-md border p-3"
        >
          <div className="flex items-center gap-2">
            <Badge
              variant={
                diagnostic.severity === 'error' ? 'destructive' : 'secondary'
              }
            >
              {diagnostic.severity}
            </Badge>
            {diagnostic.code && (
              <span className="font-mono text-xs text-muted-foreground">
                {diagnostic.code}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm">{diagnostic.message}</p>
          {diagnostic.path && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {diagnostic.path}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function ResultLine({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <div className="min-h-9 rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {value || 'Aguardando compilação'}
      </div>
    </div>
  )
}

function JsonBlock({
  label,
  value,
}: {
  label: string
  value?: Record<string, unknown>
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">
        {JSON.stringify(value ?? {}, null, 2)}
      </pre>
    </div>
  )
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('O preview precisa de um objeto JSON')
  }

  return parsed as Record<string, unknown>
}

function buildInitialSampleData(draft: MethodDraft): Record<string, unknown> {
  const sample: Record<string, unknown> = Object.fromEntries(
    draft.inputs.map((input) => [
      input.key,
      input.type === 'number'
        ? 0
        : input.type === 'table'
          ? buildInitialTableRows(input.columns ?? [])
          : (input.defaultValue ?? ''),
    ]),
  )
  sample.environment = { temperature: 0, humidity: 0, pressure: 0 }

  for (const variable of draft.variables) {
    if (variable.source === 'environment') {
      const environment = ensureRecord(sample, 'environment')
      environment[variable.field] = 0
      continue
    }

    if (variable.source === 'standard') {
      addStandardSampleBinding(sample, variable.standardId, variable.valueKey)
      continue
    }

    if (
      variable.source === 'table_column' ||
      variable.source === 'table_statistic'
    ) {
      const rowsRequired =
        variable.source === 'table_statistic' &&
        variable.statistic === 'sample_stddev'
          ? 2
          : 1
      const rows = Array.isArray(sample[variable.fieldKey])
        ? (sample[variable.fieldKey] as Array<Record<string, unknown>>)
        : []
      while (rows.length < rowsRequired) rows.push({})
      for (const row of rows)
        row[variable.columnKey] = row[variable.columnKey] ?? 0
      sample[variable.fieldKey] = rows
      continue
    }

    if (variable.source === 'data_field') {
      sample[variable.fieldKey] = sample[variable.fieldKey] ?? 0
    }
  }

  for (const model of draft.measurementModels) {
    for (const quantity of model.quantities) {
      addMeasurementSourceSample(sample, quantity.source)
      if (quantity.uncertainty.kind === 'type_a') {
        for (const source of quantity.uncertainty.observations ?? []) {
          addMeasurementSourceSample(sample, source)
        }
        if (quantity.uncertainty.observationsInputKey) {
          sample[quantity.uncertainty.observationsInputKey] = sample[
            quantity.uncertainty.observationsInputKey
          ] ?? [0, 0]
        }
      }
    }
  }

  return sample
}

function buildInitialTableRows(
  columns: NonNullable<MethodDraftInput['columns']>,
): Array<Record<string, unknown>> {
  const numericColumns = columns.filter((column) => column.type === 'number')
  if (numericColumns.length === 0) return []

  return [0, 1].map(() =>
    Object.fromEntries(numericColumns.map((column) => [column.key, 0])),
  )
}

function ensureRecord(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = source[key]
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  const record: Record<string, unknown> = {}
  source[key] = record
  return record
}

function addStandardSampleBinding(
  sample: Record<string, unknown>,
  standardId: number | undefined,
  valueKey: string,
): void {
  const standards = Array.isArray(sample.standards)
    ? (sample.standards as Array<Record<string, unknown>>)
    : []
  const targetId = standardId ?? 0
  let standard = standards.find((item) => item.id === targetId)

  if (!standard) {
    standard = {
      id: targetId,
      uncertainty: 0,
      coverageFactor: 2,
      drift: 0,
      certifiedValues: [],
    }
    standards.push(standard)
  }

  if (!Array.isArray(standard.certifiedValues)) {
    standard.certifiedValues = []
  }

  if (
    valueKey &&
    valueKey !== 'uncertainty' &&
    valueKey !== 'coverageFactor' &&
    valueKey !== 'k' &&
    valueKey !== 'drift'
  ) {
    const nominal = valueKey.endsWith('_u') ? valueKey.slice(0, -2) : valueKey
    const certifiedValues = standard.certifiedValues as Array<
      Record<string, unknown>
    >
    if (!certifiedValues.some((item) => item.nominal === nominal)) {
      certifiedValues.push({ nominal, value: 0, uncertainty: 0 })
    }
  }

  sample.standards = standards
}

function addMeasurementSourceSample(
  sample: Record<string, unknown>,
  source: MethodDraftMeasurementModelSource,
): void {
  if (source.kind === 'input') {
    sample[source.key] = sample[source.key] ?? 0
    return
  }
  if (source.kind !== 'table_column') return

  const rows = Array.isArray(sample[source.tableKey])
    ? (sample[source.tableKey] as Array<Record<string, unknown>>)
    : []
  while (rows.length < 2) rows.push({})
  for (const row of rows) {
    row[source.columnKey] = row[source.columnKey] ?? 0
  }
  sample[source.tableKey] = rows
}
