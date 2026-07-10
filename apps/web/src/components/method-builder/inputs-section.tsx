import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FormField as Field } from '@/shared/forms/form-field'

import { SectionCard } from './section-card'
import {
  methodDraftQuantityKinds,
  type MethodDraftInput,
  type MethodDraftInputType,
  type MethodDraftQuantityKind,
  type MethodDraftTableColumn,
} from './types'

const inputTypes: Array<MethodDraftInputType> = [
  'text',
  'number',
  'select',
  'table',
]

const tableColumnRoles = [
  'standard_value',
  'mass_standard_composition',
] as const

// Quantity-kind options split by conversion semantics. Delta-valued roles
// convert factor-only for affine kinds (temperature); absolute roles apply the
// scale offset. Order within each group is the display order in the picker.
const absoluteQuantityKinds: Array<MethodDraftQuantityKind> = [
  'indication',
  'reference',
  'environment',
  'other',
]
const deltaQuantityKinds: Array<MethodDraftQuantityKind> = [
  'correction',
  'tolerance',
  'uncertainty',
  'resolution',
]
const quantityKindLabels: Record<MethodDraftQuantityKind, string> = {
  indication: 'Indicação',
  reference: 'Referência',
  environment: 'Ambiente',
  correction: 'Correção',
  tolerance: 'Tolerância',
  uncertainty: 'Incerteza',
  resolution: 'Resolução',
  other: 'Outro',
}

const massCompositionOptionSources = [
  'certified_values',
  'composition_profiles',
] as const

const massCompositionQuantityModes = [
  'linear_per_item_then_rss',
  'profile_linear',
] as const

const massCompositionUncertaintyModes = [
  'expanded_rss',
  'expanded_arithmetic',
] as const

const massUnits = ['mg', 'g', 'kg'] as const

type MassUnit = (typeof massUnits)[number]
type TableColumnRole = (typeof tableColumnRoles)[number]
type MassCompositionOptionSource = (typeof massCompositionOptionSources)[number]
type MassCompositionQuantityMode = (typeof massCompositionQuantityModes)[number]
type MassCompositionUncertaintyMode =
  (typeof massCompositionUncertaintyModes)[number]

const massCompositionTargetFields = [
  ['certifiedValue', 'Valor certificado'],
  ['compositionLabel', 'Rótulo da composição'],
  ['expandedUncertainty', 'Incerteza expandida'],
  ['maxError', 'Erro máximo'],
  ['drift', 'Deriva'],
  ['buoyancy', 'Empuxo'],
] as const

const weighingRangeTargetFields = [
  ['rangeLabel', 'Rótulo da faixa'],
  ['rangeMin', 'Mínimo da faixa'],
  ['rangeMax', 'Máximo da faixa'],
  ['rangeUnit', 'Unidade da faixa'],
  ['resolution', 'Resolução'],
  ['resolutionUnit', 'Unidade da resolução'],
] as const

export function InputsSection({
  inputs,
  onAddInput,
  onInputChange,
  onInputTypeChange,
  onInputsChange,
}: {
  inputs: Array<MethodDraftInput>
  onAddInput: () => void
  onInputChange: (index: number, patch: Partial<MethodDraftInput>) => void
  onInputTypeChange: (index: number, type: MethodDraftInputType) => void
  onInputsChange: (inputs: Array<MethodDraftInput>) => void
}) {
  return (
    <SectionCard
      title="Entradas"
      description="Campos recebidos durante a execução da calibração."
      actionLabel="Adicionar entrada"
      onAction={onAddInput}
    >
      {inputs.map((input, index) => (
        <InputEditor
          key={index}
          input={input}
          onChange={(patch) => onInputChange(index, patch)}
          onTypeChange={(type) => onInputTypeChange(index, type)}
          onRemove={() =>
            onInputsChange(inputs.filter((_, itemIndex) => itemIndex !== index))
          }
        />
      ))}
    </SectionCard>
  )
}

