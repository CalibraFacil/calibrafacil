import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import {
  Add01Icon,
  ArrowDown01Icon,
  Delete02Icon,
  Edit02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { InputFieldDialog } from './input-field-dialog'
import { FormulaDialog } from './formula-dialog'
import { ValidationDialog } from './validation-dialog'

import type {
  MethodData,
  MethodFormula,
  MethodInputField,
  MethodValidation,
} from './types'
import type { SpecFieldDefinition } from '@/components/dynamic-specs-form'

import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { api } from '@/utils/api'

interface ConfigurationPanelProps {
  method: MethodData
  onChange: (updates: Partial<MethodData>) => void
  disabled?: boolean
}

type AssetType = {
  id: number
  name: string
  slug: string
  definition: Array<SpecFieldDefinition>
}

export function ConfigurationPanel({
  method,
  onChange,
  disabled = false,
}: ConfigurationPanelProps) {
  const [inputDialogOpen, setInputDialogOpen] = useState(false)
  const [formulaDialogOpen, setFormulaDialogOpen] = useState(false)
  const [validationDialogOpen, setValidationDialogOpen] = useState(false)
  const [editingInputIndex, setEditingInputIndex] = useState<number | null>(
    null,
  )
  const [editingFormulaIndex, setEditingFormulaIndex] = useState<number | null>(
    null,
  )
  const [editingValidationIndex, setEditingValidationIndex] = useState<
    number | null
  >(null)

  // Section collapse state
  const [sectionsOpen, setSectionsOpen] = useState({
    basic: true,
    inputs: true,
    formulas: true,
    validations: true,
  })

  // Fetch asset types for dropdown
  const { data: assetTypesData } = useQuery({
    queryKey: ['asset-types'],
    queryFn: async () => {
      const res = await api.api['asset-types'].$get({ query: {} })
      if (!res.ok) throw new Error('Falha ao carregar tipos')
      return res.json() as Promise<{ data: Array<AssetType> }>
    },
    staleTime: 60000,
  })

  // Input field handlers
  const handleAddInput = (field: MethodInputField) => {
    onChange({ dataFields: [...method.dataFields, field] })
    setInputDialogOpen(false)
  }

  const handleEditInput = (field: MethodInputField) => {
    if (editingInputIndex !== null) {
      const newFields = [...method.dataFields]
      newFields[editingInputIndex] = field
      onChange({ dataFields: newFields })
      setEditingInputIndex(null)
    }
    setInputDialogOpen(false)
  }

  const handleDeleteInput = (index: number) => {
    const newFields = method.dataFields.filter((_, i) => i !== index)
    onChange({ dataFields: newFields })
  }

  // Formula handlers
  const handleAddFormula = (formula: MethodFormula) => {
    onChange({ formulas: [...method.formulas, formula] })
    setFormulaDialogOpen(false)
  }

  const handleEditFormula = (formula: MethodFormula) => {
    if (editingFormulaIndex !== null) {
      const newFormulas = [...method.formulas]
      newFormulas[editingFormulaIndex] = formula
      onChange({ formulas: newFormulas })
      setEditingFormulaIndex(null)
    }
    setFormulaDialogOpen(false)
  }

  const handleDeleteFormula = (index: number) => {
    const newFormulas = method.formulas.filter((_, i) => i !== index)
    onChange({ formulas: newFormulas })
  }

  // Validation handlers
  const handleAddValidation = (validation: MethodValidation) => {
    onChange({ validations: [...method.validations, validation] })
    setValidationDialogOpen(false)
  }

  const handleEditValidation = (validation: MethodValidation) => {
    if (editingValidationIndex !== null) {
      const newValidations = [...method.validations]
      newValidations[editingValidationIndex] = validation
      onChange({ validations: newValidations })
      setEditingValidationIndex(null)
    }
    setValidationDialogOpen(false)
  }

  const handleDeleteValidation = (index: number) => {
    const newValidations = method.validations.filter((_, i) => i !== index)
    onChange({ validations: newValidations })
  }

  // Get available variables for formula autocomplete
  const availableVariables = method.dataFields.map((f) => ({
    key: f.key,
    label: f.label,
    type: f.type,
  }))

  // Add formula outputs as variables too
  const formulaVariables = method.formulas.map((f) => ({
    key: f.outputKey,
    label: f.label || f.outputKey,
    type: 'formula' as const,
  }))

  const allVariables = [...availableVariables, ...formulaVariables]
  const selectedAssetType = assetTypesData?.data?.find(
    (type) => type.id === method.assetTypeId,
  )

  return (
    <div className="p-4 space-y-4">
      {/* Basic Info Section */}
      <Collapsible
        open={sectionsOpen.basic}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, basic: open }))}
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">Informações Básicas</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.basic ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="name">Nome do Método *</FieldLabel>
              <Input
                id="name"
                value={method.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Ex: Calibração de Micrômetro 0-25mm"
                disabled={disabled}
              />
              <FieldDescription>
                Nome descritivo para identificar o método
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Descrição</FieldLabel>
              <Textarea
                id="description"
                value={method.description || ''}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Descreva o procedimento de calibração..."
                disabled={disabled}
                rows={3}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="assetType">Tipo de Instrumento</FieldLabel>
              <Select
                value={method.assetTypeId ? String(method.assetTypeId) : ''}
                onValueChange={(value) =>
                  onChange({ assetTypeId: value ? Number(value) : undefined })
                }
                disabled={disabled}
              >
                <SelectTrigger>
                  <span>
                    {method.assetTypeId
                      ? assetTypesData?.data?.find(
                          (t) => t.id === method.assetTypeId,
                        )?.name || 'Selecione...'
                      : 'Selecione (opcional)...'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  {assetTypesData?.data?.map((type) => (
                    <SelectItem key={type.id} value={String(type.id)}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldDescription>
                Vincule este método a um tipo de instrumento específico
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      {/* Input Fields Section */}
      <Collapsible
        open={sectionsOpen.inputs}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, inputs: open }))
        }
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">
            Campos de Entrada ({method.dataFields.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.inputs ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          {method.dataFields.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">
              Nenhum campo de entrada definido. Adicione campos para coletar
              dados durante a calibração.
            </p>
          ) : (
            <div className="space-y-2">
              {method.dataFields.map((field, index) => (
                <div
                  key={field.key}
                  className="flex items-center justify-between p-2 border rounded bg-muted/30"
                >
                  <div>
                    <span className="font-medium">{field.label}</span>
                    <span className="text-xs text-muted-foreground ml-2">
                      ({field.key}: {field.type}
                      {field.unit && ` [${field.unit}]`})
                    </span>
                    {field.required && (
                      <span className="text-xs text-red-500 ml-1">*</span>
                    )}
                    {field.source === 'asset_spec' && (
                      <span className="text-xs text-muted-foreground ml-2">
                        · Ativo: {field.assetSpecKey}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingInputIndex(index)
                        setInputDialogOpen(true)
                      }}
                      disabled={disabled}
                    >
                      <HugeiconsIcon icon={Edit02Icon} className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteInput(index)}
                      disabled={disabled}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingInputIndex(null)
              setInputDialogOpen(true)
            }}
            disabled={disabled}
          >
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
            Adicionar Campo
          </Button>
        </CollapsibleContent>
      </Collapsible>

      {/* Formulas Section */}
      <Collapsible
        open={sectionsOpen.formulas}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, formulas: open }))
        }
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">
            Formulas ({method.formulas.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.formulas ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          {method.formulas.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">
              Nenhuma fórmula definida. Adicione formulas para calcular
              resultados.
            </p>
          ) : (
            <div className="space-y-2">
              {method.formulas.map((formula, index) => (
                <div
                  key={formula.outputKey}
                  className="flex items-center justify-between p-2 border rounded bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-medium">
                      {formula.label || formula.outputKey}
                    </span>
                    <code className="text-xs text-muted-foreground ml-2 bg-muted px-1 rounded">
                      {formula.expression}
                    </code>
                    {formula.reporting?.group && (
                      <span className="text-xs text-muted-foreground ml-2">
                        · Certificado: {formula.reporting.group}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingFormulaIndex(index)
                        setFormulaDialogOpen(true)
                      }}
                      disabled={disabled}
                    >
                      <HugeiconsIcon icon={Edit02Icon} className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteFormula(index)}
                      disabled={disabled}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingFormulaIndex(null)
              setFormulaDialogOpen(true)
            }}
            disabled={disabled}
          >
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
            Adicionar Fórmula
          </Button>
        </CollapsibleContent>
      </Collapsible>

      {/* Validations Section */}
      <Collapsible
        open={sectionsOpen.validations}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, validations: open }))
        }
      >
        <CollapsibleTrigger className="flex items-center justify-between w-full p-2 hover:bg-muted/50 rounded">
          <span className="font-medium">
            Critérios de Aceitação ({method.validations.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            className={`h-4 w-4 transition-transform ${sectionsOpen.validations ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          {method.validations.length === 0 ? (
            <p className="text-sm text-muted-foreground p-2">
              Nenhum critério definido. Adicione critérios de
              aprovação/reprovação.
            </p>
          ) : (
            <div className="space-y-2">
              {method.validations.map((validation, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-2 border rounded bg-muted/30"
                >
                  <div className="flex-1 min-w-0">
                    <span
                      className={`text-xs px-1 rounded ${validation.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {validation.severity === 'error' ? 'Erro' : 'Aviso'}
                    </span>
                    <code className="text-xs text-muted-foreground ml-2 bg-muted px-1 rounded">
                      {validation.expression}
                    </code>
                    <p className="text-sm text-muted-foreground truncate">
                      {validation.message}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditingValidationIndex(index)
                        setValidationDialogOpen(true)
                      }}
                      disabled={disabled}
                    >
                      <HugeiconsIcon icon={Edit02Icon} className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteValidation(index)}
                      disabled={disabled}
                    >
                      <HugeiconsIcon icon={Delete02Icon} className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setEditingValidationIndex(null)
              setValidationDialogOpen(true)
            }}
            disabled={disabled}
          >
            <HugeiconsIcon icon={Add01Icon} className="h-4 w-4 mr-2" />
            Adicionar Critério
          </Button>
        </CollapsibleContent>
      </Collapsible>

      {/* Dialogs */}
      <InputFieldDialog
        open={inputDialogOpen}
        onOpenChange={setInputDialogOpen}
        onSave={editingInputIndex !== null ? handleEditInput : handleAddInput}
        initialData={
          editingInputIndex !== null
            ? method.dataFields[editingInputIndex]
            : undefined
        }
        existingKeys={method.dataFields
          .filter((_, i) => i !== editingInputIndex)
          .map((f) => f.key)}
        assetTypeDefinition={selectedAssetType?.definition ?? []}
      />

      <FormulaDialog
        open={formulaDialogOpen}
        onOpenChange={setFormulaDialogOpen}
        onSave={
          editingFormulaIndex !== null ? handleEditFormula : handleAddFormula
        }
        initialData={
          editingFormulaIndex !== null
            ? method.formulas[editingFormulaIndex]
            : undefined
        }
        existingKeys={method.formulas
          .filter((_, i) => i !== editingFormulaIndex)
          .map((f) => f.outputKey)}
        availableVariables={allVariables}
      />

      <ValidationDialog
        open={validationDialogOpen}
        onOpenChange={setValidationDialogOpen}
        onSave={
          editingValidationIndex !== null
            ? handleEditValidation
            : handleAddValidation
        }
        initialData={
          editingValidationIndex !== null
            ? method.validations[editingValidationIndex]
            : undefined
        }
        availableVariables={allVariables}
      />
    </div>
  )
}
