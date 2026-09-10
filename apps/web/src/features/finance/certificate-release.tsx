import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { useState } from 'react'
import type {
  CertificateReleasePolicyMode,
  CertificateReleaseStatus,
} from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

export interface CertificateReleaseDto {
  status: CertificateReleaseStatus
  appliedPolicy: { id: number; mode: CertificateReleasePolicyMode } | null
  lastEvaluatedAt: string
  releasedByUserName: string | null
  releaseReason: string | null
}

export function certificateReleaseQueryOptions(calibrationJobId: number) {
  return queryOptions<{ data: CertificateReleaseDto } | null>({
    queryKey: ['finance', 'certificate-release', calibrationJobId],
    queryFn: async () => {
      try {
        return await calibraApi.finance.getCertificateRelease<{
          data: CertificateReleaseDto
        }>(calibrationJobId)
      } catch (error) {
        // 404 = release row not yet evaluated. Treat as "no badge".
        if (
          error instanceof Error &&
          /Liberação ainda não calculada|Certificado não encontrado/.test(
            error.message,
          )
        ) {
          return null
        }
        throw error
      }
    },
    staleTime: 30_000,
  })
}

export function useCertificateRelease(
  calibrationJobId: number,
  enabled = true,
) {
  return useQuery({
    ...certificateReleaseQueryOptions(calibrationJobId),
    enabled,
  })
}

export const CERTIFICATE_RELEASE_LABEL: Record<
  CertificateReleaseStatus,
  string
> = {
  RELEASED: 'Liberado',
  HELD_FOR_BILLING: 'Retido para faturamento',
  HELD_FOR_PAYMENT: 'Retido para pagamento',
  RELEASED_BY_EXCEPTION: 'Liberado por exceção',
}

export function isHeldStatus(status: CertificateReleaseStatus) {
  return status === 'HELD_FOR_BILLING' || status === 'HELD_FOR_PAYMENT'
}

interface CertificateReleaseBadgeProps {
  status: CertificateReleaseStatus
}

export function CertificateReleaseBadge({
  status,
}: CertificateReleaseBadgeProps) {
  const label = CERTIFICATE_RELEASE_LABEL[status]
  const variant =
    status === 'RELEASED' || status === 'RELEASED_BY_EXCEPTION'
      ? 'default'
      : 'outline'
  const tone =
    status === 'RELEASED'
      ? 'bg-emerald-600 text-white'
      : status === 'RELEASED_BY_EXCEPTION'
        ? 'bg-amber-500 text-white'
        : 'border-amber-500 bg-amber-50 text-amber-700'

  return (
    <Badge
      variant={variant}
      className={`shrink-0 ${tone}`}
      data-testid="certificate-release-badge"
      data-status={status}
    >
      {label}
    </Badge>
  )
}

interface ManualReleaseDialogProps {
  calibrationJobId: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ManualReleaseDialog({
  calibrationJobId,
  open,
  onOpenChange,
}: ManualReleaseDialogProps) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  const disabled = trimmed.length === 0

  const mutation = useMutation({
    mutationFn: () =>
      calibraApi.finance.releaseCertificateByException<{
        data: CertificateReleaseDto
      }>(calibrationJobId, { reason: trimmed }),
    onSuccess: () => {
      toast.success('Certificado liberado com exceção')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'certificate-release', calibrationJobId],
      })
      setReason('')
      onOpenChange(false)
    },
    onError: (error) => {
      const message =
        error instanceof Error
          ? error.message
          : 'Erro ao liberar certificado com exceção'
      toast.error(message)
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Liberar certificado com exceção</DialogTitle>
          <DialogDescription>
            A liberação fica registrada na auditoria com seu usuário e o motivo
            informado. Use somente quando justificado.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="certificate-release-reason">
              Motivo <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="certificate-release-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={4}
              placeholder="Ex.: cliente prioritário com pagamento confirmado externamente"
              data-testid="certificate-release-reason-input"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              setReason('')
              onOpenChange(false)
            }}
            disabled={mutation.isPending}
          >
            Cancelar
          </Button>
          <Button
            variant="default"
            onClick={() => mutation.mutate()}
            disabled={disabled || mutation.isPending}
            data-testid="certificate-release-submit"
          >
            {mutation.isPending ? (
              <>
                <Spinner className="mr-2 h-4 w-4" />
                Liberando...
              </>
            ) : (
              'Liberar com exceção'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface CertificateReleaseControlProps {
  calibrationJobId: number
  jobStatus: string
}

/**
 * Compact controller that renders the release badge for approved/superseded
 * jobs and, when held, exposes the manual-release action. Renders nothing
 * for jobs that haven't reached approval.
 */
export function CertificateReleaseControl({
  calibrationJobId,
  jobStatus,
}: CertificateReleaseControlProps) {
  const enabled = jobStatus === 'APPROVED' || jobStatus === 'SUPERSEDED'
  const { data } = useCertificateRelease(calibrationJobId, enabled)
  const [dialogOpen, setDialogOpen] = useState(false)

  if (!enabled || !data?.data) return null
  const status = data.data.status

  return (
    <div className="flex items-center gap-2">
      <CertificateReleaseBadge status={status} />
      {isHeldStatus(status) && (
        <>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDialogOpen(true)}
            data-testid="certificate-release-open-dialog"
          >
            Liberar com exceção
          </Button>
          <ManualReleaseDialog
            calibrationJobId={calibrationJobId}
            open={dialogOpen}
            onOpenChange={setDialogOpen}
          />
        </>
      )}
    </div>
  )
}
