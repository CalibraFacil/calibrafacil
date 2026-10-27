import { toast } from 'sonner'
import { useMemo } from 'react'
import {
  normalizeAccreditationNumber,
  resolveIssuedAccreditationSeal,
} from '@calibra-facil/shared'
import { useActiveOrganization } from '@calibra-facil/auth/client'
import {
  buildApprovedJobRecordModel,
  type ApprovedJobRecordData,
} from '@/features/jobs/detail-model'
import { ApprovedRecordToolbar } from './approved-record-toolbar'
import { ApprovedRecordHero } from './approved-record-hero'
import {
  AmendCertificateDialog,
  OutOfToleranceDialog,
  WithdrawCertificateDialog,
} from './approved-record-dialogs'
import { ApprovedRecordAmendmentBanner } from './approved-record-amendment-banner'
import { ApprovedRecordMain } from './approved-record-main'
import { ApprovedRecordAside } from './approved-record-aside'
import {
  LabelReadyNotifier,
  PendingLabelPoller,
} from './approved-record-label-polling'
import { useApprovedRecordActions } from '../use-approved-record-actions'

/**
 * Approved Job Record View - ISO 17025 Quality Record
 *
 * Once a job is APPROVED, it transforms from a "Living Document" (mutable)
 * to a "Quality Record" (immutable). This view reflects that shift with
 * read-only styling and distribution-focused actions.
 */
interface ApprovedJobRecordProps {
  job: ApprovedJobRecordData
  onBack: () => void
  onRefresh: () => void
}

