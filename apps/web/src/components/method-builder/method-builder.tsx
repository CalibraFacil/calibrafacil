import { useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  Delete02Icon,
  FloppyDiskIcon,
  PlayIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAssetTypesData } from '@/features/assets/queries'
import { FormField as Field } from '@/shared/forms/form-field'

import { cloneMethodDraft } from './adapters'
import {
  compileMethodDraft,
  previewMethodDraft,
  publishMethodDraft,
  requestMethodApproval,
} from './api'
import { CertificateContentSection } from './certificate-content-section'
import { CompilePreviewPanel } from './compile-preview-panel'
import {
  addDraftCertificateSection,
  addDraftFormula,
  addDraftInput,
  addDraftMeasurementModel,
  addDraftUncertainty,
  addDraftValidation,
  addDraftVariable,
  applyDraftPatch,
  removeDraftCertificateSection,
  setDraftInputType,
  updateDraftCertificate,
  updateDraftCertificateSection,
  updateDraftFormula,
  updateDraftInput,
  updateDraftMeasurementModel,
  updateDraftUncertainty,
  updateDraftValidation,
  updateDraftVariable,
} from './draft-operations'
import { FormulaEditor } from './formula-editor'
import { InputsSection } from './inputs-section'
import { MeasurementModelEditor } from './measurement-model-editor'
import { buildInitialSampleData, parseJsonObject } from './sample-data'
import { SectionCard } from './section-card'
import type {
  MethodCompileResult,
  MethodDraftCertificateContent,
  MethodDraft,
  MethodDraftFormula,
  MethodDraftInput,
  MethodDraftInputType,
  MethodDraftMeasurementModel,
  MethodDraftUncertaintyComponent,
  MethodDraftValidation,
  MethodDraftVariableBinding,
  MethodPreviewResult,
} from './types'
import { VariableEditor } from './variable-editor'

interface MethodBuilderProps {
  initialDraft: MethodDraft
  onSave: (draft: MethodDraft) => void | Promise<unknown>
  onCancel: () => void
  onPublished?: () => void
  isSaving?: boolean
  isNew?: boolean
}

const validationOperators: Array<MethodDraftValidation['operator']> = [
  '<',
  '<=',
  '>',
  '>=',
  '==',
  '!=',
]

const distributionOptions: Array<
  MethodDraftUncertaintyComponent['distribution']
> = ['normal', 'rectangular', 'triangular', 'u-shaped']

