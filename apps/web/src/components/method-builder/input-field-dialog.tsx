import { useState } from 'react'

import { HugeiconsIcon } from '@hugeicons/react'
import { Add01Icon, Delete02Icon } from '@hugeicons/core-free-icons'

import type { MethodInputField, MethodTableColumn } from './types'

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'

interface InputFieldDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (field: MethodInputField) => void
  initialData?: MethodInputField
  existingKeys: Array<string>
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]+/g, '_') // Replace non-alphanumeric with underscore
    .replace(/^_+|_+$/g, '') // Trim underscores
    .replace(/_+/g, '_') // Collapse multiple underscores
}

// Reserved words from math-engine that cannot be used as variable keys
const MATH_ENGINE_RESERVED_WORDS = new Set([
  // Math.js built-in functions
  'abs',
  'sqrt',
  'pow',
  'exp',
  'log',
  'log10',
  'log2',
  'sin',
  'cos',
  'tan',
  'asin',
  'acos',
  'atan',
  'atan2',
  'sinh',
  'cosh',
  'tanh',
  'asinh',
  'acosh',
  'atanh',
  'ceil',
  'floor',
  'round',
  'trunc',
  'sign',
  'min',
  'max',
  'mean',
  'median',
  'std',
  'variance',
  'sum',
  'prod',
  'gcd',
  'lcm',
  'mod',
  'factorial',
  // Constants
  'pi',
  'e',
  'i',
  'Infinity',
  'NaN',
  'true',
  'false',
  'null',
  // Math-engine specific context variables
  'u_typeA',
  'u_typeB',
  'u_combined',
  'U_expanded',
  'k',
  'mean',
  'std_dev',
  'n',
  // Blocked functions (security)
  'import',
  'createUnit',
  'reviver',
  'evaluate',
  'parse',
  'simplify',
  'derivative',
  'resolve',
  'compile',
  'chain',
])

function isReservedWord(key: string): boolean {
  return MATH_ENGINE_RESERVED_WORDS.has(key.toLowerCase())
}

const defaultColumn: MethodTableColumn = {
  key: 'value',
  label: 'Valor',
  type: 'number',
}

