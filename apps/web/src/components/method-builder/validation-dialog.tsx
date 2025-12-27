import { useEffect, useState } from 'react'

import type { MethodValidation } from './types'

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

interface ValidationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (validation: MethodValidation) => void
  initialData?: MethodValidation
  availableVariables: Array<VariableInfo>
}

export function ValidationDialog({
  open,
  onOpenChange,
  onSave,
  initialData,
  availableVariables,
}: ValidationDialogProps) {
  const [validation, setValidation] = useState<MethodValidation>({
    expression: '',
    message: '',
    severity: 'error',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      if (initialData) {
        setValidation(initialData)
      } else {
        setValidation({
          expression: '',
          message: '',
          severity: 'error',
        })
      }
      setErrors({})
    }
  }, [open, initialData])

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!validation.expression.trim()) {
      newErrors.expression = 'Expressão é obrigatória'
    }

    if (!validation.message.trim()) {
      newErrors.message = 'Mensagem é obrigatória'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = () => {
    if (!validate()) return
    onSave(validation)
  }

  const insertVariable = (varKey: string) => {
    setValidation((v) => ({
      ...v,
      expression: v.expression + varKey,
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {initialData
              ? 'Editar Critério'
              : 'Adicionar Critério de Aceitação'}
          </DialogTitle>
          <DialogDescription>
            Defina um critério de aprovação/reprovação para validar os
            resultados da calibração.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <Field>
            <FieldLabel htmlFor="expression">Expressão Booleana *</FieldLabel>
            <Textarea
              id="expression"
              value={validation.expression}
              onChange={(e) =>
                setValidation((v) => ({ ...v, expression: e.target.value }))
              }
              placeholder="Ex: abs(erro) < 0.01"
              rows={2}
              className="font-mono"
            />
            <FieldDescription>
              A expressão deve retornar verdadeiro (aprovado) ou falso
              (reprovado). Operadores: {'<'}, {'>'}, {'<='}, {'>='}, ==, !=, &&,
              ||
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
            <FieldLabel htmlFor="message">Mensagem *</FieldLabel>
            <Input
              id="message"
              value={validation.message}
              onChange={(e) =>
                setValidation((v) => ({ ...v, message: e.target.value }))
              }
              placeholder="Ex: Erro excede tolerância permitida"
            />
            <FieldDescription>
              Mensagem exibida quando o critério falha
            </FieldDescription>
            {errors.message && <FieldError>{errors.message}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="severity">Severidade</FieldLabel>
            <Select
              value={validation.severity}
              onValueChange={(v) =>
                setValidation((val) => ({
                  ...val,
                  severity: v as 'error' | 'warning',
                }))
              }
            >
              <SelectTrigger>
                <span>
                  {validation.severity === 'error' ? 'Erro (Reprova)' : 'Aviso'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="error">Erro (Reprova)</SelectItem>
                <SelectItem value="warning">Aviso (Apenas alerta)</SelectItem>
              </SelectContent>
            </Select>
            <FieldDescription>
              Erros impedem a aprovação. Avisos apenas alertam o usuário.
            </FieldDescription>
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
