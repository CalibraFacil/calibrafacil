import { useEffect, useState } from 'react'
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
  const [formula, setFormula] = useState<MethodFormula>({
    outputKey: '',
    expression: '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [autoKey, setAutoKey] = useState(true)

  useEffect(() => {
    if (open) {
      if (initialData) {
        setFormula(initialData)
        setAutoKey(false)
      } else {
        setFormula({
          outputKey: '',
          expression: '',
        })
        setAutoKey(true)
      }
      setErrors({})
    }
  }, [open, initialData])

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
    onSave(formula)
  }

  const insertVariable = (varKey: string) => {
    setFormula((f) => ({
      ...f,
      expression: f.expression + varKey,
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              Use variáveis definidas nos campos de entrada. Funções
              disponíveis: abs(), sqrt(), mean(), std(), min(), max(), round()
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
    </Dialog>
  )
}