export function MethodBuilder({
  initialDraft,
  onSave,
  onCancel,
  onPublished,
  isSaving = false,
  isNew = false,
}: MethodBuilderProps) {
  const [draft, setDraft] = useState(() => cloneMethodDraft(initialDraft))
  const [sampleDataText, setSampleDataText] = useState(() =>
    JSON.stringify(buildInitialSampleData(initialDraft), null, 2),
  )
  const [compileResult, setCompileResult] =
    useState<MethodCompileResult | null>(null)
  const [previewResult, setPreviewResult] =
    useState<MethodPreviewResult | null>(null)

  const { data: assetTypesData } = useAssetTypesData()

  const compileMutation = useMutation({
    mutationFn: compileMethodDraft,
    onSuccess: (result) => {
      setCompileResult(result)
      setPreviewResult(null)
      toast.success('Compilação concluída')
    },
    onError: (error) => {
      toast.error(error.message)
      setCompileResult({
        diagnostics: [
          {
            severity: 'warning',
            message: `Endpoint de compilação ainda não respondeu: ${error.message}`,
          },
        ],
        normalizedFormulas: [],
      })
    },
  })

  const previewMutation = useMutation({
    mutationFn: async () => {
      const sampleData = parseJsonObject(sampleDataText)
      return previewMethodDraft({ draft, sampleData })
    },
    onSuccess: (result) => {
      setPreviewResult(result)
      toast.success('Preview calculado')
    },
    onError: (error) => {
      toast.error(error.message)
      setPreviewResult({
        diagnostics: [
          {
            severity: 'warning',
            message: `Endpoint de preview ainda não respondeu: ${error.message}`,
          },
        ],
        results: {},
      })
    },
  })

  const publishMutation = useMutation({
    mutationFn: async () => {
      if (!draft.id) {
        throw new Error('Salve o método antes de enviar para revisão')
      }

      if (draft.status === 'DRAFT') {
        await onSave(draft)
        const sampleData = parseJsonObject(sampleDataText)
        return requestMethodApproval(draft.id, sampleData)
      }

      const sampleData = parseJsonObject(sampleDataText)
      return publishMethodDraft({
        methodId: draft.id,
        sampleData,
        reasonForChange: 'Publicação pelo Method Builder',
      })
    },
    onSuccess: () => {
      toast.success(
        draft.status === 'DRAFT'
          ? 'Método enviado para revisão'
          : 'Método publicado',
      )
      onPublished?.()
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const diagnostics = useMemo(() => {
    return [
      ...(compileResult?.diagnostics ?? []),
      ...(previewResult?.diagnostics ?? []),
    ]
  }, [compileResult, previewResult])

  const hasCompileErrors = diagnostics.some(
    (diagnostic) => diagnostic.severity === 'error',
  )

  function replaceDraft(nextDraft: MethodDraft) {
    setCompileResult(null)
    setPreviewResult(null)
    setDraft(nextDraft)
  }

  function updateDraft(patch: Partial<MethodDraft>) {
    replaceDraft(applyDraftPatch(draft, patch))
  }

  function addInput() {
    replaceDraft(addDraftInput(draft))
  }

  function updateInput(index: number, patch: Partial<MethodDraftInput>) {
    replaceDraft(updateDraftInput(draft, index, patch))
  }

  function updateInputType(index: number, type: MethodDraftInputType) {
    replaceDraft(setDraftInputType(draft, index, type))
  }

  function addFormula() {
    replaceDraft(addDraftFormula(draft))
  }

  function updateFormula(index: number, patch: Partial<MethodDraftFormula>) {
    replaceDraft(updateDraftFormula(draft, index, patch))
  }

  function addMeasurementModel() {
    replaceDraft(addDraftMeasurementModel(draft))
  }

  function updateMeasurementModel(
    index: number,
    patch: Partial<MethodDraftMeasurementModel>,
  ) {
    replaceDraft(updateDraftMeasurementModel(draft, index, patch))
  }

  function addValidation() {
    replaceDraft(addDraftValidation(draft))
  }

  function updateValidation(
    index: number,
    patch: Partial<MethodDraftValidation>,
  ) {
    replaceDraft(updateDraftValidation(draft, index, patch))
  }

  function addUncertainty() {
    replaceDraft(addDraftUncertainty(draft))
  }

  function updateUncertainty(
    index: number,
    patch: Partial<MethodDraftUncertaintyComponent>,
  ) {
    replaceDraft(updateDraftUncertainty(draft, index, patch))
  }

  function addVariable() {
    replaceDraft(addDraftVariable(draft))
  }

  function updateVariable(index: number, binding: MethodDraftVariableBinding) {
    replaceDraft(updateDraftVariable(draft, index, binding))
  }

  function updateCertificate(patch: Partial<MethodDraftCertificateContent>) {
    replaceDraft(updateDraftCertificate(draft, patch))
  }

  function addCertificateSection() {
    replaceDraft(addDraftCertificateSection(draft))
  }

  function updateCertificateSection(
    index: number,
    section: NonNullable<MethodDraftCertificateContent['sections']>[number],
  ) {
    replaceDraft(updateDraftCertificateSection(draft, index, section))
  }

  function removeCertificateSection(index: number) {
    replaceDraft(removeDraftCertificateSection(draft, index))
  }

  function handleSave() {
    onSave(draft)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {isNew ? 'Novo método' : 'Editar método'}
          </h1>
          <p className="text-sm text-muted-foreground">
            Method Builder edita rascunhos, compila fórmulas e valida o preview
            no servidor.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => compileMutation.mutate(draft)}
            disabled={compileMutation.isPending}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 h-4 w-4"
            />
            Compilar
          </Button>
          <Button
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
          >
            <HugeiconsIcon icon={PlayIcon} className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button
            variant="outline"
            onClick={() => publishMutation.mutate()}
            disabled={
              !draft.id || publishMutation.isPending || hasCompileErrors
            }
          >
            {draft.status === 'DRAFT' ? 'Enviar para revisão' : 'Publicar'}
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            <HugeiconsIcon icon={FloppyDiskIcon} className="mr-2 h-4 w-4" />
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="min-h-0 overflow-auto pr-1">
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Identificação</CardTitle>
                <CardDescription>
                  Dados persistidos no rascunho do método.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <Field label="Nome">
                  <Input
                    value={draft.name}
                    onChange={(event) =>
                      updateDraft({ name: event.target.value })
                    }
                    placeholder="Ex.: Calibração de balança"
                  />
                </Field>
                <Field label="Tipo de ativo">
                  <Select
                    value={
                      draft.assetTypeId ? String(draft.assetTypeId) : 'none'
                    }
                    onValueChange={(value) =>
                      updateDraft({
                        assetTypeId:
                          value === 'none' ? undefined : Number(value),
                      })
                    }
                  >
                    <SelectTrigger>
                      <span>
                        {draft.assetTypeId
                          ? (assetTypesData?.data.find(
                              (type) => type.id === draft.assetTypeId,
                            )?.name ?? 'Tipo selecionado')
                          : 'Sem vínculo'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem vínculo</SelectItem>
                      {assetTypesData?.data.map((type) => (
                        <SelectItem key={type.id} value={String(type.id)}>
                          {type.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Descrição">
                  <Textarea
                    value={draft.description ?? ''}
                    onChange={(event) =>
                      updateDraft({ description: event.target.value })
                    }
                    rows={3}
                    className="md:col-span-2"
                  />
                </Field>
              </CardContent>
            </Card>

            <InputsSection
              inputs={draft.inputs}
              onAddInput={addInput}
              onInputChange={updateInput}
              onInputTypeChange={updateInputType}
              onInputsChange={(inputs) => updateDraft({ inputs })}
            />

            <SectionCard
              title="Variáveis"
              description="Bindings usados pelas fórmulas compiladas."
              actionLabel="Adicionar variável"
              onAction={addVariable}
            >
              {draft.variables.map((variable, index) => (
                <VariableEditor
                  key={`${variable.key}-${index}`}
                  variable={variable}
                  inputs={draft.inputs}
                  onChange={(binding) => updateVariable(index, binding)}
                  onRemove={() =>
                    updateDraft({
                      variables: draft.variables.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </SectionCard>

            <SectionCard
              title="Fórmulas"
              description="Expressões que serão normalizadas pelo compilador."
              actionLabel="Adicionar fórmula"
              onAction={addFormula}
            >
              {draft.formulas.map((formula, index) => (
                <FormulaEditor
                  key={`${formula.outputKey}-${index}`}
                  formula={formula}
                  inputs={draft.inputs}
                  onChange={(patch) => updateFormula(index, patch)}
                  onRemove={() =>
                    updateDraft({
                      formulas: draft.formulas.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </SectionCard>

            <SectionCard
              title="Validações"
              description="Critérios avaliados pelo servidor."
              actionLabel="Adicionar validação"
              onAction={addValidation}
            >
              {draft.validations.map((validation, index) => (
                <div
                  key={`${validation.message}-${index}`}
                  className="rounded-md border p-3"
                >
                  <div className="grid gap-3 md:grid-cols-[1fr_90px_1fr_120px_auto]">
                    <Field label="Esquerda">
                      <Input
                        value={validation.leftExpression}
                        onChange={(event) =>
                          updateValidation(index, {
                            leftExpression: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Operador">
                      <Select
                        value={validation.operator}
                        onValueChange={(value) =>
                          updateValidation(index, {
                            operator:
                              value as MethodDraftValidation['operator'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <span>{validation.operator}</span>
                        </SelectTrigger>
                        <SelectContent>
                          {validationOperators.map((operator) => (
                            <SelectItem key={operator} value={operator}>
                              {operator}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Direita">
                      <Input
                        value={validation.rightExpression}
                        onChange={(event) =>
                          updateValidation(index, {
                            rightExpression: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field label="Severidade">
                      <Select
                        value={validation.severity}
                        onValueChange={(value) =>
                          updateValidation(index, {
                            severity:
                              value as MethodDraftValidation['severity'],
                          })
                        }
                      >
                        <SelectTrigger>
                          <span>{validation.severity}</span>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="error">error</SelectItem>
                          <SelectItem value="warning">warning</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="flex items-end justify-end">
                      <IconButton
                        label="Remover validação"
                        icon={Delete02Icon}
                        onClick={() =>
                          updateDraft({
                            validations: draft.validations.filter(
                              (_, itemIndex) => itemIndex !== index,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                  <Field label="Mensagem">
                    <Input
                      value={validation.message}
                      onChange={(event) =>
                        updateValidation(index, { message: event.target.value })
                      }
                    />
                  </Field>
                </div>
              ))}
            </SectionCard>

            <SectionCard
              title="Modelos GUM"
              description="Modelos explícitos de mensurando, fontes de incerteza, fator de abrangência e orçamento."
              actionLabel="Adicionar modelo"
              onAction={addMeasurementModel}
            >
              {draft.measurementModels.map((model, index) => (
                <MeasurementModelEditor
                  key={`${model.key}-${index}`}
                  model={model}
                  inputs={draft.inputs}
                  formulas={draft.formulas}
                  onChange={(patch) => updateMeasurementModel(index, patch)}
                  onRemove={() =>
                    updateDraft({
                      measurementModels: draft.measurementModels.filter(
                        (_, itemIndex) => itemIndex !== index,
                      ),
                    })
                  }
                />
              ))}
            </SectionCard>

            <SectionCard
              title="Incerteza Tipo B"
              description="Componentes padrão do orçamento de incerteza."
              actionLabel="Adicionar componente"
              onAction={addUncertainty}
            >
              {draft.uncertainty.length > 0 ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  Componentes Type B legados exigem modelo GUM explícito antes
                  da publicação regulada.
                </div>
              ) : null}
              {draft.uncertainty.map((component, index) => (
                <div
                  key={`${component.name}-${index}`}
                  className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_120px_160px_120px_auto]"
                >
                  <Field label="Nome">
                    <Input
                      value={component.name}
                      onChange={(event) =>
                        updateUncertainty(index, { name: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="Valor">
                    <Input
                      type="number"
                      value={component.value}
                      onChange={(event) =>
                        updateUncertainty(index, {
                          value: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="Distribuição">
                    <Select
                      value={component.distribution}
                      onValueChange={(value) =>
                        updateUncertainty(index, {
                          distribution:
                            value as MethodDraftUncertaintyComponent['distribution'],
                        })
                      }
                    >
                      <SelectTrigger>
                        <span>{component.distribution}</span>
                      </SelectTrigger>
                      <SelectContent>
                        {distributionOptions.map((distribution) => (
                          <SelectItem key={distribution} value={distribution}>
                            {distribution}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Graus">
                    <Input
                      type="number"
                      value={component.degreesOfFreedom ?? 50}
                      onChange={(event) =>
                        updateUncertainty(index, {
                          degreesOfFreedom: Number(event.target.value),
                        })
                      }
                    />
                  </Field>
                  <div className="flex items-end justify-end">
                    <IconButton
                      label="Remover componente"
                      icon={Delete02Icon}
                      onClick={() =>
                        updateDraft({
                          uncertainty: draft.uncertainty.filter(
                            (_, itemIndex) => itemIndex !== index,
                          ),
                        })
                      }
                    />
                  </div>
                </div>
              ))}
            </SectionCard>

            <CertificateContentSection
              certificate={draft.certificate}
              onCertificateChange={updateCertificate}
              onAddSection={addCertificateSection}
              onSectionChange={updateCertificateSection}
              onSectionRemove={removeCertificateSection}
            />
          </div>
        </div>

        <CompilePreviewPanel
          compileResult={compileResult}
          diagnostics={diagnostics}
          previewResult={previewResult}
          sampleDataText={sampleDataText}
          onSampleDataTextChange={setSampleDataText}
        />
      </div>
    </div>
  )
}

function IconButton({
  label,
  icon,
  onClick,
}: {
  label: string
  icon: typeof Delete02Icon
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
      <HugeiconsIcon icon={icon} className="h-4 w-4" />
    </Button>
  )
}
