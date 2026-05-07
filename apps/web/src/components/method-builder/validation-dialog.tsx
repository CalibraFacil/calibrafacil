import { useState } from 'react'

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
  const dialogKey = `${open ? 'open' : 'closed'}-${initialData?.leftExpression ?? 'new'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <ValidationDialogBody
          key={dialogKey}
          onOpenChange={onOpenChange}
          onSave={onSave}
          initialData={initialData}
          availableVariables={availableVariables}
        />
      )}
    </Dialog>
  )
}

function ValidationDialogBody({
  onOpenChange,
  onSave,
  initialData,
  availableVariables,
}: Omit<ValidationDialogProps, 'open'>) {
  const [validation, setValidation] = useState<MethodValidation>(
    initialData
      ? { ...initialData }
      : {
          leftExpression: '',
          operator: '<=',
          rightExpression: '',
          message: '',
          severity: 'error',
        },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!validation.leftExpression.trim()) {
      newErrors.leftExpression = 'Expressão esquerda é obrigatória'
    }

    if (!validation.rightExpression.trim()) {
      newErrors.rightExpression = 'Expressão direita é obrigatória'
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

  const insertVariable = (
    side: 'leftExpression' | 'rightExpression',
    varKey: string,
  ) => {
    setValidation((v) => {
      const expr = v[side]
      // Add a space before the variable if expression doesn't end with space, operator, or opening paren
      const needsSpace = expr.length > 0 && !/[\s+\-*/^(,]$/.test(expr)
      return {
        ...v,
        [side]: expr + (needsSpace ? ' ' : '') + varKey,
      }
    })
  }

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {initialData ? 'Editar Critério' : 'Adicionar Critério de Aceitação'}
        </DialogTitle>
        <DialogDescription>
          Defina um critério de aprovação/reprovação para validar os resultados
          da calibração.
        </DialogDescription>
      </DialogHeader>

        <div className="space-y-4 py-4">
          <Field>
            <FieldLabel htmlFor="leftExpression">
              Expressão esquerda *
            </FieldLabel>
            <Textarea
              id="leftExpression"
              value={validation.leftExpression}
              onChange={(e) =>
                setValidation((v) => ({
                  ...v,
                  leftExpression: e.target.value,
                }))
              }
              placeholder="Ex: abs(erro)"
              rows={2}
              className="font-mono"
            />
            <FieldDescription>
              Expressão escalar avaliada pelo motor matemático.
            </FieldDescription>
            {errors.leftExpression && (
              <FieldError>{errors.leftExpression}</FieldError>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="operator">Operador</FieldLabel>
            <Select
              value={validation.operator}
              onValueChange={(operator) =>
                setValidation((v) => ({
                  ...v,
                  operator: operator as MethodValidation['operator'],
                }))
              }
            >
              <SelectTrigger>
                <span>{validation.operator}</span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="<">{'<'}</SelectItem>
                <SelectItem value="<=">{'<='}</SelectItem>
                <SelectItem value=">">{'>'}</SelectItem>
                <SelectItem value=">=">{'>='}</SelectItem>
                <SelectItem value="==">==</SelectItem>
                <SelectItem value="!=">!=</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="rightExpression">
              Expressão direita *
            </FieldLabel>
            <Textarea
              id="rightExpression"
              value={validation.rightExpression}
              onChange={(e) =>
                setValidation((v) => ({
                  ...v,
                  rightExpression: e.target.value,
                }))
              }
              placeholder="Ex: tolerancia_maxima"
              rows={2}
              className="font-mono"
            />
            <FieldDescription>
              Expressão escalar usada como limite ou referência.
            </FieldDescription>
            {errors.rightExpression && (
              <FieldError>{errors.rightExpression}</FieldError>
            )}
          </Field>

          {availableVariables.length > 0 && (
            <Field>
              <FieldLabel>Variáveis Disponíveis</FieldLabel>
              <div className="flex flex-wrap gap-1">
                {availableVariables.flatMap((v) => [
                  <Button
                    key={`${v.key}-left`}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable('leftExpression', v.key)}
                    className="text-xs"
                  >
                    {v.key}
                    <span className="text-muted-foreground ml-1">
                      ({v.type})
                    </span>
                  </Button>,
                  <Button
                    key={`${v.key}-right`}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable('rightExpression', v.key)}
                    className="text-xs"
                  >
                    {v.key} direita
                  </Button>,
                ])}
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
  )
}