function QuantityKindField({
  value,
  onChange,
}: {
  value: MethodDraftQuantityKind | undefined
  onChange: (quantityKind: MethodDraftQuantityKind | undefined) => void
}) {
  return (
    <Field label="Papel da grandeza">
      <Select
        value={value ?? 'none'}
        onValueChange={(next) =>
          onChange(next === 'none' ? undefined : toQuantityKind(next))
        }
      >
        <SelectTrigger>
          <span>
            {value
              ? quantityKindLabels[value]
              : 'Não definido (valor absoluto)'}
          </span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Não definido (valor absoluto)</SelectItem>
          <SelectGroup>
            <SelectLabel>Valores absolutos</SelectLabel>
            {absoluteQuantityKinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {quantityKindLabels[kind]}
              </SelectItem>
            ))}
          </SelectGroup>
          <SelectGroup>
            <SelectLabel>Deltas (convertem sem offset)</SelectLabel>
            {deltaQuantityKinds.map((kind) => (
              <SelectItem key={kind} value={kind}>
                {quantityKindLabels[kind]}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </Field>
  )
}

function InputEditor({
  input,
  onChange,
  onTypeChange,
  onRemove,
}: {
  input: MethodDraftInput
  onChange: (patch: Partial<MethodDraftInput>) => void
  onTypeChange: (type: MethodDraftInputType) => void
  onRemove: () => void
}) {
  return (
    <div className="rounded-md border p-3">
      <div className="grid gap-3 md:grid-cols-[1fr_1fr_120px_100px_auto]">
        <Field label="Chave">
          <Input
            value={input.key}
            onChange={(event) => onChange({ key: event.target.value })}
          />
        </Field>
        <Field label="Rótulo">
          <Input
            value={input.label}
            onChange={(event) => onChange({ label: event.target.value })}
          />
        </Field>
        <Field label="Tipo">
          <Select
            value={input.type}
            onValueChange={(value) => onTypeChange(toInputType(value))}
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
            onChange={(event) => onChange({ unit: event.target.value })}
          />
        </Field>
        <div className="flex items-end justify-end">
          <RemoveButton label="Remover entrada" onClick={onRemove} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Checkbox
          checked={Boolean(input.required)}
          onCheckedChange={(checked) =>
            onChange({ required: checked === true })
          }
        />
        <span className="text-sm text-muted-foreground">Obrigatório</span>
      </div>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <Field label="Origem">
          <Select
            value={
              input.type === 'table' ? 'manual' : (input.source ?? 'manual')
            }
            onValueChange={(source) =>
              onChange(
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
                {input.type === 'table' ? 'manual' : (input.source ?? 'manual')}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="manual">manual</SelectItem>
              {input.type !== 'table' && (
                <SelectItem value="asset_spec">asset_spec</SelectItem>
              )}
            </SelectContent>
          </Select>
        </Field>
        {input.type !== 'table' && input.source === 'asset_spec' && (
          <>
            <Field label="Especificação">
              <Input
                value={input.assetSpecKey ?? ''}
                onChange={(event) =>
                  onChange({ assetSpecKey: event.target.value })
                }
              />
            </Field>
            <div className="flex items-end gap-2 pb-2">
              <Checkbox
                checked={Boolean(input.allowOverride)}
                onCheckedChange={(checked) =>
                  onChange({ allowOverride: checked === true })
                }
              />
              <span className="text-sm text-muted-foreground">
                Permitir override
              </span>
            </div>
          </>
        )}
      </div>
      {input.type === 'number' && input.source !== 'asset_spec' && (
        <div className="mt-3 space-y-1">
          <div className="md:max-w-xs">
            <QuantityKindField
              value={input.quantityKind}
              onChange={(quantityKind) => onChange({ quantityKind })}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Deltas (incerteza, resolução, correção, tolerância) convertem sem o
            offset da escala entre °C, °F e K.
          </p>
        </div>
      )}
      {input.type === 'select' && (
        <Field label="Opções">
          <Textarea
            value={(input.options ?? []).join('\n')}
            onChange={(event) =>
              onChange({
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
        <TableInputSettings input={input} onChange={onChange} />
      )}
    </div>
  )
}

function TableInputSettings({
  input,
  onChange,
}: {
  input: MethodDraftInput
  onChange: (patch: Partial<MethodDraftInput>) => void
}) {
  return (
    <div className="mt-3 space-y-3">
      <TableColumnsEditor
        columns={input.columns ?? []}
        onChange={(columns) => onChange({ columns })}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={Boolean(input.weighingRangeResolver?.enabled)}
              onCheckedChange={(checked) =>
                onChange({
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
                value={input.weighingRangeResolver.assetSpecKey ?? ''}
                onChange={(event) =>
                  onChange({
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
                value={input.weighingRangeResolver.pointColumn ?? ''}
                onChange={(event) =>
                  onChange({
                    weighingRangeResolver: {
                      ...input.weighingRangeResolver,
                      enabled: true,
                      pointColumn: event.target.value,
                    },
                  })
                }
                placeholder="Coluna do ponto"
              />
              <Select
                value={input.weighingRangeResolver.pointUnit ?? 'g'}
                onValueChange={(pointUnit) =>
                  onChange({
                    weighingRangeResolver: {
                      ...input.weighingRangeResolver,
                      enabled: true,
                      pointUnit: toMassUnit(pointUnit),
                    },
                  })
                }
              >
                <SelectTrigger>
                  <span>{input.weighingRangeResolver.pointUnit ?? 'g'}</span>
                </SelectTrigger>
                <SelectContent>
                  {massUnits.map((unit) => (
                    <SelectItem key={unit} value={unit}>
                      {unit}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="grid gap-2 md:grid-cols-2">
                {weighingRangeTargetFields.map(([targetName, label]) => (
                  <Input
                    key={targetName}
                    value={
                      input.weighingRangeResolver?.targetColumns?.[
                        targetName
                      ] ?? ''
                    }
                    onChange={(event) =>
                      onChange({
                        weighingRangeResolver: {
                          ...input.weighingRangeResolver,
                          enabled: true,
                          targetColumns: {
                            ...input.weighingRangeResolver?.targetColumns,
                            [targetName]: event.target.value,
                          },
                        },
                      })
                    }
                    placeholder={label}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="rounded-md border p-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={Boolean(input.eccentricityIndicator?.enabled)}
              onCheckedChange={(checked) =>
                onChange({
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
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <Select
                value={
                  input.eccentricityIndicator.variant ?? 'circular_platform'
                }
                onValueChange={(variant) => {
                  const nextVariant = toEccentricityVariant(variant)
                  onChange({
                    eccentricityIndicator: {
                      ...input.eccentricityIndicator,
                      enabled: true,
                      variant: nextVariant,
                      loadPoints:
                        input.eccentricityIndicator?.loadPoints ??
                        (nextVariant === 'road_scale'
                          ? ['1', '2', '3', '4']
                          : ['A', 'B', 'C', 'D', 'E']),
                    },
                  })
                }}
              >
                <SelectTrigger>
                  <span>
                    {input.eccentricityIndicator.variant ?? 'circular_platform'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="circular_platform">
                    circular_platform
                  </SelectItem>
                  <SelectItem value="road_scale">road_scale</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={input.eccentricityIndicator.pointColumn ?? ''}
                onChange={(event) =>
                  onChange({
                    eccentricityIndicator: {
                      ...input.eccentricityIndicator,
                      enabled: true,
                      pointColumn: event.target.value,
                    },
                  })
                }
                placeholder="Coluna do ponto"
              />
              <Input
                value={input.eccentricityIndicator.loadPoints?.join(', ') ?? ''}
                onChange={(event) =>
                  onChange({
                    eccentricityIndicator: {
                      ...input.eccentricityIndicator,
                      enabled: true,
                      loadPoints: event.target.value
                        .split(',')
                        .map((point) => point.trim())
                        .filter(Boolean),
                    },
                  })
                }
                placeholder="A, B, C, D, E"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TableColumnsEditor({
  columns,
  onChange,
}: {
  columns: Array<MethodDraftTableColumn>
  onChange: (columns: Array<MethodDraftTableColumn>) => void
}) {
  function updateColumn(index: number, patch: Partial<MethodDraftTableColumn>) {
    onChange(
      columns.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    )
  }

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
        <div key={index} className="space-y-2 rounded-md border p-2">
          <div className="grid gap-2 md:grid-cols-[1fr_1fr_110px_100px_180px_auto]">
            <Input
              value={column.key}
              onChange={(event) =>
                updateColumn(index, { key: event.target.value })
              }
              placeholder="Chave"
            />
            <Input
              value={column.label}
              onChange={(event) =>
                updateColumn(index, { label: event.target.value })
              }
              placeholder="Rótulo"
            />
            <Select
              value={column.type}
              onValueChange={(value) =>
                updateColumn(index, {
                  type: toTableColumnType(value),
                })
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
                updateColumn(index, { unit: event.target.value })
              }
              placeholder="Unidade"
            />
            <Select
              value={column.role ?? 'none'}
              onValueChange={(value) =>
                updateColumn(
                  index,
                  value === 'none'
                    ? { role: undefined, massComposition: undefined }
                    : {
                        role: toTableColumnRole(value),
                        massComposition:
                          value === 'mass_standard_composition'
                            ? {
                                targetUnit:
                                  column.massComposition?.targetUnit ?? 'g',
                                optionSource:
                                  column.massComposition?.optionSource ??
                                  'certified_values',
                                targetColumns:
                                  column.massComposition?.targetColumns ?? {},
                                uncertaintyMode:
                                  column.massComposition?.uncertaintyMode,
                                quantityMode:
                                  column.massComposition?.quantityMode,
                              }
                            : undefined,
                      },
                )
              }
            >
              <SelectTrigger>
                <span>{column.role ?? 'sem papel'}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">sem papel</SelectItem>
                {tableColumnRoles.map((role) => (
                  <SelectItem key={role} value={role}>
                    {role}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <RemoveButton
              label="Remover coluna"
              onClick={() =>
                onChange(columns.filter((_, itemIndex) => itemIndex !== index))
              }
            />
          </div>
          {column.type === 'number' && (
            <div className="md:max-w-xs">
              <QuantityKindField
                value={column.quantityKind}
                onChange={(quantityKind) =>
                  updateColumn(index, { quantityKind })
                }
              />
            </div>
          )}
          {column.role === 'mass_standard_composition' && (
            <MassCompositionColumnEditor
              column={column}
              onChange={(patch) => updateColumn(index, patch)}
            />
          )}
        </div>
      ))}
    </div>
  )
}

function MassCompositionColumnEditor({
  column,
  onChange,
}: {
  column: MethodDraftTableColumn
  onChange: (patch: Partial<MethodDraftTableColumn>) => void
}) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      <Select
        value={column.massComposition?.targetUnit ?? 'g'}
        onValueChange={(targetUnit) =>
          onChange({
            massComposition: {
              ...column.massComposition,
              targetUnit: toMassUnit(targetUnit),
            },
          })
        }
      >
        <SelectTrigger>
          <span>{column.massComposition?.targetUnit ?? 'g'}</span>
        </SelectTrigger>
        <SelectContent>
          {massUnits.map((unit) => (
            <SelectItem key={unit} value={unit}>
              {unit}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={column.massComposition?.optionSource ?? 'certified_values'}
        onValueChange={(optionSource) =>
          onChange({
            massComposition: {
              ...column.massComposition,
              optionSource: toMassCompositionOptionSource(optionSource),
            },
          })
        }
      >
        <SelectTrigger>
          <span>
            {column.massComposition?.optionSource ?? 'certified_values'}
          </span>
        </SelectTrigger>
        <SelectContent>
          {massCompositionOptionSources.map((source) => (
            <SelectItem key={source} value={source}>
              {source}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={column.massComposition?.uncertaintyMode ?? 'none'}
        onValueChange={(uncertaintyMode) =>
          onChange({
            massComposition: {
              ...column.massComposition,
              uncertaintyMode:
                uncertaintyMode === 'none'
                  ? undefined
                  : toMassCompositionUncertaintyMode(uncertaintyMode),
            },
          })
        }
      >
        <SelectTrigger>
          <span>{column.massComposition?.uncertaintyMode ?? 'sem modo'}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">sem modo</SelectItem>
          {massCompositionUncertaintyModes.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {mode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={column.massComposition?.quantityMode ?? 'none'}
        onValueChange={(quantityMode) =>
          onChange({
            massComposition: {
              ...column.massComposition,
              quantityMode:
                quantityMode === 'none'
                  ? undefined
                  : toMassCompositionQuantityMode(quantityMode),
            },
          })
        }
      >
        <SelectTrigger>
          <span>{column.massComposition?.quantityMode ?? 'sem modo'}</span>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">sem modo</SelectItem>
          {massCompositionQuantityModes.map((mode) => (
            <SelectItem key={mode} value={mode}>
              {mode}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {massCompositionTargetFields.map(([targetName, label]) => (
        <Input
          key={targetName}
          value={column.massComposition?.targetColumns?.[targetName] ?? ''}
          onChange={(event) =>
            onChange({
              massComposition: {
                ...column.massComposition,
                targetColumns: {
                  ...column.massComposition?.targetColumns,
                  [targetName]: event.target.value,
                },
              },
            })
          }
          placeholder={label}
        />
      ))}
    </div>
  )
}

function RemoveButton({
  label,
  onClick,
}: {
  label: string
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
      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
    </Button>
  )
}

function toInputType(value: unknown): MethodDraftInputType {
  switch (value) {
    case 'number':
    case 'select':
    case 'table':
    case 'text':
      return value
    default:
      return 'text'
  }
}

function toMassUnit(value: unknown): MassUnit {
  switch (value) {
    case 'mg':
    case 'kg':
    case 'g':
      return value
    default:
      return 'g'
  }
}

function toEccentricityVariant(
  value: unknown,
): NonNullable<MethodDraftInput['eccentricityIndicator']>['variant'] {
  switch (value) {
    case 'road_scale':
    case 'circular_platform':
      return value
    default:
      return 'circular_platform'
  }
}

function toTableColumnType(value: unknown): MethodDraftTableColumn['type'] {
  switch (value) {
    case 'text':
    case 'number':
      return value
    default:
      return 'number'
  }
}

function toTableColumnRole(value: unknown): TableColumnRole {
  switch (value) {
    case 'standard_value':
    case 'mass_standard_composition':
      return value
    default:
      return 'standard_value'
  }
}

function toQuantityKind(value: unknown): MethodDraftQuantityKind {
  return methodDraftQuantityKinds.find((kind) => kind === value) ?? 'other'
}

function toMassCompositionOptionSource(
  value: unknown,
): MassCompositionOptionSource {
  switch (value) {
    case 'composition_profiles':
    case 'certified_values':
      return value
    default:
      return 'certified_values'
  }
}

function toMassCompositionQuantityMode(
  value: unknown,
): MassCompositionQuantityMode {
  switch (value) {
    case 'profile_linear':
    case 'linear_per_item_then_rss':
      return value
    default:
      return 'linear_per_item_then_rss'
  }
}

function toMassCompositionUncertaintyMode(
  value: unknown,
): MassCompositionUncertaintyMode {
  switch (value) {
    case 'expanded_rss':
    case 'expanded_arithmetic':
      return value
    default:
      return 'expanded_rss'
  }
}
