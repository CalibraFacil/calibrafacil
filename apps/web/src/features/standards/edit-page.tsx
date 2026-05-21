import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  Delete02Icon,
  InformationCircleIcon,
  PlusSignIcon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import {
  useStandardAuditLogData,
  useStandardDetailData,
} from '@/features/standards/queries'
import type { StandardDetail } from '@/features/standards/types'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  createStandardCertifiedValueDraft,
  createStandardFormData,
  createStandardRenewFormData,
  hasCertifiedValues,
  parseStandardEditForm,
  parseStandardRenewForm,
  type StandardCertifiedValueFormData,
  type StandardFormData,
  type StandardFormField,
  type StandardRenewFormData,
  type StandardRenewFormField,
} from '@/features/standards/forms'
import type {
  RenewCertificateInput,
  UpdateReferenceStandardInput,
} from '@calibra-facil/schemas'

export function EditStandardPage({ id }: { id: string }) {
  const { data: standard, isLoading } = useStandardDetailData(id)

  const { data: auditLogData } = useStandardAuditLogData(id)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-24" />
        <Skeleton className="h-64 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  if (!standard) {
    return (
      <div className="space-y-6">
        <Card>
          <CardContent className="py-8 text-center text-destructive">
            Erro ao carregar padrão. Tente novamente.
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <EditStandardForm
      key={standard.id}
      standard={standard}
      auditLogData={auditLogData?.data ?? []}
    />
  )
}

