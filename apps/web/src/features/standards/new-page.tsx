import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Delete02Icon,
  InformationCircleIcon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import {
  createStandardCertifiedValueDraft,
  createStandardFormData,
  parseStandardForm,
  STANDARD_STATUS_LABELS,
  type StandardCertifiedValueFormData,
  type StandardFormData,
  type StandardFormField,
} from '@/features/standards/forms'
import type { CreateReferenceStandardInput } from '@calibra-facil/schemas'

function parseDistribution(
  value: string | null,
): StandardFormData['distribution'] {
  return value === 'rectangular' ? 'rectangular' : 'normal'
}

function parseStandardStatus(value: string | null): StandardFormData['status'] {
  switch (value) {
    case 'ACTIVE':
    case 'INACTIVE':
    case 'OUT_OF_TOLERANCE':
    case 'SENT_FOR_CALIBRATION':
      return value
    default:
      return 'ACTIVE'
  }
}

export function NewStandardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<StandardFormData>(
    createStandardFormData(),
  )
  const [errors, setErrors] = useState<
    Partial<Record<StandardFormField, string>>
  >({})
  const [isMultiValue, setIsMultiValue] = useState(false)

  const createMutation = useMutation({
    mutationFn: async (data: CreateReferenceStandardInput) =>
      calibraApi.standards.create(Object.fromEntries(Object.entries(data))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão criado com sucesso!')
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseStandardForm(formData, { isMultiValue })
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setErrors({})
    createMutation.mutate(parsed.data)
  }

  const updateField = <TKey extends keyof StandardFormData>(
    field: TKey,
    value: StandardFormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const addCertifiedValue = () => {
    setFormData((prev) => ({
      ...prev,
      certifiedValues: [
        ...prev.certifiedValues,
        createStandardCertifiedValueDraft(),
      ],
    }))
  }

  const removeCertifiedValue = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      certifiedValues: prev.certifiedValues.filter((_, i) => i !== index),
    }))
  }

  const updateCertifiedValue = (
    index: number,
    field: keyof StandardCertifiedValueFormData,
    value: string,
  ) => {
    setFormData((prev) => ({
      ...prev,
      certifiedValues: prev.certifiedValues.map((cv, i) =>
        i === index ? { ...cv, [field]: value } : cv,
      ),
    }))
    if (errors.certifiedValues) {
      setErrors((prev) => ({ ...prev, certifiedValues: undefined }))
    }
  }

  const registrationSummary = [
    {
      label: 'Padrão',
      value: formData.name || 'Nome pendente',
      complete: formData.name.trim().length >= 2,
    },
    {
      label: 'Certificado',
      value: formData.certificateNumber || 'Pendente',
      complete: Boolean(formData.certificateNumber.trim()),
    },
    {
      label: 'Valores',
      value: isMultiValue
        ? `${formData.certifiedValues.length} certificados`
        : formData.referenceValue
          ? 'Valor único'
          : 'Pendente',
      complete: isMultiValue
        ? formData.certifiedValues.length > 0
        : Boolean(formData.referenceValue && formData.uncertainty),
    },
    {
      label: 'Status',
      value: STANDARD_STATUS_LABELS[formData.status],
      complete: formData.status === 'ACTIVE',
    },
  ]

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Novo Padrão
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Cadastre rastreabilidade, validade e valores certificados usados no
            orçamento de incerteza das calibrações.
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form
          id="standard-registration-form"
          onSubmit={handleSubmit}
          className="min-w-0"
        >
          <FieldGroup className="gap-0 divide-y">
            <FormSection
              title="Identificação"
              description="Nome, tipo e rastreabilidade física do padrão de referência."
            >
              <div className="grid gap-5 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="name">Nome *</FieldLabel>
                  <Input
                    id="name"
                    name="name"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Ex.: Conjunto de Pesos E2…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="type">Tipo</FieldLabel>
                  <Input
                    id="type"
                    name="type"
                    value={formData.type}
                    onChange={(e) => updateField('type', e.target.value)}
                    placeholder="Ex.: Peso, Bloco Padrão…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  <FieldDescription>Categoria do padrão.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="serialNumber">Nº Série *</FieldLabel>
                  <Input
                    id="serialNumber"
                    name="serialNumber"
                    value={formData.serialNumber}
                    onChange={(e) =>
                      updateField('serialNumber', e.target.value)
                    }
                    placeholder="Ex.: SN-12345…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {errors.serialNumber && (
                    <FieldError>{errors.serialNumber}</FieldError>
                  )}
                </Field>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="manufacturer">Fabricante</FieldLabel>
                  <Input
                    id="manufacturer"
                    name="manufacturer"
                    value={formData.manufacturer}
                    onChange={(e) =>
                      updateField('manufacturer', e.target.value)
                    }
                    placeholder="Ex.: Mettler Toledo…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    name="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    placeholder="Ex.: E2-1kg…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Certificado"
              description="Dados do certificado que sustentam a rastreabilidade metrológica."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="certificateNumber">
                    Nº Certificado *
                  </FieldLabel>
                  <Input
                    id="certificateNumber"
                    name="certificateNumber"
                    value={formData.certificateNumber}
                    onChange={(e) =>
                      updateField('certificateNumber', e.target.value)
                    }
                    placeholder="Ex.: CAL-2024-001…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  {errors.certificateNumber && (
                    <FieldError>{errors.certificateNumber}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="calibratedBy">Calibrado por</FieldLabel>
                  <Input
                    id="calibratedBy"
                    name="calibratedBy"
                    value={formData.calibratedBy}
                    onChange={(e) =>
                      updateField('calibratedBy', e.target.value)
                    }
                    placeholder="Ex.: INMETRO, IPT…"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  <FieldDescription>
                    Laboratório que emitiu o certificado.
                  </FieldDescription>
                </Field>
              </div>

              <div className="mt-5 grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="calibrationDate">
                    Data de Calibração *
                  </FieldLabel>
                  <Input
                    id="calibrationDate"
                    name="calibrationDate"
                    type="date"
                    value={formData.calibrationDate}
                    onChange={(e) =>
                      updateField('calibrationDate', e.target.value)
                    }
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  {errors.calibrationDate && (
                    <FieldError>{errors.calibrationDate}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="nextCalibrationDate">
                    Próxima Calibração *
                  </FieldLabel>
                  <Input
                    id="nextCalibrationDate"
                    name="nextCalibrationDate"
                    type="date"
                    value={formData.nextCalibrationDate}
                    onChange={(e) =>
                      updateField('nextCalibrationDate', e.target.value)
                    }
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  {errors.nextCalibrationDate && (
                    <FieldError>{errors.nextCalibrationDate}</FieldError>
                  )}
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Dados metrológicos"
              description="Valores certificados usados pelo cálculo de incerteza."
            >
              <div className="mb-5 flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-2 text-sm text-muted-foreground text-pretty">
                  <HugeiconsIcon
                    icon={InformationCircleIcon}
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-primary"
                  />
                  Preencha como no certificado do padrão; conjuntos podem ter
                  múltiplos valores certificados.
                </div>
                <div className="flex min-h-10 items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Valor único
                  </span>
                  <Switch
                    aria-label="Alternar entre valor único e conjunto de valores"
                    checked={isMultiValue}
                    onCheckedChange={(checked) => {
                      setIsMultiValue(checked)
                      if (checked && formData.certifiedValues.length === 0) {
                        addCertifiedValue()
                      }
                    }}
                    disabled={createMutation.isPending}
                  />
                  <span className="text-sm text-muted-foreground">
                    Conjunto
                  </span>
                </div>
              </div>

              {!isMultiValue ? (
                <div className="grid gap-5 md:grid-cols-3">
                  <Field>
                    <FieldLabel htmlFor="referenceValue">
                      Valor de Referência *
                    </FieldLabel>
                    <Input
                      id="referenceValue"
                      name="referenceValue"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={formData.referenceValue}
                      onChange={(e) =>
                        updateField('referenceValue', e.target.value)
                      }
                      placeholder="Ex.: 100.005…"
                      className="tabular-nums"
                      disabled={createMutation.isPending}
                      autoComplete="off"
                    />
                    <FieldDescription>
                      Valor certificado do padrão.
                    </FieldDescription>
                    {errors.referenceValue && (
                      <FieldError>{errors.referenceValue}</FieldError>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="uncertainty">Incerteza *</FieldLabel>
                    <Input
                      id="uncertainty"
                      name="uncertainty"
                      type="number"
                      inputMode="decimal"
                      step="any"
                      value={formData.uncertainty}
                      onChange={(e) =>
                        updateField('uncertainty', e.target.value)
                      }
                      placeholder="Ex.: 0.05…"
                      className="tabular-nums"
                      disabled={createMutation.isPending}
                      autoComplete="off"
                    />
                    <FieldDescription>U do certificado.</FieldDescription>
                    {errors.uncertainty && (
                      <FieldError>{errors.uncertainty}</FieldError>
                    )}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="uncertaintyUnit">Unidade *</FieldLabel>
                    <Input
                      id="uncertaintyUnit"
                      name="uncertaintyUnit"
                      value={formData.uncertaintyUnit}
                      onChange={(e) =>
                        updateField('uncertaintyUnit', e.target.value)
                      }
                      placeholder="Ex.: mg, mm, °C…"
                      disabled={createMutation.isPending}
                      autoComplete="off"
                      spellCheck={false}
                    />
                    {errors.uncertaintyUnit && (
                      <FieldError>{errors.uncertaintyUnit}</FieldError>
                    )}
                  </Field>
                </div>
              ) : (
                <div className="space-y-5">
                  <p className="text-sm text-muted-foreground text-pretty">
                    Para conjuntos, como jogos de pesos, adicione cada valor
                    certificado abaixo.
                  </p>

                  <div className="divide-y">
                    {formData.certifiedValues.map((cv, index) => (
                      <div key={index} className="py-5 first:pt-0">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <h3 className="text-sm font-medium">
                            Valor certificado {index + 1}
                          </h3>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={`Remover valor certificado ${index + 1}`}
                            onClick={() => removeCertifiedValue(index)}
                            disabled={
                              createMutation.isPending ||
                              formData.certifiedValues.length <= 1
                            }
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              aria-hidden="true"
                              className="size-4"
                            />
                          </Button>
                        </div>

                        <div className="grid gap-4 md:grid-cols-4">
                          <CertifiedValueInput
                            id={`certified-${index}-nominal`}
                            label="Nominal"
                            value={cv.nominal}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'nominal', value)
                            }
                            placeholder="Ex.: 100g…"
                            disabled={createMutation.isPending}
                          />
                          <CertifiedValueInput
                            id={`certified-${index}-value`}
                            label="Valor Certificado"
                            type="number"
                            value={cv.value}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'value', value)
                            }
                            placeholder="Ex.: 100.005…"
                            disabled={createMutation.isPending}
                          />
                          <CertifiedValueInput
                            id={`certified-${index}-uncertainty`}
                            label="Incerteza"
                            type="number"
                            value={cv.uncertainty}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'uncertainty', value)
                            }
                            placeholder="Ex.: 0.05…"
                            disabled={createMutation.isPending}
                          />
                          <CertifiedValueInput
                            id={`certified-${index}-unit`}
                            label="Unidade"
                            value={cv.unit}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'unit', value)
                            }
                            placeholder="mg…"
                            disabled={createMutation.isPending}
                          />
                        </div>

                        <div className="mt-4 grid gap-4 md:grid-cols-4">
                          <CertifiedValueInput
                            id={`certified-${index}-max-error`}
                            label="Erro máximo"
                            type="number"
                            value={cv.maxError}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'maxError', value)
                            }
                            placeholder="Opcional…"
                            disabled={createMutation.isPending}
                          />
                          <CertifiedValueInput
                            id={`certified-${index}-drift`}
                            label="Deriva"
                            type="number"
                            value={cv.drift}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'drift', value)
                            }
                            placeholder="Opcional…"
                            disabled={createMutation.isPending}
                          />
                          <CertifiedValueInput
                            id={`certified-${index}-buoyancy`}
                            label="Empuxo"
                            type="number"
                            value={cv.buoyancy}
                            onChange={(value) =>
                              updateCertifiedValue(index, 'buoyancy', value)
                            }
                            placeholder="Opcional…"
                            disabled={createMutation.isPending}
                          />
                          <CertifiedValueInput
                            id={`certified-${index}-coverage-factor`}
                            label="k"
                            type="number"
                            value={cv.coverageFactor}
                            onChange={(value) =>
                              updateCertifiedValue(
                                index,
                                'coverageFactor',
                                value,
                              )
                            }
                            placeholder="Padrão geral…"
                            disabled={createMutation.isPending}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addCertifiedValue}
                    disabled={createMutation.isPending}
                    className="active:scale-[0.96] transition-transform"
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      aria-hidden="true"
                      className="mr-2 size-4"
                    />
                    Adicionar Valor
                  </Button>

                  {errors.certifiedValues && (
                    <p className="text-sm text-destructive">
                      {errors.certifiedValues}
                    </p>
                  )}
                </div>
              )}

              <div className="mt-6 grid gap-5 border-t pt-5 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="coverageFactor">
                    Fator de Cobertura (k)
                  </FieldLabel>
                  <Input
                    id="coverageFactor"
                    name="coverageFactor"
                    type="number"
                    inputMode="decimal"
                    step="0.1"
                    value={formData.coverageFactor}
                    onChange={(e) =>
                      updateField('coverageFactor', e.target.value)
                    }
                    className="tabular-nums"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  <FieldDescription>Normalmente 2.0.</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="distribution">Distribuição</FieldLabel>
                  <Select
                    value={formData.distribution}
                    onValueChange={(v) =>
                      updateField('distribution', parseDistribution(v))
                    }
                    disabled={createMutation.isPending}
                  >
                    <SelectTrigger id="distribution">
                      <span>
                        {formData.distribution === 'normal'
                          ? 'Normal'
                          : 'Retangular'}
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="rectangular">Retangular</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>

                <Field>
                  <FieldLabel htmlFor="drift">Drift</FieldLabel>
                  <Input
                    id="drift"
                    name="drift"
                    type="number"
                    inputMode="decimal"
                    step="any"
                    value={formData.drift}
                    onChange={(e) => updateField('drift', e.target.value)}
                    placeholder="Opcional…"
                    className="tabular-nums"
                    disabled={createMutation.isPending}
                    autoComplete="off"
                  />
                  <FieldDescription>
                    Deriva sistemática ao longo do tempo.
                  </FieldDescription>
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Disponibilidade"
              description="Estado operacional do padrão dentro do laboratório."
            >
              <Field>
                <FieldLabel htmlFor="status">Status do Padrão</FieldLabel>
                <Select
                  value={formData.status}
                  onValueChange={(v) =>
                    updateField('status', parseStandardStatus(v))
                  }
                  disabled={createMutation.isPending}
                >
                  <SelectTrigger id="status" className="max-w-sm">
                    <span>{STANDARD_STATUS_LABELS[formData.status]}</span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">Ativo</SelectItem>
                    <SelectItem value="INACTIVE">Inativo</SelectItem>
                    <SelectItem value="OUT_OF_TOLERANCE">
                      Fora de Tolerância
                    </SelectItem>
                    <SelectItem value="SENT_FOR_CALIBRATION">
                      Em Calibração
                    </SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            </FormSection>

            <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/standards' })}
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                {createMutation.isPending ? 'Salvando…' : 'Criar Padrão'}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-l pl-5">
            <h2 className="text-sm font-medium">Resumo do Cadastro</h2>
            <dl className="mt-4 space-y-4">
              {registrationSummary.map((item) => (
                <div key={item.label} className="space-y-1">
                  <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        item.complete ? 'bg-primary' : 'bg-muted-foreground/35'
                      }`}
                    />
                    {item.label}
                  </dt>
                  <dd className="min-w-0 truncate text-sm text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground text-pretty">
              O padrão fica disponível para compor incerteza e rastreabilidade
              assim que for criado.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-balance">{title}</h2>
        {description && (
          <p className="text-sm leading-5 text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}

function CertifiedValueInput({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  type = 'text',
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  disabled: boolean
  type?: 'text' | 'number'
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        name={id}
        type={type}
        inputMode={type === 'number' ? 'decimal' : undefined}
        step={type === 'number' ? 'any' : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={type === 'number' ? 'tabular-nums' : undefined}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
    </Field>
  )
}
