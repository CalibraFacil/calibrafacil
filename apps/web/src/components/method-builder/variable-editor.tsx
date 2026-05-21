import { Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { FormField as Field } from '@/shared/forms/form-field'

import type { MethodDraftInput, MethodDraftVariableBinding } from './types'

function parseTableStatistic(
  statistic: string | null,
): Extract<
  MethodDraftVariableBinding,
  { source: 'table_statistic' }
>['statistic'] {
  switch (statistic) {
    case 'sample_stddev':
    case 'count':
    case 'min':
    case 'max':
      return statistic
    default:
      return 'mean'
  }
}

function parseEnvironmentField(
  field: string | null,
): Extract<MethodDraftVariableBinding, { source: 'environment' }>['field'] {
  switch (field) {
    case 'humidity':
    case 'pressure':
      return field
    default:
      return 'temperature'
  }
}

export function VariableEditor({
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
          <RemoveButton label="Remover variável" onClick={onRemove} />
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
                  statistic: parseTableStatistic(statistic),
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
                  field: parseEnvironmentField(field),
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
