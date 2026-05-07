import { useState } from 'react'
import type { MethodFormula } from './types'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'

interface VariableInfo {
  key: string
  label: string
  type: string
}

interface FormulaDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (formula: MethodFormula) => void
  initialData?: MethodFormula
  existingKeys: Array<string>
  availableVariables: Array<VariableInfo>
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_')
}

export function FormulaDialog({
  open,
  onOpenChange,
  onSave,
  initialData,
  existingKeys,
  availableVariables,
}: FormulaDialogProps) {
  const dialogKey = `${open ? 'open' : 'closed'}-${initialData?.outputKey ?? 'new'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <FormulaDialogBody
          key={dialogKey}
          onOpenChange={onOpenChange}
          onSave={onSave}
          initialData={initialData}
          existingKeys={existingKeys}
          availableVariables={availableVariables}
        />
      )}
    </Dialog>
  )
}

function FormulaDialogBody({
  onOpenChange,
  onSave,
  initialData,
  existingKeys,
  availableVariables,
}: Omit<FormulaDialogProps, 'open'>) {
  const [formula, setFormula] = useState<MethodFormula>(
    initialData
      ? { ...initialData }
      : {
          outputKey: '',
          expression: '',
        },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [autoKey, setAutoKey] = useState(!initialData)

  const handleLabelChange = (label: string) => {
    const updates: Partial<MethodFormula> = { label }
    if (autoKey && !initialData) {
      updates.outputKey = slugify(label)
    }
    setFormula((f) => ({ ...f, ...updates }))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!formula.outputKey.trim()) {
      newErrors.outputKey = 'Chave de saída é obrigatória'
    } else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(formula.outputKey)) {
      newErrors.outputKey =
        'Chave deve comecar com letra e conter apenas letras, números e underscore'
    } else if (existingKeys.includes(formula.outputKey)) {
      newErrors.outputKey = 'Esta chave já esta em uso'
    }

    if (!formula.expression.trim()) {
      newErrors.expression = 'Expressão é obrigatória'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    const cleanedFormula = { ...formula }
    if (!cleanedFormula.reporting?.group) {
      cleanedFormula.reporting = undefined
    } else {
      cleanedFormula.reporting = {
        includeInCertificate: true,
        ...cleanedFormula.reporting,
      }
    }
    onSave(cleanedFormula)
  }

  const insertVariable = (varKey: string) => {
    setFormula((f) => {
      const expr = f.expression
      // Add a space before the variable if expression doesn't end with space, operator, or opening paren
      const needsSpace = expr.length > 0 && !/[\s+\-*/%^(,]$/.test(expr)
      return {
        ...f,
        expression: expr + (needsSpace ? ' ' : '') + varKey,
      }
    })
  }

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {initialData ? 'Editar Fórmula' : 'Adicionar Fórmula'}
        </DialogTitle>
        <DialogDescription>
          Defina uma fórmula para calcular resultados a partir dos dados de
          entrada.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <Field>
          <FieldLabel htmlFor="label">Rótulo</FieldLabel>
          <Input
            id="label"
            value={formula.label || ''}
            onChange={(e) => handleLabelChange(e.target.value)}
            placeholder="Ex: Erro de Medição"
          />
          <FieldDescription>
            Nome descritivo para o resultado
          </FieldDescription>
        </Field>

        <Field>
          <FieldLabel htmlFor="outputKey">Chave de Saída *</FieldLabel>
          <Input
            id="outputKey"
            value={formula.outputKey}
            onChange={(e) => {
              setAutoKey(false)
              setFormula((f) => ({ ...f, outputKey: e.target.value }))
            }}
            placeholder="Ex: erro"
          />
          <FieldDescription>
            Nome da variável que armazenara o resultado
          </FieldDescription>
          {errors.outputKey && <FieldError>{errors.outputKey}</FieldError>}
        </Field>

        <Field>
          <FieldLabel htmlFor="expression">Expressão *</FieldLabel>
          <Textarea
            id="expression"
            value={formula.expression}
            onChange={(e) =>
              setFormula((f) => ({ ...f, expression: e.target.value }))
            }
            placeholder="Ex: leitura_1 - padrao"
            rows={3}
            className="font-mono"
          />
          <FieldDescription>
            Use variáveis definidas nos campos de entrada. Funções disponíveis:
            abs(), sqrt(), min(), max(), floor(), ceil(), round(), log(),
            log10(), exp().
          </FieldDescription>
          {errors.expression && <FieldError>{errors.expression}</FieldError>}
        </Field>

        {availableVariables.length > 0 && (
          <Field>
            <FieldLabel>Variaveis Disponiveis</FieldLabel>
            <div className="flex flex-wrap gap-1">
              {availableVariables.map((v) => (
                <Button
                  key={v.key}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => insertVariable(v.key)}
                  className="text-xs"
                >
                  {v.key}
                  <span className="text-muted-foreground ml-1">
                    ({v.type})
                  </span>
                </Button>
              ))}
            </div>
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="unit">Unidade do Resultado</FieldLabel>
          <Input
            id="unit"
            value={formula.unit || ''}
            onChange={(e) =>
              setFormula((f) => ({
                ...f,
                unit: e.target.value || undefined,
              }))
            }
            placeholder="Ex: mm"
          />
        </Field>

        <Field>
          <FieldLabel htmlFor="reportingGroup">Grupo no certificado</FieldLabel>
          <Select
            value={formula.reporting?.group ?? 'none'}
            onValueChange={(value) =>
              setFormula((f) => ({
                ...f,
                reporting:
                  value === 'none'
                    ? undefined
                    : {
                        ...f.reporting,
                        group: value as NonNullable<
                          MethodFormula['reporting']
                        >['group'],
                        includeInCertificate: true,
                      },
              }))
            }
          >
            <SelectTrigger>
              <span>
                {formula.reporting?.group === 'calibration_result'
                  ? 'Resultado da calibração'
                  : formula.reporting?.group === 'uncertainty_budget'
                    ? 'Orçamento de incerteza'
                    : formula.reporting?.group === 'raw_calculation'
                      ? 'Cálculo auxiliar'
                      : 'Tabela genérica'}
              </span>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Tabela genérica</SelectItem>
              <SelectItem value="calibration_result">
                Resultado da calibração
              </SelectItem>
              <SelectItem value="uncertainty_budget">
                Orçamento de incerteza
              </SelectItem>
              <SelectItem value="raw_calculation">Cálculo auxiliar</SelectItem>
            </SelectContent>
          </Select>
          <FieldDescription>
            Use estes metadados para montar o certificado RBC-like sem amarrar o
            layout a um tipo de instrumento.
          </FieldDescription>
        </Field>

        {formula.reporting?.group && (
          <Field>
            <FieldLabel htmlFor="reportingRole">Papel no relatório</FieldLabel>
            <Select
              value={formula.reporting?.role ?? 'auxiliary'}
              onValueChange={(value) =>
                setFormula((f) => ({
                  ...f,
                  reporting: {
                    ...f.reporting,
                    role: value as NonNullable<
                      MethodFormula['reporting']
                    >['role'],
                  },
                }))
              }
            >
              <SelectTrigger>
                <span>
                  {formula.reporting?.role === 'primary_result'
                    ? 'Resultado principal'
                    : formula.reporting?.role === 'expanded_uncertainty'
                      ? 'Incerteza expandida'
                      : formula.reporting?.role === 'coverage_factor'
                        ? 'Fator k'
                        : formula.reporting?.role === 'conformity_margin'
                          ? 'Margem de conformidade'
                          : formula.reporting?.role ===
                              'uncertainty_component'
                            ? 'Componente de incerteza'
                            : 'Auxiliar'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="primary_result">
                  Resultado principal
                </SelectItem>
                <SelectItem value="expanded_uncertainty">
                  Incerteza expandida
                </SelectItem>
                <SelectItem value="coverage_factor">Fator k</SelectItem>
                <SelectItem value="conformity_margin">
                  Margem de conformidade
                </SelectItem>
                <SelectItem value="uncertainty_component">
                  Componente de incerteza
                </SelectItem>
                <SelectItem value="auxiliary">Auxiliar</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button onClick={handleSave}>
          {initialData ? 'Salvar' : 'Adicionar'}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