function EditStandardForm({
  standard,
  auditLogData,
}: {
  standard: StandardDetail
  auditLogData: Array<AuditLogRecord>
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const standardHasCertifiedValues = hasCertifiedValues(standard)

  const [formData, setFormData] = useState<StandardFormData>(
    createStandardFormData(standard),
  )
  const [errors, setErrors] = useState<
    Partial<Record<StandardFormField, string>>
  >({})
  const [isMultiValue, setIsMultiValue] = useState(standardHasCertifiedValues)

  // Renew dialog state
  const [showRenewDialog, setShowRenewDialog] = useState(false)
  const [renewFormData, setRenewFormData] =
    useState<StandardRenewFormData | null>(null)
  const [renewErrors, setRenewErrors] = useState<
    Partial<Record<StandardRenewFormField, string>>
  >({})

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateReferenceStandardInput) =>
      calibraApi.standards.update(standard.id, data as Record<string, unknown>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão atualizado com sucesso!')
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const renewMutation = useMutation({
    mutationFn: async (payload: RenewCertificateInput) => {
      return calibraApi.standards.renew(
        standard.id,
        payload as Record<string, unknown>,
      )
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Certificado renovado com sucesso!')
      setShowRenewDialog(false)
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!formData) return

    const parsed = parseStandardEditForm(formData, { isMultiValue })
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
    updateMutation.mutate(parsed.data)
  }

  const handleRenewSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!renewFormData) return

    const parsed = parseStandardRenewForm(renewFormData, { isMultiValue })
    if (!parsed.success) {
      setRenewErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setRenewErrors({})
    renewMutation.mutate(parsed.data)
  }

  const updateField = <TKey extends keyof StandardFormData>(
    field: TKey,
    value: StandardFormData[TKey],
  ) => {
    if (!formData) return
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const addCertifiedValue = () => {
    if (!formData) return
    setFormData((prev) => ({
      ...prev,
      certifiedValues: [
        ...prev.certifiedValues,
        createStandardCertifiedValueDraft(),
      ],
    }))
  }

  const removeCertifiedValue = (index: number) => {
    if (!formData) return
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
    if (!formData) return
    setFormData((prev) => ({
      ...prev,
      certifiedValues: prev.certifiedValues.map((cv, i) =>
        i === index ? { ...cv, [field]: value } : cv,
      ),
    }))
  }

  const openRenewDialog = () => {
    if (!formData) return
    setRenewFormData(createStandardRenewFormData(formData))
    setRenewErrors({})
    setShowRenewDialog(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/standards' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
        <Button variant="outline" onClick={openRenewDialog}>
          <HugeiconsIcon icon={RefreshIcon} className="mr-2 h-4 w-4" />
          Renovar Certificado
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
                    disabled={updateMutation.isPending}
                  />
                  {errors.name && <FieldError>{errors.name}</FieldError>}
                </Field>

                <Field>
                  <FieldLabel htmlFor="type">Tipo</FieldLabel>
                  <Input
                    id="type"
                    value={formData.type}
                    onChange={(e) => updateField('type', e.target.value)}
                    disabled={updateMutation.isPending}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="serialNumber">N Série *</FieldLabel>
                  <Input
                    id="serialNumber"
                    value={formData.serialNumber}
                    onChange={(e) =>
                      updateField('serialNumber', e.target.value)
                    }
                    disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="model">Modelo</FieldLabel>
                  <Input
                    id="model"
                    value={formData.model}
                    onChange={(e) => updateField('model', e.target.value)}
                    disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  />
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
                    disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  />
                  {errors.nextCalibrationDate && (
                    <FieldError>{errors.nextCalibrationDate}</FieldError>
                  )}
                </Field>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        {/* Metrology Data Card */}
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
                  Estes dados são utilizados no cálculo de incerteza
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Valor Único
                </span>
                <Switch
                  checked={isMultiValue}
                  onCheckedChange={(checked) => {
                    setIsMultiValue(checked)
                    if (checked && formData.certifiedValues.length === 0) {
                      addCertifiedValue()
                    }
                  }}
                  disabled={updateMutation.isPending}
                />
                <span className="text-sm text-muted-foreground">Conjunto</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              {!isMultiValue ? (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Field>
                    <FieldLabel htmlFor="referenceValue">
                      Valor de Referencia
                    </FieldLabel>
                    <Input
                      id="referenceValue"
                      type="number"
                      step="any"
                      value={formData.referenceValue}
                      onChange={(e) =>
                        updateField('referenceValue', e.target.value)
                      }
                      disabled={updateMutation.isPending}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="uncertainty">Incerteza</FieldLabel>
                    <Input
                      id="uncertainty"
                      type="number"
                      step="any"
                      value={formData.uncertainty}
                      onChange={(e) =>
                        updateField('uncertainty', e.target.value)
                      }
                      disabled={updateMutation.isPending}
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="uncertaintyUnit">Unidade</FieldLabel>
                    <Input
                      id="uncertaintyUnit"
                      value={formData.uncertaintyUnit}
                      onChange={(e) =>
                        updateField('uncertaintyUnit', e.target.value)
                      }
                      disabled={updateMutation.isPending}
                    />
                  </Field>
                </div>
              ) : (
                <div className="space-y-4">
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
                            disabled={updateMutation.isPending}
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
                            disabled={updateMutation.isPending}
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
                            disabled={updateMutation.isPending}
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
                            disabled={updateMutation.isPending}
                          />
                        </Field>
                        <div className="flex items-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeCertifiedValue(index)}
                            disabled={
                              updateMutation.isPending ||
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
                            disabled={updateMutation.isPending}
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
                            disabled={updateMutation.isPending}
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
                            disabled={updateMutation.isPending}
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
                            disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  >
                    <HugeiconsIcon
                      icon={PlusSignIcon}
                      className="mr-2 h-4 w-4"
                    />
                    Adicionar Valor
                  </Button>
                </div>
              )}

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
                    disabled={updateMutation.isPending}
                  />
                </Field>

                <Field>
                  <FieldLabel htmlFor="distribution">Distribuicao</FieldLabel>
                  <Select
                    value={formData.distribution}
                    onValueChange={(v) =>
                      updateField('distribution', v as 'normal' | 'rectangular')
                    }
                    disabled={updateMutation.isPending}
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
                    disabled={updateMutation.isPending}
                  />
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
                  updateField('status', v as StandardFormData['status'])
                }
                disabled={updateMutation.isPending}
              >
                <SelectTrigger id="status" className="w-64">
                  <span>
                    {formData.status === 'ACTIVE'
                      ? 'Ativo'
                      : formData.status === 'INACTIVE'
                        ? 'Inativo'
                        : formData.status === 'OUT_OF_TOLERANCE'
                          ? 'Fora de Tolerância'
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

        {/* Audit Log - ISO 17025 Clause 8.4 (Control of Records) */}
        {auditLogData.length > 0 && (
          <AuditTimeline
            events={buildAuditTimelineEvents(auditLogData)}
            title="Histórico de Alterações (ISO 17025)"
          />
        )}

        {/* Submit Buttons */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/dashboard/standards' })}
            disabled={updateMutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Salvando...' : 'Salvar Alteracoes'}
          </Button>
        </div>
      </form>

      {/* Renew Certificate Dialog */}
      <Dialog open={showRenewDialog} onOpenChange={setShowRenewDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Renovar Certificado de Calibração</DialogTitle>
            <DialogDescription>
              Atualize os dados do certificado após uma nova calibração. O
              motivo é obrigatório para rastreabilidade (ISO 17025).
            </DialogDescription>
          </DialogHeader>

          {renewFormData && (
            <form onSubmit={handleRenewSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Novo N Certificado *</FieldLabel>
                  <Input
                    value={renewFormData.certificateNumber}
                    onChange={(e) =>
                      setRenewFormData((prev) =>
                        prev
                          ? { ...prev, certificateNumber: e.target.value }
                          : null,
                      )
                    }
                    placeholder="Ex: CAL-2025-001"
                    disabled={renewMutation.isPending}
                  />
                  {renewErrors.certificateNumber && (
                    <FieldError>{renewErrors.certificateNumber}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel>Calibrado por</FieldLabel>
                  <Input
                    value={renewFormData.calibratedBy}
                    onChange={(e) =>
                      setRenewFormData((prev) =>
                        prev ? { ...prev, calibratedBy: e.target.value } : null,
                      )
                    }
                    disabled={renewMutation.isPending}
                  />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <Field>
                  <FieldLabel>Nova Data de Calibração *</FieldLabel>
                  <Input
                    type="date"
                    value={renewFormData.calibrationDate}
                    onChange={(e) =>
                      setRenewFormData((prev) =>
                        prev
                          ? { ...prev, calibrationDate: e.target.value }
                          : null,
                      )
                    }
                    disabled={renewMutation.isPending}
                  />
                  {renewErrors.calibrationDate && (
                    <FieldError>{renewErrors.calibrationDate}</FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel>Nova Próxima Calibração *</FieldLabel>
                  <Input
                    type="date"
                    value={renewFormData.nextCalibrationDate}
                    onChange={(e) =>
                      setRenewFormData((prev) =>
                        prev
                          ? { ...prev, nextCalibrationDate: e.target.value }
                          : null,
                      )
                    }
                    disabled={renewMutation.isPending}
                  />
                  {renewErrors.nextCalibrationDate && (
                    <FieldError>{renewErrors.nextCalibrationDate}</FieldError>
                  )}
                </Field>
              </div>

              {!isMultiValue && (
                <div className="grid grid-cols-3 gap-4">
                  <Field>
                    <FieldLabel>Novo Valor de Referencia</FieldLabel>
                    <Input
                      type="number"
                      step="any"
                      value={renewFormData.referenceValue}
                      onChange={(e) =>
                        setRenewFormData((prev) =>
                          prev
                            ? { ...prev, referenceValue: e.target.value }
                            : null,
                        )
                      }
                      disabled={renewMutation.isPending}
                    />
                    <FieldDescription>
                      Deixe em branco para manter
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel>Nova Incerteza</FieldLabel>
                    <Input
                      type="number"
                      step="any"
                      value={renewFormData.uncertainty}
                      onChange={(e) =>
                        setRenewFormData((prev) =>
                          prev
                            ? { ...prev, uncertainty: e.target.value }
                            : null,
                        )
                      }
                      disabled={renewMutation.isPending}
                    />
                  </Field>

                  <Field>
                    <FieldLabel>Unidade</FieldLabel>
                    <Input
                      value={renewFormData.uncertaintyUnit}
                      onChange={(e) =>
                        setRenewFormData((prev) =>
                          prev
                            ? { ...prev, uncertaintyUnit: e.target.value }
                            : null,
                        )
                      }
                      disabled={renewMutation.isPending}
                    />
                  </Field>
                </div>
              )}

              <Field>
                <FieldLabel>Motivo da Renovacao *</FieldLabel>
                <Textarea
                  value={renewFormData.reason}
                  onChange={(e) =>
                    setRenewFormData((prev) =>
                      prev ? { ...prev, reason: e.target.value } : null,
                    )
                  }
                  placeholder="Ex: Recalibracao anual conforme procedimento PQ-001"
                  rows={3}
                  disabled={renewMutation.isPending}
                />
                <FieldDescription>
                  Obrigatorio para rastreabilidade (ISO 17025 Clause 8.4)
                </FieldDescription>
                {renewErrors.reason && (
                  <FieldError>{renewErrors.reason}</FieldError>
                )}
              </Field>

              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowRenewDialog(false)}
                  disabled={renewMutation.isPending}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={renewMutation.isPending}>
                  {renewMutation.isPending
                    ? 'Renovando...'
                    : 'Renovar Certificado'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
