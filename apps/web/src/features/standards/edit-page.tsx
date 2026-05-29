import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { FloppyDiskIcon, RefreshIcon } from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
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
  ACTION_BUTTON_CLASS,
  Panel,
  PanelHeader,
} from '@/components/instrument-panel'
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
import { useStandardDetailData } from '@/features/standards/queries'
import type { StandardDetail } from '@/features/standards/types'
import type {
  RenewCertificateInput,
  UpdateReferenceStandardInput,
} from '@calibra-facil/schemas'
import { cn } from '@/lib/utils'

function toStandardWriteInput(
  input: UpdateReferenceStandardInput | RenewCertificateInput,
) {
  return Object.fromEntries(Object.entries(input))
}

export function EditStandardPage({ id }: { id: string }) {
  const { data: standard, isLoading } = useStandardDetailData(id)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-7 w-52" />
        </div>
        <Skeleton className="h-80 w-full rounded-2xl" />
      </div>
    )
  }

  if (!standard) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          Erro ao carregar padrão. Tente novamente.
        </p>
      </Panel>
    )
  }

  return <EditStandardForm key={standard.id} standard={standard} />
}

function EditStandardForm({ standard }: { standard: StandardDetail }) {
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
  const isSaving = updateMutation.isPending

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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Padrão de referência
          </p>
          <h1 className="text-balance text-2xl font-semibold tracking-tight">
            Editar padrão
          </h1>
          <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
            {formData.name}
          </p>
        </div>
        <Button
          variant="outline"
          onClick={openRenewDialog}
          className={`${ACTION_BUTTON_CLASS} shrink-0`}
        >
          <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
          Renovar certificado
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Panel className="p-4 sm:p-5">
          <PanelHeader eyebrow="Rastreabilidade" title="Certificado atual" />
          <div className="mt-4">
            <StandardCertificateDocumentPanel standard={standard} />
          </div>
        </Panel>

        <Panel className="p-4 sm:p-5">
          <StandardFormSections
            formData={formData}
            errors={errors}
            disabled={isSaving}
            onChange={(nextData) => {
              setFormData(nextData)
              setErrors({})
            }}
          />
        </Panel>

        <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
          <div className="flex flex-col gap-3 rounded-2xl bg-card/95 p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06),0_16px_40px_rgba(15,23,42,0.08)] ring-1 ring-foreground/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="px-1 text-pretty text-xs text-muted-foreground">
              As alterações são registradas no histórico do padrão.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/standards' })}
                disabled={isSaving}
                className={ACTION_BUTTON_CLASS}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className={cn(ACTION_BUTTON_CLASS, 'min-w-40')}
              >
                {isSaving ? (
                  <>
                    <Spinner className="mr-2 size-4" />
                    Salvando…
                  </>
                ) : (
                  <>
                    <HugeiconsIcon
                      icon={FloppyDiskIcon}
                      className="mr-2 size-4"
                    />
                    Salvar alterações
                  </>
                )}
              </Button>
            </div>
          </div>
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
