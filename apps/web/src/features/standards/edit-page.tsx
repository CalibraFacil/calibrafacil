import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { ArrowLeft01Icon, RefreshIcon } from '@hugeicons/core-free-icons'

import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { calibraApi } from '@/utils/api'
import { StandardFormSections } from '@/features/standards/components/standard-form-sections'
import { StandardCertificateDocumentPanel } from '@/features/standards/components/standard-certificate-document-panel'
import {
  createStandardFormData,
  createStandardRenewFormData,
  parseStandardEditForm,
  parseStandardRenewForm,
  type StandardFormData,
  type StandardFormField,
  type StandardRenewFormData,
  type StandardRenewFormField,
} from '@/features/standards/forms'
import {
  useStandardAuditLogData,
  useStandardDetailData,
} from '@/features/standards/queries'
import type { StandardDetail } from '@/features/standards/types'
import type {
  RenewCertificateInput,
  UpdateReferenceStandardInput,
} from '@calibra-facil/schemas'

function toStandardWriteInput(
  input: UpdateReferenceStandardInput | RenewCertificateInput,
) {
  return Object.fromEntries(Object.entries(input))
}

export function EditStandardPage({ id }: { id: string }) {
  const { data: standard, isLoading } = useStandardDetailData(id)
  const { data: auditLogData } = useStandardAuditLogData(id)

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-80 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  if (!standard) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-destructive">
          Erro ao carregar padrão. Tente novamente.
        </CardContent>
      </Card>
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
  const [formData, setFormData] = useState<StandardFormData>(
    createStandardFormData(standard),
  )
  const [errors, setErrors] = useState<
    Partial<Record<StandardFormField, string>>
  >({})
  const [showRenewDialog, setShowRenewDialog] = useState(false)
  const [renewFormData, setRenewFormData] =
    useState<StandardRenewFormData | null>(null)
  const [renewErrors, setRenewErrors] = useState<
    Partial<Record<StandardRenewFormField, string>>
  >({})

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateReferenceStandardInput) =>
      calibraApi.standards.update(standard.id, toStandardWriteInput(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Padrão atualizado com sucesso.')
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const renewMutation = useMutation({
    mutationFn: async (payload: RenewCertificateInput) =>
      calibraApi.standards.renew(standard.id, toStandardWriteInput(payload)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['standards'] })
      toast.success('Certificado renovado com sucesso.')
      setShowRenewDialog(false)
      navigate({ to: '/dashboard/standards' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()

    const parsed = parseStandardEditForm(formData)
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

  const openRenewDialog = () => {
    setRenewFormData(createStandardRenewFormData(formData))
    setRenewErrors({})
    setShowRenewDialog(true)
  }

  const handleRenewSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!renewFormData) return

    const parsed = parseStandardRenewForm(renewFormData)
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Voltar"
            onClick={() => navigate({ to: '/dashboard/standards' })}
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              Editar padrão
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {formData.name}
            </p>
          </div>
        </div>
        <Button variant="outline" onClick={openRenewDialog}>
          <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
          Renovar certificado
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <StandardCertificateDocumentPanel standard={standard} />

        <StandardFormSections
          formData={formData}
          errors={errors}
          disabled={updateMutation.isPending}
          onChange={(nextData) => {
            setFormData(nextData)
            setErrors({})
          }}
        />

        {auditLogData.length > 0 && (
          <AuditTimeline
            events={buildAuditTimelineEvents(auditLogData)}
            title="Histórico de alterações"
          />
        )}

        <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: '/dashboard/standards' })}
            disabled={updateMutation.isPending}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={updateMutation.isPending}>
            {updateMutation.isPending ? 'Salvando...' : 'Salvar alterações'}
          </Button>
        </div>
      </form>

      <Dialog open={showRenewDialog} onOpenChange={setShowRenewDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Renovar certificado</DialogTitle>
            <DialogDescription>
              Registre os dados da nova calibração. Os valores metrológicos
              atuais do formulário serão preservados na renovação.
            </DialogDescription>
          </DialogHeader>

          {renewFormData && (
            <form onSubmit={handleRenewSubmit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Novo certificado *</FieldLabel>
                  <Input
                    value={renewFormData.certificateNumber}
                    onChange={(event) =>
                      setRenewFormData((prev) =>
                        prev
                          ? { ...prev, certificateNumber: event.target.value }
                          : null,
                      )
                    }
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
                    onChange={(event) =>
                      setRenewFormData((prev) =>
                        prev
                          ? { ...prev, calibratedBy: event.target.value }
                          : null,
                      )
                    }
                    disabled={renewMutation.isPending}
                  />
                </Field>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Field>
                  <FieldLabel>Nova data de calibração *</FieldLabel>
                  <Input
                    type="date"
                    value={renewFormData.calibrationDate}
                    onChange={(event) =>
                      setRenewFormData((prev) =>
                        prev
                          ? { ...prev, calibrationDate: event.target.value }
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
                  <FieldLabel>Nova próxima calibração *</FieldLabel>
                  <Input
                    type="date"
                    value={renewFormData.nextCalibrationDate}
                    onChange={(event) =>
                      setRenewFormData((prev) =>
                        prev
                          ? {
                              ...prev,
                              nextCalibrationDate: event.target.value,
                            }
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

              <Field>
                <FieldLabel>Motivo da renovação *</FieldLabel>
                <Textarea
                  value={renewFormData.reason}
                  onChange={(event) =>
                    setRenewFormData((prev) =>
                      prev ? { ...prev, reason: event.target.value } : null,
                    )
                  }
                  disabled={renewMutation.isPending}
                />
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
                  {renewMutation.isPending ? 'Renovando...' : 'Renovar'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