export function ApprovedJobRecord({
  job,
  onBack,
  onRefresh,
}: ApprovedJobRecordProps) {
  const { methodSnapshot, standardsSnapshot } = job
  const isSuperseded = job.status === 'SUPERSEDED'
  const standardsCount = standardsSnapshot?.length ?? 0
  const { data: activeOrg } = useActiveOrganization()
  // Accreditation additional fields are not part of the inferred client type.
  const orgAccreditation: {
    accreditationActive?: boolean | null
    accreditationNumber?: string | null
    accreditationValidFrom?: Date | string | null
    accreditationValidUntil?: Date | string | null
  } = activeOrg ?? {}
  const accreditationNumber = normalizeAccreditationNumber(
    orgAccreditation.accreditationNumber ?? '',
  )
  // #647: vigência evaluated at the job's approval (emission) date.
  const approvedAtDate = job.approvedAt ? new Date(job.approvedAt) : undefined
  // Q42: the seal is the decision frozen at approval (the server reads it from
  // the certificate input); only a record approved before it was frozen falls
  // back to the rule it was issued under, from the lab's current fields.
  const { accredited: certificateAccredited, withheldReason } =
    resolveIssuedAccreditationSeal({
      frozenSeal: job.accreditationSeal,
      legacy: {
        lab: {
          accreditationActive: orgAccreditation.accreditationActive,
          accreditationNumber,
          accreditationValidFrom: orgAccreditation.accreditationValidFrom,
          accreditationValidUntil: orgAccreditation.accreditationValidUntil,
        },
        methodAccreditedScope: methodSnapshot.accreditedScope ?? false,
        // #427 Phase 1: an approval overridden past the CMC guard was
        // downgraded to non-accredited issuance.
        scopeOverrideJustification: job.scopeOverrideJustification,
        ...(approvedAtDate ? { atDate: approvedAtDate } : {}),
      },
    })
  const {
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
  } = useApprovedRecordActions({ job, onRefresh })
  const model = useMemo(() => buildApprovedJobRecordModel(job), [job])
  const { pointsTotal, pointsWithin, expandedUncertainty } = model

  return (
    <div className="space-y-6">
      {labelPending && job.labelUrl ? (
        <LabelReadyNotifier
          onReady={() => {
            setLabelPending(false)
            toast.success('Etiqueta gerada com sucesso!')
          }}
        />
      ) : null}
      {labelPending && !job.labelUrl ? (
        <PendingLabelPoller onRefresh={onRefresh} />
      ) : null}
      <ApprovedRecordToolbar
        job={job}
        onBack={onBack}
        labelPending={labelPending}
        isGeneratingLabel={isGeneratingLabel}
        isDownloadingLabel={isDownloadingLabel}
        amendAvailability={amendAvailability}
        canAmend={canAmend}
        canWithdraw={canWithdraw}
        withdrawAvailability={withdrawAvailability}
        handleDownloadLabel={handleDownloadLabel}
        handleGenerateLabel={handleGenerateLabel}
        setIsAmendDialogOpen={setIsAmendDialogOpen}
        setIsWithdrawDialogOpen={setIsWithdrawDialogOpen}
      />

      {/* Quality-record seal hero */}
      <ApprovedRecordHero
        job={job}
        isSuperseded={isSuperseded}
        isWithdrawn={isWithdrawn}
        isOutOfToleranceAsFound={isOutOfToleranceAsFound}
        pointsTotal={pointsTotal}
        pointsWithin={pointsWithin}
        standardsCount={standardsCount}
        expandedUncertainty={expandedUncertainty}
      />

      {/* Amendment Dialog - ISO 17025 Clause 7.8.4.1 */}
      <AmendCertificateDialog
        isAmendDialogOpen={isAmendDialogOpen}
        setIsAmendDialogOpen={setIsAmendDialogOpen}
        amendmentReason={amendmentReason}
        setAmendmentReason={setAmendmentReason}
        isAmending={isAmending}
        handleAmendCertificate={handleAmendCertificate}
      />

      {/* Withdrawal Dialog - ISO 17025 Clause 7.10 */}
      <WithdrawCertificateDialog
        isWithdrawDialogOpen={isWithdrawDialogOpen}
        setIsWithdrawDialogOpen={setIsWithdrawDialogOpen}
        withdrawalReason={withdrawalReason}
        setWithdrawalReason={setWithdrawalReason}
        isWithdrawing={isWithdrawing}
        handleWithdrawCertificate={handleWithdrawCertificate}
      />

      {/* §7.10 Out-of-tolerance NC Dialog (#426) */}
      <OutOfToleranceDialog
        isOotDialogOpen={isOotDialogOpen}
        setIsOotDialogOpen={setIsOotDialogOpen}
        ootDescription={ootDescription}
        setOotDescription={setOotDescription}
        ootAffectedScope={ootAffectedScope}
        setOotAffectedScope={setOotAffectedScope}
        ootNotifyCustomer={ootNotifyCustomer}
        setOotNotifyCustomer={setOotNotifyCustomer}
        isFlaggingOot={isFlaggingOot}
        handleFlagOutOfTolerance={handleFlagOutOfTolerance}
      />

      {/* Amendment Info Banner - ISO 17025 Clause 7.8.4.1 */}
      {(job.supersedesId ||
        job.supersededById ||
        job.amendmentInProgress ||
        isWithdrawn) && <ApprovedRecordAmendmentBanner job={job} />}

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ApprovedRecordMain
          job={job}
          model={model}
          certificateAccredited={certificateAccredited}
          sealWithheldReason={withheldReason}
          accreditationNumber={accreditationNumber}
        />
        <ApprovedRecordAside
          job={job}
          certificatePreviewUrl={certificatePreviewUrl}
          isDownloading={isDownloading}
          isGeneratingLabel={isGeneratingLabel}
          isDownloadingLabel={isDownloadingLabel}
          labelPending={labelPending}
          amendAvailability={amendAvailability}
          canAmend={canAmend}
          canWithdraw={canWithdraw}
          withdrawAvailability={withdrawAvailability}
          flagOutOfToleranceAvailability={flagOutOfToleranceAvailability}
          canFlagOutOfTolerance={canFlagOutOfTolerance}
          handleDownloadCertificate={handleDownloadCertificate}
          handleDownloadLabel={handleDownloadLabel}
          handleGenerateLabel={handleGenerateLabel}
          setIsAmendDialogOpen={setIsAmendDialogOpen}
          setIsWithdrawDialogOpen={setIsWithdrawDialogOpen}
          setIsOotDialogOpen={setIsOotDialogOpen}
        />
      </div>
    </div>
  )
}
