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
import { CertificateContentPanel } from './certificate-content-panel'

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
    certificate: true,
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
    <div className="space-y-0 divide-y">
      {/* Basic Info Section */}
      <Collapsible
        open={sectionsOpen.basic}
        onOpenChange={(open) => setSectionsOpen((s) => ({ ...s, basic: open }))}
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">Informações Básicas</span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.basic ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-5">
          <FieldGroup className="gap-5">
            <Field>
              <FieldLabel htmlFor="name">Nome do Método *</FieldLabel>
              <Input
                id="name"
                name="name"
                value={method.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Ex.: Calibração de Micrômetro 0-25 mm…"
                disabled={disabled}
                autoComplete="off"
              />
              <FieldDescription>
                Nome descritivo para identificar o método.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Descrição</FieldLabel>
              <Textarea
                id="description"
                name="description"
                value={method.description || ''}
                onChange={(e) => onChange({ description: e.target.value })}
                placeholder="Descreva o procedimento de calibração…"
                disabled={disabled}
                rows={3}
                autoComplete="off"
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
                <SelectTrigger id="assetType">
                  <span>
                    {method.assetTypeId
                      ? assetTypesData?.data?.find(
                          (t) => t.id === method.assetTypeId,
                        )?.name || 'Selecione…'
                      : 'Selecione (opcional)…'}
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
                Vincule este método a um tipo de instrumento específico.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>

      {/* Certificate Content Section */}
      <Collapsible
        open={sectionsOpen.certificate}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, certificate: open }))
        }
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Conteúdo do Certificado
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.certificate ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="pb-5">
          <CertificateContentPanel
            content={method.certificateContent}
            onChange={(certificateContent) => onChange({ certificateContent })}
            disabled={disabled}
          />
        </CollapsibleContent>
      </Collapsible>

      {/* Input Fields Section */}
      <Collapsible
        open={sectionsOpen.inputs}
        onOpenChange={(open) =>
          setSectionsOpen((s) => ({ ...s, inputs: open }))
        }
      >
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Campos de Entrada ({method.dataFields.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.inputs ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pb-5">
          {method.dataFields.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Nenhum campo de entrada definido. Adicione campos para coletar
              dados durante a calibração.
            </p>
          ) : (
            <div className="divide-y">
              {method.dataFields.map((field, index) => (
                <div
                  key={field.key}
                  className="flex min-w-0 items-center justify-between gap-3 py-3"
                >
                  <div className="min-w-0">
                    <span className="block truncate font-medium">
                      {field.label}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      ({field.key}: {field.type}
                      {field.unit && ` [${field.unit}]`})
                    </span>
                    {field.required && (
                      <span className="text-xs font-medium text-red-500">
                        obrigatório
                      </span>
                    )}
                    {field.source === 'asset_spec' && (
                      <span className="ml-2 text-xs text-muted-foreground">
                        · Ativo: {field.assetSpecKey}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar campo ${field.label}`}
                      onClick={() => {
                        setEditingInputIndex(index)
                        setInputDialogOpen(true)
                      }}
                      disabled={disabled}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        aria-hidden="true"
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover campo ${field.label}`}
                      onClick={() => handleDeleteInput(index)}
                      disabled={disabled}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        aria-hidden="true"
                        className="size-4"
                      />
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
            className="active:scale-[0.96] transition-transform"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              aria-hidden="true"
              className="mr-2 size-4"
            />
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
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Fórmulas ({method.formulas.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.formulas ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pb-5">
          {method.formulas.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Nenhuma fórmula definida. Adicione fórmulas para calcular
              resultados.
            </p>
          ) : (
            <div className="divide-y">
              {method.formulas.map((formula, index) => (
                <div
                  key={formula.outputKey}
                  className="flex min-w-0 items-center justify-between gap-3 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <span className="block truncate font-medium">
                      {formula.label || formula.outputKey}
                    </span>
                    <code className="mt-1 block truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                      {formula.expression}
                    </code>
                    {formula.reporting?.group && (
                      <span className="text-xs text-muted-foreground">
                        · Certificado: {formula.reporting.group}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar fórmula ${formula.label || formula.outputKey}`}
                      onClick={() => {
                        setEditingFormulaIndex(index)
                        setFormulaDialogOpen(true)
                      }}
                      disabled={disabled}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        aria-hidden="true"
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover fórmula ${formula.label || formula.outputKey}`}
                      onClick={() => handleDeleteFormula(index)}
                      disabled={disabled}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        aria-hidden="true"
                        className="size-4"
                      />
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
            className="active:scale-[0.96] transition-transform"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              aria-hidden="true"
              className="mr-2 size-4"
            />
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
        <CollapsibleTrigger className="flex min-h-11 w-full items-center justify-between gap-3 py-3 text-left hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 transition-[color]">
          <span className="font-medium text-balance">
            Critérios de Aceitação ({method.validations.length})
          </span>
          <HugeiconsIcon
            icon={ArrowDown01Icon}
            aria-hidden="true"
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${sectionsOpen.validations ? 'rotate-180' : ''}`}
          />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pb-5">
          {method.validations.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground text-pretty">
              Nenhum critério definido. Adicione critérios de
              aprovação/reprovação.
            </p>
          ) : (
            <div className="divide-y">
              {method.validations.map((validation, index) => (
                <div
                  key={index}
                  className="flex min-w-0 items-center justify-between gap-3 py-3"
                >
                  <div className="flex-1 min-w-0">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${validation.severity === 'error' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                    >
                      {validation.severity === 'error' ? 'Erro' : 'Aviso'}
                    </span>
                    <code className="mt-2 block truncate rounded-md bg-muted/50 px-2 py-1 font-mono text-xs text-muted-foreground">
                      {validation.expression}
                    </code>
                    <p className="mt-1 truncate text-sm text-muted-foreground">
                      {validation.message}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Editar critério ${validation.message}`}
                      onClick={() => {
                        setEditingValidationIndex(index)
                        setValidationDialogOpen(true)
                      }}
                      disabled={disabled}
                    >
                      <HugeiconsIcon
                        icon={Edit02Icon}
                        aria-hidden="true"
                        className="size-4"
                      />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover critério ${validation.message}`}
                      onClick={() => handleDeleteValidation(index)}
                      disabled={disabled}
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        aria-hidden="true"
                        className="size-4"
                      />
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
            className="active:scale-[0.96] transition-transform"
          >
            <HugeiconsIcon
              icon={Add01Icon}
              aria-hidden="true"
              className="mr-2 size-4"
            />
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
