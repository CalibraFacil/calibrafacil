import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { FormField as Field } from '@/shared/forms/form-field'

import { firstNumericSource } from './draft-operations'
import type {
  MethodDraftFormula,
  MethodDraftInput,
  MethodDraftMeasurementModel,
  MethodDraftMeasurementModelQuantity,
  MethodDraftMeasurementModelSource,
} from './types'

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

function parseMeasurementModelScope(
  value: string | null,
): (typeof measurementModelScopes)[number] {
  return value === 'table_row' ? 'table_row' : 'scalar'
}

function parseGumUncertaintyKind(
  value: string | null,
): (typeof gumUncertaintyKinds)[number] {
  switch (value) {
    case 'type_a':
    case 'type_b':
      return value
    default:
      return 'direct_standard_uncertainty'
  }
}

function parseGumDistribution(
  value: string | null,
): (typeof gumDistributions)[number] {
  switch (value) {
    case 'rectangular':
    case 'triangular':
    case 'u_shaped':
    case 'custom':
      return value
    default:
      return 'normal'
  }
}

export function MeasurementModelEditor({
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
          <RemoveButton label="Remover modelo" onClick={onRemove} />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Escopo">
          <Select
            value={scopeKind}
            onValueChange={(value) =>
              changeScope(parseMeasurementModelScope(value))
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
              onValueChange={(tableKey) => {
                if (tableKey) {
                  onChange({ scope: { kind: 'table_row', tableKey } })
                }
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
              <RemoveButton
                label="Remover correlação"
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
              <RemoveButton
                label="Remover covariância"
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
              changeUncertainty(parseGumUncertaintyKind(value))
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
          <RemoveButton label="Remover quantidade" onClick={onRemove} />
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
                    distribution: parseGumDistribution(distribution),
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
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(optionValueToSource(nextValue, inputs, formulas, tableKey))
        }
      }}
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
