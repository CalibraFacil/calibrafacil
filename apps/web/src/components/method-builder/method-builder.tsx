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
import { Badge } from '@/components/ui/badge'
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
import {
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

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

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Em aprovação',
  TECHNICAL_REVIEWED: 'Revisão técnica',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

const SECTION_NAV = [
  { id: 'mb-identificacao', label: 'Identificação' },
  { id: 'mb-campos', label: 'Campos' },
  { id: 'mb-variaveis', label: 'Variáveis' },
  { id: 'mb-formulas', label: 'Fórmulas' },
  { id: 'mb-validacoes', label: 'Validações' },
  { id: 'mb-modelos', label: 'Modelos GUM' },
  { id: 'mb-incerteza', label: 'Incerteza' },
  { id: 'mb-certificado', label: 'Certificado' },
]

/** Inset surface for inline editor rows (validations, uncertainty). */
const INSET_ROW =
  'rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'

function jumpToSection(id: string) {
  document
    .getElementById(id)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function parseValidationOperator(
  value: string | null,
): MethodDraftValidation['operator'] {
  switch (value) {
    case '<=':
    case '>':
    case '>=':
    case '==':
    case '!=':
      return value
    default:
      return '<'
  }
}

function parseValidationSeverity(
  value: string | null,
): MethodDraftValidation['severity'] {
  return value === 'warning' ? 'warning' : 'error'
}

function parseUncertaintyDistribution(
  value: string | null,
): MethodDraftUncertaintyComponent['distribution'] {
  switch (value) {
    case 'rectangular':
    case 'triangular':
    case 'u-shaped':
      return value
    default:
      return 'normal'
  }
}

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
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Method Builder
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">
              {isNew ? 'Novo método' : 'Editar método'}
            </h1>
            {!isNew ? (
              <Badge variant="secondary">
                {STATUS_LABELS[draft.status] ?? draft.status}
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
            Edite o rascunho, compile as fórmulas e valide o preview no
            servidor.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            onClick={onCancel}
            className={ACTION_BUTTON_CLASS}
          >
            Cancelar
          </Button>
          <Button
            variant="outline"
            onClick={() => compileMutation.mutate(draft)}
            disabled={compileMutation.isPending}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 size-4"
            />
            Compilar
          </Button>
          <Button
            variant="outline"
            onClick={() => previewMutation.mutate()}
            disabled={previewMutation.isPending}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={PlayIcon} className="mr-2 size-4" />
            Preview
          </Button>
          <Button
            variant="outline"
            onClick={() => publishMutation.mutate()}
            disabled={
              !draft.id || publishMutation.isPending || hasCompileErrors
            }
            className={ACTION_BUTTON_CLASS}
          >
            {draft.status === 'DRAFT' ? 'Enviar para revisão' : 'Publicar'}
          </Button>
          <Button
            onClick={handleSave}
            disabled={isSaving}
            className={cn(ACTION_BUTTON_CLASS, 'min-w-28')}
          >
            <HugeiconsIcon icon={FloppyDiskIcon} className="mr-2 size-4" />
            Salvar
          </Button>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
        <div className="min-h-0 overflow-auto pr-1">
          <nav className="sticky top-0 z-10 -mx-1 mb-3 flex gap-1 overflow-x-auto bg-background/85 px-1 py-2 backdrop-blur">
            {SECTION_NAV.map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => jumpToSection(section.id)}
                className="shrink-0 rounded-lg px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                {section.label}
              </button>
            ))}
          </nav>
          <div className="space-y-4">
            <Panel id="mb-identificacao" className="scroll-mt-16 p-4 sm:p-5">
              <PanelHeader
                eyebrow="Identificação"
                title="Dados do método"
                description="Dados persistidos no rascunho."
              />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                <div className="md:col-span-2">
                  <Field label="Descrição">
                    <Textarea
                      value={draft.description ?? ''}
                      onChange={(event) =>
                        updateDraft({ description: event.target.value })
                      }
                      rows={3}
                    />
                  </Field>
                </div>
              </div>
            </Panel>

            <div id="mb-campos" className="scroll-mt-16">
              <InputsSection
                inputs={draft.inputs}
                onAddInput={addInput}
                onInputChange={updateInput}
                onInputTypeChange={updateInputType}
                onInputsChange={(inputs) => updateDraft({ inputs })}
              />
            </div>

            <SectionCard
              id="mb-variaveis"
              title="Variáveis"
              description="Bindings usados pelas fórmulas compiladas."
              actionLabel="Adicionar variável"
              onAction={addVariable}
              count={draft.variables.length}
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
              id="mb-formulas"
              title="Fórmulas"
              description="Expressões que serão normalizadas pelo compilador."
              actionLabel="Adicionar fórmula"
              onAction={addFormula}
              count={draft.formulas.length}
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
              id="mb-validacoes"
              title="Validações"
              description="Critérios avaliados pelo servidor."
              actionLabel="Adicionar validação"
              onAction={addValidation}
              count={draft.validations.length}
            >
              {draft.validations.map((validation, index) => (
                <div
                  key={`${validation.message}-${index}`}
                  className={INSET_ROW}
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
                            operator: parseValidationOperator(value),
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
                            severity: parseValidationSeverity(value),
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
              id="mb-modelos"
              title="Modelos GUM"
              description="Modelos explícitos de mensurando, fontes de incerteza, fator de abrangência e orçamento."
              actionLabel="Adicionar modelo"
              onAction={addMeasurementModel}
              count={draft.measurementModels.length}
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
              id="mb-incerteza"
              title="Incerteza Tipo B"
              description="Componentes padrão do orçamento de incerteza."
              actionLabel="Adicionar componente"
              onAction={addUncertainty}
              count={draft.uncertainty.length}
            >
              {draft.uncertainty.length > 0 ? (
                <div className="rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.25)] dark:text-amber-200">
                  Componentes Type B legados exigem modelo GUM explícito antes
                  da publicação regulada.
                </div>
              ) : null}
              {draft.uncertainty.map((component, index) => (
                <div
                  key={`${component.name}-${index}`}
                  className={cn(
                    'grid gap-3 md:grid-cols-[1fr_120px_160px_120px_auto]',
                    INSET_ROW,
                  )}
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
                          distribution: parseUncertaintyDistribution(value),
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

            <div id="mb-certificado" className="scroll-mt-16">
              <CertificateContentSection
                certificate={draft.certificate}
                onCertificateChange={updateCertificate}
                onAddSection={addCertificateSection}
                onSectionChange={updateCertificateSection}
                onSectionRemove={removeCertificateSection}
              />
            </div>
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