export function InputFieldDialog({
  open,
  onOpenChange,
  onSave,
  initialData,
  existingKeys,
}: InputFieldDialogProps) {
  const dialogKey = `${open ? 'open' : 'closed'}-${initialData?.key ?? 'new'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <InputFieldDialogBody
          key={dialogKey}
          onOpenChange={onOpenChange}
          onSave={onSave}
          initialData={initialData}
          existingKeys={existingKeys}
        />
      )}
    </Dialog>
  )
}

function InputFieldDialogBody({
  onOpenChange,
  onSave,
  initialData,
  existingKeys,
}: Omit<InputFieldDialogProps, 'open'>) {
  const [field, setField] = useState<MethodInputField>(
    initialData
      ? { ...initialData }
      : {
          key: '',
          label: '',
          type: 'number',
          required: false,
        },
  )
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [autoKey, setAutoKey] = useState(!initialData)

  const handleLabelChange = (label: string) => {
    const updates: Partial<MethodInputField> = { label }
    if (autoKey && !initialData) {
      updates.key = slugify(label)
    }
    setField((f) => ({ ...f, ...updates }))
  }

  const handleTypeChange = (type: MethodInputField['type']) => {
    const updates: Partial<MethodInputField> = { type }
    // Initialize columns for table type
    if (type === 'table' && !field.columns) {
      updates.columns = [{ ...defaultColumn }]
    }
    // Initialize options for select type
    if (type === 'select' && !field.options) {
      updates.options = ['']
    }
    // Clear type-specific data when changing away
    if (type !== 'table') {
      updates.columns = undefined
    }
    if (type !== 'select') {
      updates.options = undefined
    }
    setField((f) => ({ ...f, ...updates }))
  }

  const addColumn = () => {
    const newColumns = [...(field.columns || []), { ...defaultColumn }]
    setField((f) => ({ ...f, columns: newColumns }))
  }

  // Track which column keys have been manually edited
  const [manualColumnKeys, setManualColumnKeys] = useState<Set<number>>(() => {
    if (initialData?.columns) {
      return new Set(initialData.columns.map((_, i) => i))
    }
    return new Set()
  })

  const updateColumn = (index: number, updates: Partial<MethodTableColumn>) => {
    const newColumns = [...(field.columns || [])]
    newColumns[index] = { ...newColumns[index], ...updates }
    setField((f) => ({ ...f, columns: newColumns }))
  }

  const updateColumnLabel = (index: number, label: string) => {
    const updates: Partial<MethodTableColumn> = { label }
    // Only auto-generate key if user hasn't manually edited it
    if (!manualColumnKeys.has(index)) {
      updates.key = slugify(label)
    }
    updateColumn(index, updates)
  }

  const updateColumnKey = (index: number, key: string) => {
    // Mark this column's key as manually edited
    setManualColumnKeys((prev) => new Set(prev).add(index))
    updateColumn(index, { key })
  }

  const removeColumn = (index: number) => {
    const newColumns = (field.columns || []).filter((_, i) => i !== index)
    setField((f) => ({ ...f, columns: newColumns }))
  }

  const addOption = () => {
    const newOptions = [...(field.options || []), '']
    setField((f) => ({ ...f, options: newOptions }))
  }

  const updateOption = (index: number, value: string) => {
    const newOptions = [...(field.options || [])]
    newOptions[index] = value
    setField((f) => ({ ...f, options: newOptions }))
  }

  const removeOption = (index: number) => {
    const newOptions = (field.options || []).filter((_, i) => i !== index)
    setField((f) => ({ ...f, options: newOptions }))
  }

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {}

    if (!field.label.trim()) {
      newErrors.label = 'Rótulo é obrigatório'
    }

    if (!field.key.trim()) {
      newErrors.key = 'Chave é obrigatória'
    } else if (!/^[a-zA-Z][a-zA-Z0-9_]*$/.test(field.key)) {
      newErrors.key =
        'Chave deve começar com letra e conter apenas letras, números e underscore'
    } else if (existingKeys.includes(field.key)) {
      newErrors.key = 'Esta chave já está em uso'
    } else if (isReservedWord(field.key)) {
      newErrors.key =
        'Esta chave é uma palavra reservada do motor de cálculo (ex: abs, sqrt, mean, etc.)'
    }

    if (field.type === 'select') {
      const validOptions = (field.options || []).filter((o) => o.trim())
      if (validOptions.length === 0) {
        newErrors.options = 'Adicione pelo menos uma opção'
      }
    }

    if (field.type === 'table') {
      if (!field.columns || field.columns.length === 0) {
        newErrors.columns = 'Adicione pelo menos uma coluna'
      } else {
        const hasEmptyKey = field.columns.some((c) => !c.key.trim())
        const hasEmptyLabel = field.columns.some((c) => !c.label.trim())
        if (hasEmptyKey || hasEmptyLabel) {
          newErrors.columns = 'Todas as colunas precisam de chave e rótulo'
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSave = () => {
    if (!validate()) return

    // Clean up options for select type
    const cleanedField = { ...field }
    if (cleanedField.type === 'select') {
      cleanedField.options = (cleanedField.options || []).filter((o) =>
        o.trim(),
      )
    }

    onSave(cleanedField)
  }

  return (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>
          {initialData ? 'Editar Campo' : 'Adicionar Campo'}
        </DialogTitle>
        <DialogDescription>
          Defina um campo de entrada para coleta de dados durante a calibração.
        </DialogDescription>
      </DialogHeader>

        <div className="space-y-4 py-4">
          <Field>
            <FieldLabel htmlFor="label">Rótulo *</FieldLabel>
            <Input
              id="label"
              value={field.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="Ex: Leitura 1"
            />
            {errors.label && <FieldError>{errors.label}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="key">Chave (variável) *</FieldLabel>
            <Input
              id="key"
              value={field.key}
              onChange={(e) => {
                setAutoKey(false)
                setField((f) => ({ ...f, key: e.target.value }))
              }}
              placeholder="Ex: leitura_1"
            />
            <FieldDescription>
              Nome da variável usada nas fórmulas
            </FieldDescription>
            {errors.key && <FieldError>{errors.key}</FieldError>}
          </Field>

          <Field>
            <FieldLabel htmlFor="type">Tipo</FieldLabel>
            <Select
              value={field.type}
              onValueChange={(v) =>
                handleTypeChange(v as MethodInputField['type'])
              }
            >
              <SelectTrigger>
                <span>
                  {field.type === 'number'
                    ? 'Número'
                    : field.type === 'text'
                      ? 'Texto'
                      : field.type === 'select'
                        ? 'Seleção'
                        : 'Tabela'}
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="number">Número</SelectItem>
                <SelectItem value="text">Texto</SelectItem>
                <SelectItem value="select">Seleção</SelectItem>
                <SelectItem value="table">Tabela</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {(field.type === 'number' || field.type === 'text') && (
            <Field>
              <FieldLabel htmlFor="unit">Unidade</FieldLabel>
              <Input
                id="unit"
                value={field.unit || ''}
                onChange={(e) =>
                  setField((f) => ({ ...f, unit: e.target.value || undefined }))
                }
                placeholder="Ex: mm, g, degC"
              />
            </Field>
          )}

          <Field>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="required">Obrigatório</FieldLabel>
              <Switch
                id="required"
                checked={field.required || false}
                onCheckedChange={(checked) =>
                  setField((f) => ({ ...f, required: checked }))
                }
              />
            </div>
          </Field>

          {/* Select Options */}
          {field.type === 'select' && (
            <Field>
              <FieldLabel>Opcoes</FieldLabel>
              <div className="space-y-2">
                {(field.options || []).map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={option}
                      onChange={(e) => updateOption(index, e.target.value)}
                      placeholder={`Opcao ${index + 1}`}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeOption(index)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addOption}
                >
                  <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
                  Adicionar Opcao
                </Button>
              </div>
              {errors.options && <FieldError>{errors.options}</FieldError>}
            </Field>
          )}

          {/* Table Columns */}
          {field.type === 'table' && (
            <Field>
              <FieldLabel>Colunas da Tabela</FieldLabel>
              <div className="space-y-2">
                {(field.columns || []).map((column, index) => (
                  <div
                    key={index}
                    className="flex gap-2 items-start p-2 border rounded"
                  >
                    <div className="flex-1 space-y-2">
                      <Input
                        value={column.label}
                        onChange={(e) =>
                          updateColumnLabel(index, e.target.value)
                        }
                        placeholder="Rótulo"
                      />
                      <div className="flex gap-2">
                        <Input
                          value={column.key}
                          onChange={(e) =>
                            updateColumnKey(index, e.target.value)
                          }
                          placeholder="Chave"
                          className="flex-1"
                        />
                        <Select
                          value={column.type}
                          onValueChange={(v) =>
                            updateColumn(index, {
                              type: v as 'text' | 'number',
                            })
                          }
                        >
                          <SelectTrigger className="w-24">
                            <span>
                              {column.type === 'number' ? 'Num' : 'Texto'}
                            </span>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="number">Número</SelectItem>
                            <SelectItem value="text">Texto</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          value={column.unit || ''}
                          onChange={(e) =>
                            updateColumn(index, {
                              unit: e.target.value || undefined,
                            })
                          }
                          placeholder="Un."
                          className="w-16"
                        />
                      </div>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeColumn(index)}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addColumn}
                >
                  <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
                  Adicionar Coluna
                </Button>
              </div>
              {errors.columns && <FieldError>{errors.columns}</FieldError>}
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
