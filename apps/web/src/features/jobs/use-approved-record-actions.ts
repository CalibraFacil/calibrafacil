import { calibraApi } from '@/utils/api'
import { toast } from 'sonner'
import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { jobEventQueryKeys } from '@/lib/query-effects'
import {
  getJobCertificateDownloadUrl,
  getJobLabelDownloadUrl,
  useJobCertificateDownloadUrlData,
} from '@/features/jobs/queries'
import { useNavigate } from '@tanstack/react-router'
import { type ApprovedJobRecordData } from '@/features/jobs/detail-model'
import { useOperationAvailability } from '@/runtime/use-operation-availability'

/**
 * The state and handlers behind the approved record's actions: certificate and
 * label download, amendment (ISO 17025 7.8.4.1) and the 7.10 out-of-tolerance
 * non-conformance.
 */
export function useApprovedRecordActions({
  job,
  onRefresh,
}: {
  job: ApprovedJobRecordData
  onRefresh: () => void
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  /** Refresh what a lifecycle event changed (lib/query-effects.ts). */
  const refreshAfter = useCallback(
    async (event: 'amended' | 'withdrawn') => {
      await Promise.all(
        jobEventQueryKeys(event).map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      )
    },
    [queryClient],
  )
  const [isDownloading, setIsDownloading] = useState(false)
  const [isGeneratingLabel, setIsGeneratingLabel] = useState(false)
  const [isDownloadingLabel, setIsDownloadingLabel] = useState(false)
  const [labelPending, setLabelPending] = useState(false)
  // Amendment state - ISO 17025 Clause 7.8.4.1
  const [isAmendDialogOpen, setIsAmendDialogOpen] = useState(false)
  const [amendmentReason, setAmendmentReason] = useState('')
  const [isAmending, setIsAmending] = useState(false)
  // §7.10 out-of-tolerance NC state (#426)
  const isOutOfToleranceAsFound = job.asFoundConformity === 'NON_CONFORMING'
  // Both of these are cloud commands against an already-approved record, so
  // the job's own local queue cannot make them stale — connectivity is the
  // only real blocker. Previously §7.10 flagging was hidden on desktop
  // outright and amendment was not gated at all, so it failed with a
  // transport error instead of an explanation.
  const flagOutOfToleranceAvailability = useOperationAvailability(
    'jobs',
    'flagOutOfTolerance',
  )
  const amendAvailability = useOperationAvailability('jobs', 'amend')
  const withdrawAvailability = useOperationAvailability(
    'jobs',
    'withdrawCertificate',
  )
  // The original stays valid while an amendment is in progress, but only one
  // amendment may be open; a withdrawn certificate is not amended.
  const isWithdrawn = job.certificateLifecycle?.status === 'WITHDRAWN'
  const hasAmendmentInProgress = Boolean(job.amendmentInProgress)
  const canAmend =
    job.status !== 'SUPERSEDED' && !isWithdrawn && !hasAmendmentInProgress
  const canWithdraw = !isWithdrawn
  // Withdrawal state - ISO 17025 Clause 7.10
  const [isWithdrawDialogOpen, setIsWithdrawDialogOpen] = useState(false)
  const [withdrawalReason, setWithdrawalReason] = useState('')
  const [isWithdrawing, setIsWithdrawing] = useState(false)
  const canFlagOutOfTolerance = isOutOfToleranceAsFound
  const [isOotDialogOpen, setIsOotDialogOpen] = useState(false)
  const [ootDescription, setOotDescription] = useState('')
  const [ootAffectedScope, setOotAffectedScope] = useState('')
  const [ootNotifyCustomer, setOotNotifyCustomer] = useState(true)
  const [isFlaggingOot, setIsFlaggingOot] = useState(false)
  const fetchCertificateDownloadUrl = useCallback(async () => {
    return getJobCertificateDownloadUrl(job.id)
  }, [job.id])

  const { data: certificatePreviewDownloadUrl } =
    useJobCertificateDownloadUrlData({
      certificateUrl: job.certificateUrl,
      enabled: Boolean(job.certificateUrl),
      jobId: job.id,
    })
  const certificatePreviewUrl =
    certificatePreviewDownloadUrl ?? job.certificateUrl

  const handleDownloadCertificate = async () => {
    setIsDownloading(true)
    try {
      const url = await fetchCertificateDownloadUrl()
      window.open(url, '_blank')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao baixar certificado',
      )
    } finally {
      setIsDownloading(false)
    }
  }

  const handleGenerateLabel = async () => {
    setIsGeneratingLabel(true)
    try {
      await calibraApi.jobs.generateLabel(job.id)
      // Start polling for label completion
      setLabelPending(true)
      toast.info('Gerando etiqueta... Aguarde.')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao gerar etiqueta',
      )
    } finally {
      setIsGeneratingLabel(false)
    }
  }

  const handleDownloadLabel = async () => {
    setIsDownloadingLabel(true)
    try {
      const url = await getJobLabelDownloadUrl(job.id)
      window.open(url, '_blank')
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao baixar etiqueta',
      )
    } finally {
      setIsDownloadingLabel(false)
    }
  }

  // Handle certificate amendment - ISO 17025 Clause 7.8.4.1
  const handleAmendCertificate = async () => {
    if (amendmentReason.length < 10) {
      toast.error('O motivo da retificação deve ter pelo menos 10 caracteres')
      return
    }

    setIsAmending(true)
    try {
      const result = await calibraApi.jobs.amend(job.id, amendmentReason)

      // The original now shows the amendment in progress; lists show the new job.
      await refreshAfter('amended')
      toast.success(`Retificação criada: ${result.amendedJob.jobId}`)
      setIsAmendDialogOpen(false)
      setAmendmentReason('')

      // Navigate to the new amended job
      navigate({
        to: '/dashboard/jobs/$id',
        params: { id: result.amendedJob.jobId },
      })
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao criar retificação',
      )
    } finally {
      setIsAmending(false)
    }
  }

  // Withdraw the issued certificate - ISO 17025 Clause 7.10. The reason is
  // mandatory; the job keeps its status and the record is refreshed.
  const handleWithdrawCertificate = async () => {
    const reason = withdrawalReason.trim()
    if (reason.length < 10) {
      toast.error('O motivo da retirada deve ter pelo menos 10 caracteres')
      return
    }

    setIsWithdrawing(true)
    try {
      await calibraApi.jobs.withdrawCertificate(job.id, reason)
      await refreshAfter('withdrawn')
      toast.success('Certificado retirado')
      setIsWithdrawDialogOpen(false)
      setWithdrawalReason('')
      onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Erro ao retirar certificado',
      )
    } finally {
      setIsWithdrawing(false)
    }
  }

  // §7.10 (#426): open a typed NC (and optional customer notification) for an
  // as-found out-of-tolerance result. Cloud-only — the button is hidden on desktop.
  const handleFlagOutOfTolerance = async () => {
    setIsFlaggingOot(true)
    try {
      await calibraApi.jobs.flagOutOfTolerance(job.id, {
        description: ootDescription.trim() || undefined,
        affectedScope: ootAffectedScope.trim() || undefined,
        notifyCustomer: ootNotifyCustomer,
      })
      toast.success('Não conformidade registrada')
      toast.info('Acompanhe na área de Qualidade (NC)')
      setIsOotDialogOpen(false)
      setOotDescription('')
      setOotAffectedScope('')
      setOotNotifyCustomer(true)
      onRefresh()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Erro ao registrar não conformidade',
      )
    } finally {
      setIsFlaggingOot(false)
    }
  }

  return {
    isDownloading,
    isGeneratingLabel,
    isDownloadingLabel,
    labelPending,
    setLabelPending,
    isAmendDialogOpen,
    setIsAmendDialogOpen,
    amendmentReason,
    setAmendmentReason,
    isAmending,
    canAmend,
    canWithdraw,
    isWithdrawn,
    withdrawAvailability,
    isWithdrawDialogOpen,
    setIsWithdrawDialogOpen,
    withdrawalReason,
    setWithdrawalReason,
    isWithdrawing,
    handleWithdrawCertificate,
    isOutOfToleranceAsFound,
    flagOutOfToleranceAvailability,
    amendAvailability,
    canFlagOutOfTolerance,
    isOotDialogOpen,
    setIsOotDialogOpen,
    ootDescription,
    setOotDescription,
    ootAffectedScope,
    setOotAffectedScope,
    ootNotifyCustomer,
    setOotNotifyCustomer,
    isFlaggingOot,
    certificatePreviewUrl,
    handleDownloadCertificate,
    handleGenerateLabel,
    handleDownloadLabel,
    handleAmendCertificate,
    handleFlagOutOfTolerance,
  }
}
