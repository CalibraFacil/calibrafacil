import { Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { FormField as Field } from '@/shared/forms/form-field'

import type { MethodDraftFormula, MethodDraftInput } from './types'

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

export function FormulaEditor({
  formula,
  inputs,
  onChange,
  onRemove,
}: {
  formula: MethodDraftFormula
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
          <RemoveButton label="Remover fórmula" onClick={onRemove} />
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
