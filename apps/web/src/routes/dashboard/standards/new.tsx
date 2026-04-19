import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Delete02Icon,
  InformationCircleIcon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

export const Route = createFileRoute('/dashboard/standards/new')({
  head: () => ({
    meta: [{ title: 'Novo Padrão | CalibraFácil' }],
  }),
  component: NewStandardPage,
})

interface CertifiedValue {
  nominal: string
  value: string
  uncertainty: string
  unit: string
  maxError: string
  drift: string
  buoyancy: string
  coverageFactor: string
}

interface FormData {
  name: string
  type: string
  serialNumber: string
  manufacturer: string
  model: string
  certificateNumber: string
  calibratedBy: string
  calibrationDate: string
  nextCalibrationDate: string
  // Single value mode
  referenceValue: string
  uncertainty: string
  uncertaintyUnit: string
  // Common
  coverageFactor: string
  distribution: 'normal' | 'rectangular'
  drift: string
  // Multi-value mode
  certifiedValues: Array<CertifiedValue>
  status: 'ACTIVE' | 'INACTIVE' | 'OUT_OF_TOLERANCE' | 'SENT_FOR_CALIBRATION'
}

const initialCertifiedValue: CertifiedValue = {
  nominal: '',
  value: '',
  uncertainty: '',
  unit: '',
  maxError: '',
  drift: '',
  buoyancy: '',
  coverageFactor: '',
}

const initialFormData: FormData = {
  name: '',
  type: '',
  serialNumber: '',
  manufacturer: '',
  model: '',
  certificateNumber: '',
  calibratedBy: '',
  calibrationDate: '',
  nextCalibrationDate: '',
  referenceValue: '',
  uncertainty: '',
  uncertaintyUnit: '',
  coverageFactor: '2.0',
  distribution: 'normal',
  drift: '',
  certifiedValues: [],
  status: 'ACTIVE',
}

function NewStandardPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )
  const [isMultiValue, setIsMultiValue] = useState(false)

  const parseOptionalNumber = (value: string) =>
    value.trim() === '' ? null : parseFloat(value)

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      // Build the payload based on single/multi value mode
      const payload: Record<string, unknown> = {
        name: data.name,
        type: data.type || undefined,
        serialNumber: data.serialNumber,
        manufacturer: data.manufacturer || undefined,
        model: data.model || undefined,
        certificateNumber: data.certificateNumber,
        calibratedBy: data.calibratedBy || undefined,
        calibrationDate: data.calibrationDate,
        nextCalibrationDate: data.nextCalibrationDate,
        coverageFactor: parseFloat(data.coverageFactor) || 2.0,
        distribution: data.distribution,
        drift: data.drift ? parseFloat(data.drift) : undefined,
        status: data.status,
      }

      if (isMultiValue && data.certifiedValues.length > 0) {
        // Multi-value mode
        payload.certifiedValues = data.certifiedValues.map((cv) => ({
          nominal: cv.nominal,
          value: parseFloat(cv.value),
          uncertainty: parseFloat(cv.uncertainty),
          unit: cv.unit,
          maxError: parseOptionalNumber(cv.maxError),
          drift: parseOptionalNumber(cv.drift),
          buoyancy: parseOptionalNumber(cv.buoyancy),
          coverageFactor: parseOptionalNumber(cv.coverageFactor),
        }))
      } else {
        // Single-value mode
        payload.referenceValue = data.referenceValue
          ? parseFloat(data.referenceValue)
          : undefined
        payload.uncertainty = data.uncertainty
          ? parseFloat(data.uncertainty)
          : undefined
        payload.uncertaintyUnit = data.uncertaintyUnit || undefined
      }

      const res = await api.api.standards.$post({
        json: payload as Parameters<typeof api.api.standards.$post>[0]['json'],
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar padrão',
        )
      }

      return res.json() as Promise<{ id: number }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão criado com sucesso!')
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Validation
  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Nome e obrigatorio'
    }
    if (!formData.serialNumber.trim()) {
      newErrors.serialNumber = 'Número de série e obrigatorio'
    }
    if (!formData.certificateNumber.trim()) {
      newErrors.certificateNumber = 'Numero do certificado e obrigatorio'
    }
    if (!formData.calibrationDate) {
      newErrors.calibrationDate = 'Data de calibração é obrigatória'
    }
    if (!formData.nextCalibrationDate) {
      newErrors.nextCalibrationDate = 'Próxima calibração é obrigatoria'
    }

    // Validate metrology data
    if (isMultiValue) {
      if (formData.certifiedValues.length === 0) {
        newErrors.certifiedValues = 'Adicione pelo menos um valor certificado'
      } else {
        // Validate each certified value
        for (let i = 0; i < formData.certifiedValues.length; i++) {
          const cv = formData.certifiedValues[i]
          if (!cv.nominal || !cv.value || !cv.uncertainty || !cv.unit) {
            newErrors.certifiedValues = `Valor ${i + 1}: Preencha todos os campos`
            break
          }
          for (const field of [
            'maxError',
            'drift',
            'buoyancy',
            'coverageFactor',
          ] as const) {
            if (cv[field] && Number.isNaN(parseFloat(cv[field]))) {
              newErrors.certifiedValues = `Valor ${i + 1}: Campo avançado inválido`
              break
            }
          }
          if (newErrors.certifiedValues) break
        }
      }
    } else {
      // Single-value mode - must provide both referenceValue and uncertainty, or neither
      const hasReferenceValue = !!formData.referenceValue
      const hasUncertainty = !!formData.uncertainty

      if (hasReferenceValue || hasUncertainty) {
        // If providing single-value data, all fields are required
        if (!formData.referenceValue) {
          newErrors.referenceValue = 'Valor de referencia e obrigatorio'
        }
        if (!formData.uncertainty) {
          newErrors.uncertainty = 'Incerteza e obrigatoria'
        }
        if (!formData.uncertaintyUnit) {
          newErrors.uncertaintyUnit = 'Unidade da incerteza e obrigatoria'
        }
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    createMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const addCertifiedValue = () => {
    setFormData((prev) => ({
      ...prev,
      certifiedValues: [...prev.certifiedValues, { ...initialCertifiedValue }],
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
    field: keyof CertifiedValue,
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

  return (
    <div className="space-y-4">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/standards' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identification Card */}
        <Card>
          <CardHeader>
            <CardTitle>Identificação</CardTitle>
            <CardDescription>
              Informações básicas do padrão de referência
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Field>
                  <FieldLabel htmlFor="name">Nome *</FieldLabel>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Ex: Conjunto de Pesos E2"
                    disabled={createMutation.isPending}
                  />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="type">Tipo</FieldLabel>
                  <Input
                    id="type"
                    value={formData.type}
                    onChange={(e) => updateField('type', e.target.value)}
                    placeholder="Ex: Peso, Bloco Padrão"
                    disabled={createMutation.isPending}
                  />
                  <FieldDescription>Categoria do padrão</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="serialNumber">N Série *</FieldLabel>
                  <Input
                    id="serialNumber"
                    value={formData.serialNumber}
                    onChange={(e) =>
                      updateField('serialNumber', e.target.value)
                    }
                    placeholder="Ex: SN-12345"
                    disabled={createMutation.isPending}
                  />
                  {errors.serialNumber && (
                    <FieldError>{errors.serialNumber}</FieldError>
                  )}
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="manufacturer">Fabricante</FieldLabel>
                  <Input
                    id="manufacturer"
                    value={formData.manufacturer}
                    onChange={(e) =>
                      updateField('manufacturer', e.target.value)
                    }
                    placeholder="Ex: Mettler Toledo"
                    disabled={createMutation.isPending}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    placeholder="Ex: E2-1kg"
                    disabled={createMutation.isPending}
                  />
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Certificate Card */}
        <Card>
          <CardHeader>
            <CardTitle>Certificado de Calibração</CardTitle>
            <CardDescription>
              Dados de rastreabilidade do certificado
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="certificateNumber">
                    N Certificado *
                  </FieldLabel>
                  <Input
                    id="certificateNumber"
                    value={formData.certificateNumber}
                    onChange={(e) =>
                      updateField('certificateNumber', e.target.value)
                    }
                    placeholder="Ex: CAL-2024-001"
                    disabled={createMutation.isPending}
                  />
                  {errors.certificateNumber && (
                    <FieldError>{errors.certificateNumber}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="calibratedBy">Calibrado por</FieldLabel>
                  <Input
                    id="calibratedBy"
                    value={formData.calibratedBy}
                    onChange={(e) =>
                      updateField('calibratedBy', e.target.value)
                    }
                    placeholder="Ex: INMETRO, IPT"
                    disabled={createMutation.isPending}
                  />
                  <FieldDescription>
                    Laboratório que emitiu o certificado
                  </FieldDescription>
                </Field>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Field>
                  <FieldLabel htmlFor="calibrationDate">
                    Data de Calibração *
                  </FieldLabel>
                  <Input
                    id="calibrationDate"
                    type="date"
                    value={formData.calibrationDate}
                    onChange={(e) =>
                      updateField('calibrationDate', e.target.value)
                    }
                    disabled={createMutation.isPending}
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
                    type="date"
                    value={formData.nextCalibrationDate}
                    onChange={(e) =>
                      updateField('nextCalibrationDate', e.target.value)
                    }
                    disabled={createMutation.isPending}
                  />
                  {errors.nextCalibrationDate && (
                    <FieldError>{errors.nextCalibrationDate}</FieldError>
                  )}
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Metrology Data Card - Emphasized */}
        <Card className="border-primary/50">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HugeiconsIcon
                    icon={InformationCircleIcon}
                    className="h-5 w-5 text-primary"
                  />
                  Dados Metrológicos
                </CardTitle>
                <CardDescription>
                  Estes dados são utilizados no cálculo de incerteza. Preencha
                  com os valores do certificado.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Valor Unico
                </span>
                <Switch
                  checked={isMultiValue}
                  onCheckedChange={(checked) => {
                    setIsMultiValue(checked)
                    if (checked && formData.certifiedValues.length === 0) {
                      addCertifiedValue()
                    }
                  }}
                  disabled={createMutation.isPending}
                />
                <span className="text-sm text-muted-foreground">Conjunto</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {!isMultiValue ? (
                /* Single Value Mode */
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Field>
                      <FieldLabel htmlFor="referenceValue">
                        Valor de Referencia *
                      </FieldLabel>
                      <Input
                        id="referenceValue"
                        type="number"
                        step="any"
                        value={formData.referenceValue}
                        onChange={(e) =>
                          updateField('referenceValue', e.target.value)
                        }
                        placeholder="Ex: 100.005"
                        disabled={createMutation.isPending}
                      />
                      <FieldDescription>
                        Valor certificado do padrão
                      </FieldDescription>
                      {errors.referenceValue && (
                        <FieldError>{errors.referenceValue}</FieldError>
                      )}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="uncertainty">Incerteza *</FieldLabel>
                      <Input
                        id="uncertainty"
                        type="number"
                        step="any"
                        value={formData.uncertainty}
                        onChange={(e) =>
                          updateField('uncertainty', e.target.value)
                        }
                        placeholder="Ex: 0.05"
                        disabled={createMutation.isPending}
                      />
                      <FieldDescription>U do certificado</FieldDescription>
                      {errors.uncertainty && (
                        <FieldError>{errors.uncertainty}</FieldError>
                      )}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="uncertaintyUnit">
                        Unidade *
                      </FieldLabel>
                      <Input
                        id="uncertaintyUnit"
                        value={formData.uncertaintyUnit}
                        onChange={(e) =>
                          updateField('uncertaintyUnit', e.target.value)
                        }
                        placeholder="Ex: mg, mm, C"
                        disabled={createMutation.isPending}
                      />
                      {errors.uncertaintyUnit && (
                        <FieldError>{errors.uncertaintyUnit}</FieldError>
                      )}
                    </Field>
                  </div>
                </>
              ) : (
                /* Multi Value Mode */
                <>
                  <div className="space-y-4">
                    <div className="text-sm text-muted-foreground">
                      Para conjuntos (ex: jogo de pesos), adicione cada valor
                      certificado abaixo:
                    </div>

                    {formData.certifiedValues.map((cv, index) => (
                      <div
                        key={index}
                        className="space-y-3 rounded-lg bg-muted/50 p-3"
                      >
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_1fr_120px_40px]">
                          <Field>
                            <FieldLabel>Nominal</FieldLabel>
                            <Input
                              value={cv.nominal}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'nominal',
                                  e.target.value,
                                )
                              }
                              placeholder="Ex: 100g"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Valor Certificado</FieldLabel>
                            <Input
                              type="number"
                              step="any"
                              value={cv.value}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'value',
                                  e.target.value,
                                )
                              }
                              placeholder="Ex: 100.005"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Incerteza</FieldLabel>
                            <Input
                              type="number"
                              step="any"
                              value={cv.uncertainty}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'uncertainty',
                                  e.target.value,
                                )
                              }
                              placeholder="Ex: 0.05"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Unidade</FieldLabel>
                            <Input
                              value={cv.unit}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'unit',
                                  e.target.value,
                                )
                              }
                              placeholder="mg"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <div className="flex items-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeCertifiedValue(index)}
                              disabled={
                                createMutation.isPending ||
                                formData.certifiedValues.length <= 1
                              }
                            >
                              <HugeiconsIcon
                                icon={Delete02Icon}
                                className="h-4 w-4"
                              />
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                          <Field>
                            <FieldLabel>Erro máximo</FieldLabel>
                            <Input
                              type="number"
                              step="any"
                              value={cv.maxError}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'maxError',
                                  e.target.value,
                                )
                              }
                              placeholder="Opcional"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Deriva</FieldLabel>
                            <Input
                              type="number"
                              step="any"
                              value={cv.drift}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'drift',
                                  e.target.value,
                                )
                              }
                              placeholder="Opcional"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>Empuxo</FieldLabel>
                            <Input
                              type="number"
                              step="any"
                              value={cv.buoyancy}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'buoyancy',
                                  e.target.value,
                                )
                              }
                              placeholder="Opcional"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                          <Field>
                            <FieldLabel>k</FieldLabel>
                            <Input
                              type="number"
                              step="any"
                              value={cv.coverageFactor}
                              onChange={(e) =>
                                updateCertifiedValue(
                                  index,
                                  'coverageFactor',
                                  e.target.value,
                                )
                              }
                              placeholder="Padrão geral"
                              disabled={createMutation.isPending}
                            />
                          </Field>
                        </div>
                      </div>
                    ))}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addCertifiedValue}
                      disabled={createMutation.isPending}
                    >
                      <HugeiconsIcon
                        icon={PlusSignIcon}
                        className="mr-2 h-4 w-4"
                      />
                      Adicionar Valor
                    </Button>

                    {errors.certifiedValues && (
                      <p className="text-sm text-destructive">
                        {errors.certifiedValues}
                      </p>
                    )}
                  </div>
                </>
              )}

              {/* Common fields for both modes */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t">
                <Field>
                  <FieldLabel htmlFor="coverageFactor">
                    Fator de Cobertura (k)
                  </FieldLabel>
                  <Input
                    id="coverageFactor"
                    type="number"
                    step="0.1"
                    value={formData.coverageFactor}
                    onChange={(e) =>
                      updateField('coverageFactor', e.target.value)
                    }
                    disabled={createMutation.isPending}
                  />
                  <FieldDescription>Normalmente 2.0</FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="distribution">Distribuicao</FieldLabel>
                  <Select
                    value={formData.distribution}
                    onValueChange={(v) =>
                      updateField('distribution', v as 'normal' | 'rectangular')
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
                    type="number"
                    step="any"
                    value={formData.drift}
                    onChange={(e) => updateField('drift', e.target.value)}
                    placeholder="Opcional"
                    disabled={createMutation.isPending}
                  />
                  <FieldDescription>
                    Deriva sistematica ao longo do tempo
                  </FieldDescription>
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Status Card */}
        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <Field>
              <FieldLabel htmlFor="status">Status do Padrão</FieldLabel>
              <Select
                value={formData.status}
                onValueChange={(v) =>
                  updateField('status', v as FormData['status'])
                }
                disabled={createMutation.isPending}
              >
                <SelectTrigger id="status" className="w-64">
                  <span>
                    {formData.status === 'ACTIVE'
                      ? 'Ativo'
                      : formData.status === 'INACTIVE'
                        ? 'Inativo'
                        : formData.status === 'OUT_OF_TOLERANCE'
                          ? 'Fora de Tolerancia'
                          : 'Em Calibração'}
                  </span>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Ativo</SelectItem>
                  <SelectItem value="INACTIVE">Inativo</SelectItem>
                  <SelectItem value="OUT_OF_TOLERANCE">
                    Fora de Tolerancia
                  </SelectItem>
                  <SelectItem value="SENT_FOR_CALIBRATION">
                    Em Calibração
                  </SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </CardContent>
        </Card>

        {/* Submit Buttons */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/dashboard/standards' })}
            disabled={createMutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Salvando...' : 'Criar Padrão'}
          </Button>
        </div>
      </form>
    </div>
  )
}
