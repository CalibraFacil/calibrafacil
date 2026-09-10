import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { PlusSignIcon } from '@hugeicons/core-free-icons'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  SignalTile,
} from '@/components/instrument-panel'
import { HideFromRole, ShowForRole } from '@/components/permission-gate'
import { OperationUnavailableNotice } from '@/components/availability/action-availability-gate'
import { useOperationAvailability } from '@/runtime/use-operation-availability'
import {
  useImpactedCertificatesData,
  useSendStandardRecall,
  useStandardRecallData,
} from '@/features/standards/queries'
import type {
  ImpactedCertificate,
  StandardRecall,
  StandardRecallAcknowledgedVia,
  StandardRecallNotification,
  StandardStatus,
} from '@/features/standards/types'

const TABLE_WRAPPER_CLASS =
  'overflow-x-auto rounded-xl bg-background shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
const TH_CLASS = 'px-3 py-2.5 text-left font-medium text-muted-foreground'

const NOTIFICATION_STATUS_BADGES: Record<
  StandardRecallNotification['status'],
  { label: string; variant: 'default' | 'secondary' | 'outline' }
> = {
  PENDING: { label: 'Pendente', variant: 'outline' },
  GENERATED: { label: 'Gerada', variant: 'outline' },
  SENT: { label: 'Enviada', variant: 'secondary' },
  ACKNOWLEDGED: { label: 'Confirmada', variant: 'default' },
}

const ACKNOWLEDGED_VIA_LABELS: Record<StandardRecallAcknowledgedVia, string> = {
  email_link: 'link do e-mail',
  portal_link: 'portal',
  manual: 'registro manual',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function isoToDateInput(value: string): string {
  return value.slice(0, 10)
}

function dateInputToIsoStart(value: string): string | undefined {
  return value ? `${value}T00:00:00.000Z` : undefined
}

function dateInputToIsoEnd(value: string): string | undefined {
  return value ? `${value}T23:59:59.999Z` : undefined
}

/**
 * §7.10 recall panel (#426 Phase 1) for the standard detail page. Rendered
 * when the standard is OUT_OF_TOLERANCE or a recall campaign already exists:
 * DRAFT shows the review-and-approve wizard; SENT shows the notification
 * dashboard with per-certificate acknowledgement status.
 */
export function StandardRecallPanel({
  id,
  standardStatus,
}: {
  id: string
  standardStatus: StandardStatus
}) {
  const isOutOfTolerance = standardStatus === 'OUT_OF_TOLERANCE'
  const recallQuery = useStandardRecallData(id)
  const recall = recallQuery.data?.data ?? null

  if (!isOutOfTolerance && !recall) {
    return null
  }

  return (
    <Panel className="p-4 sm:p-5">
      <PanelHeader
        eyebrow="Qualidade"
        title="Recall de certificados"
        description="Notificação de clientes sobre certificados emitidos com este padrão fora de tolerância."
      />
      <div className="mt-4">
        {recallQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-40 w-full rounded-xl" />
          </div>
        ) : recallQuery.error ? (
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar os dados do recall.
          </p>
        ) : recall?.status === 'SENT' ? (
          <RecallSentDashboard id={id} recall={recall} />
        ) : (
          <RecallDraftWizard id={id} recall={recall} />
        )}
      </div>
    </Panel>
  )
}

function NcReference({ recall }: { recall: StandardRecall }) {
  return (
    <p className="text-sm text-muted-foreground">
      Não conformidade vinculada:{' '}
      <Link
        to="/dashboard/nc/$id"
        params={{ id: String(recall.ncId) }}
        className="font-mono font-medium text-primary underline-offset-4 hover:underline"
      >
        {recall.ncNumber}
      </Link>
    </p>
  )
}

// ---------------------------------------------------------------------------
// DRAFT state: review window + impacted certificates + approval-gated send
// ---------------------------------------------------------------------------

function RecallDraftWizard({
  id,
  recall,
  hideNotified = false,
}: {
  id: string
  recall: StandardRecall | null
  /** SENT-state "Adicionar certificados": only rows not yet notified. */
  hideNotified?: boolean
}) {
  // The impact query and the notification send are cloud commands; a
  // connected desktop runs both. Previously the whole wizard was inert there,
  // which meant a recall could only be worked from a browser.
  const impactAvailability = useOperationAvailability(
    'standards',
    'getImpactedCertificates',
  )
  const sendAvailability = useOperationAvailability('standards', 'sendRecall')
  const blocked = !impactAvailability.available || !sendAvailability.available
  const [fromInput, setFromInput] = useState('')
  const [toInput, setToInput] = useState('')
  const [excludedJobIds, setExcludedJobIds] = useState<number[]>([])
  const [confirmOpen, setConfirmOpen] = useState(false)

  const impactedQuery = useImpactedCertificatesData(id, {
    from: dateInputToIsoStart(fromInput),
    to: dateInputToIsoEnd(toInput),
    enabled: impactAvailability.available,
  })
  const impacted = impactedQuery.data
  const sendMutation = useSendStandardRecall(id)

  const rows = (impacted?.data ?? []).filter(
    (row) => !hideNotified || !row.alreadyNotified,
  )
  const selectableRows = rows.filter((row) => !row.alreadyNotified)
  const excluded = new Set(excludedJobIds)
  const selectedRows = selectableRows.filter((row) => !excluded.has(row.jobId))
  const selectedJobIds = selectedRows.map((row) => row.jobId)
  const selectedCustomers = new Set(selectedRows.map((row) => row.customer.id))
    .size

  const fromValue =
    fromInput || (impacted ? isoToDateInput(impacted.window.from) : '')
  const toValue =
    toInput || (impacted ? isoToDateInput(impacted.window.to) : '')

  const toggleRow = (jobId: number, checked: boolean) => {
    setExcludedJobIds((prev) =>
      checked ? prev.filter((value) => value !== jobId) : [...prev, jobId],
    )
  }

  const toggleAll = (checked: boolean) => {
    setExcludedJobIds(checked ? [] : selectableRows.map((row) => row.jobId))
  }

  const handleConfirmSend = () => {
    sendMutation.mutate(
      {
        jobIds: selectedJobIds,
        from: impacted?.window.from,
        to: impacted?.window.to,
      },
      {
        onSuccess: (result) => {
          setConfirmOpen(false)
          setExcludedJobIds([])
          toast.success(
            `Recall aprovado: ${result.data.created} notificação(ões) criada(s), ${result.data.skipped} já notificada(s).`,
          )
        },
        onError: (error) => {
          toast.error(error.message)
        },
      },
    )
  }

  return (
    <div className="space-y-4">
      {recall ? <NcReference recall={recall} /> : null}

      <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
        <Field>
          <FieldLabel>Período — de</FieldLabel>
          <Input
            type="date"
            value={fromValue}
            onChange={(event) => setFromInput(event.target.value)}
            disabled={blocked || sendMutation.isPending}
          />
        </Field>
        <Field>
          <FieldLabel>Período — até</FieldLabel>
          <Input
            type="date"
            value={toValue}
            onChange={(event) => setToInput(event.target.value)}
            disabled={blocked || sendMutation.isPending}
          />
        </Field>
      </div>

      {!impactAvailability.available ? (
        <OperationUnavailableNotice availability={impactAvailability} />
      ) : impactedQuery.isLoading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : impactedQuery.error ? (
        <p className="text-sm text-destructive">
          Erro ao carregar certificados afetados: {impactedQuery.error.message}
        </p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
          Nenhum certificado{' '}
          {hideNotified ? 'pendente de notificação' : 'afetado'} no período
          selecionado.
        </div>
      ) : (
        <>
          <ImpactedCertificatesTable
            rows={rows}
            excluded={excluded}
            onToggleRow={toggleRow}
            onToggleAll={toggleAll}
            disabled={sendMutation.isPending}
          />
          <p className="text-sm text-muted-foreground">
            <span className="font-mono font-medium tabular-nums text-foreground">
              {selectedJobIds.length}
            </span>{' '}
            certificado(s) selecionado(s),{' '}
            <span className="font-mono font-medium tabular-nums text-foreground">
              {selectedCustomers}
            </span>{' '}
            cliente(s).
          </p>
        </>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <ShowForRole role={['owner', 'admin']}>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={
              blocked || selectedJobIds.length === 0 || sendMutation.isPending
            }
          >
            {sendMutation.isPending ? (
              <Spinner className="mr-2 size-4" />
            ) : null}
            Aprovar e enviar notificações ({selectedJobIds.length})
          </Button>
          <OperationUnavailableNotice availability={sendAvailability} />
        </ShowForRole>
        <HideFromRole role={['owner', 'admin']}>
          <p className="text-sm text-muted-foreground">
            O envio requer aprovação de um administrador ou responsável.
          </p>
        </HideFromRole>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Aprovar recall</DialogTitle>
            <DialogDescription>
              Serão enviadas notificações para{' '}
              <span className="font-medium text-foreground">
                {selectedJobIds.length} certificado(s)
              </span>{' '}
              de{' '}
              <span className="font-medium text-foreground">
                {selectedCustomers} cliente(s)
              </span>
              , referentes ao período{' '}
              <span className="font-medium text-foreground">
                {formatDate(impacted?.window.from ?? null)} –{' '}
                {formatDate(impacted?.window.to ?? null)}
              </span>
              . O envio registra você como aprovador do lote e fica documentado
              na não conformidade.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
              disabled={sendMutation.isPending}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmSend}
              disabled={sendMutation.isPending || selectedJobIds.length === 0}
            >
              {sendMutation.isPending ? (
                <Spinner className="mr-2 size-4" />
              ) : null}
              Aprovar e enviar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ImpactedCertificatesTable({
  rows,
  excluded,
  onToggleRow,
  onToggleAll,
  disabled,
}: {
  rows: ImpactedCertificate[]
  excluded: ReadonlySet<number>
  onToggleRow: (jobId: number, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  disabled: boolean
}) {
  const selectableRows = rows.filter((row) => !row.alreadyNotified)
  const selectedCount = selectableRows.filter(
    (row) => !excluded.has(row.jobId),
  ).length
  const allSelected =
    selectableRows.length > 0 && selectedCount === selectableRows.length

  return (
    <div className={TABLE_WRAPPER_CLASS}>
      <table className="w-full min-w-[44rem] text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40">
            <th className="w-10 px-3 py-2.5">
              <Checkbox
                aria-label="Selecionar todos os certificados"
                checked={allSelected}
                indeterminate={selectedCount > 0 && !allSelected}
                onCheckedChange={(checked) => onToggleAll(checked === true)}
                disabled={disabled || selectableRows.length === 0}
              />
            </th>
            <th className={TH_CLASS}>Certificado</th>
            <th className={TH_CLASS}>Cliente</th>
            <th className={TH_CLASS}>E-mail</th>
            <th className={TH_CLASS}>Aprovado em</th>
            <th className={TH_CLASS}>Situação</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const selectable = !row.alreadyNotified
            const checked = selectable && !excluded.has(row.jobId)
            return (
              <tr
                key={row.jobId}
                className={`border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35 ${
                  row.alreadyNotified ? 'opacity-60' : ''
                }`}
              >
                <td className="px-3 py-2.5">
                  <Checkbox
                    aria-label={`Selecionar certificado ${row.certificateNumber}`}
                    checked={checked}
                    onCheckedChange={(value) =>
                      onToggleRow(row.jobId, value === true)
                    }
                    disabled={disabled || !selectable}
                  />
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums">
                  {row.certificateNumber}
                </td>
                <td className="px-3 py-2.5">{row.customer.name}</td>
                <td className="px-3 py-2.5">
                  {row.customer.email ?? (
                    <span className="text-muted-foreground">— sem e-mail</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums">
                  {formatDate(row.approvedAt)}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {row.alreadyNotified ? (
                      <Badge variant="secondary">já notificado</Badge>
                    ) : null}
                    {row.supersededByCertificateNumber ? (
                      <span className="text-xs text-muted-foreground">
                        retificado →{' '}
                        <span className="font-mono">
                          {row.supersededByCertificateNumber}
                        </span>
                      </span>
                    ) : null}
                    {!row.alreadyNotified &&
                    !row.supersededByCertificateNumber ? (
                      <span className="text-muted-foreground">—</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SENT state: approval metadata + counts + per-certificate notification table
// ---------------------------------------------------------------------------

function RecallSentDashboard({
  id,
  recall,
}: {
  id: string
  recall: StandardRecall
}) {
  const addCertificatesAvailability = useOperationAvailability(
    'standards',
    'getImpactedCertificates',
  )
  const [showAdd, setShowAdd] = useState(false)

  return (
    <div className="space-y-5">
      <NcReference recall={recall} />

      <BlueprintGrid className="sm:grid-cols-3">
        <BlueprintField label="Aprovado em" mono>
          {formatDateTime(recall.approvedAt)}
        </BlueprintField>
        <BlueprintField label="Aprovado por" mono>
          {recall.approvedBy ?? '—'}
        </BlueprintField>
        <BlueprintField label="Período notificado" mono>
          {formatDate(recall.fromDate)} – {formatDate(recall.toDate)}
        </BlueprintField>
      </BlueprintGrid>

      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
        <SignalTile
          label="Total"
          value={String(recall.counts.total)}
          tone="neutral"
        />
        <SignalTile
          label="Enviadas"
          value={String(recall.counts.sent)}
          tone="info"
        />
        <SignalTile
          label="Confirmadas"
          value={String(recall.counts.acknowledged)}
          tone={recall.counts.acknowledged > 0 ? 'ok' : 'neutral'}
        />
        <SignalTile
          label="Rejeitadas (bounce)"
          value={String(recall.counts.bounced)}
          tone={recall.counts.bounced > 0 ? 'critical' : 'neutral'}
        />
        <SignalTile
          label="Sem e-mail"
          value={String(recall.counts.missingEmail)}
          tone={recall.counts.missingEmail > 0 ? 'warning' : 'neutral'}
        />
      </div>

      <RecallNotificationsTable notifications={recall.notifications} />

      <div className="space-y-3">
        <Button
          variant="outline"
          onClick={() => setShowAdd((value) => !value)}
          disabled={!addCertificatesAvailability.available}
        >
          <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
          {showAdd ? 'Ocultar novos certificados' : 'Adicionar certificados'}
        </Button>
        <OperationUnavailableNotice
          availability={addCertificatesAvailability}
        />
        {showAdd && addCertificatesAvailability.available ? (
          <div className="rounded-xl border border-border/70 p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Certificados afetados ainda não notificados. O envio é idempotente
              por certificado — clientes já notificados não recebem duplicatas.
            </p>
            <RecallDraftWizard id={id} recall={recall} hideNotified />
          </div>
        ) : null}
      </div>
    </div>
  )
}

function RecallNotificationsTable({
  notifications,
}: {
  notifications: StandardRecallNotification[]
}) {
  if (notifications.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
        Nenhuma notificação registrada neste recall.
      </div>
    )
  }

  return (
    <div className={TABLE_WRAPPER_CLASS}>
      <table className="w-full min-w-[52rem] text-sm">
        <thead>
          <tr className="border-b border-border/70 bg-muted/40">
            <th className={TH_CLASS}>Certificado</th>
            <th className={TH_CLASS}>Cliente</th>
            <th className={TH_CLASS}>E-mail</th>
            <th className={TH_CLASS}>Status</th>
            <th className={TH_CLASS}>Enviada em</th>
            <th className={TH_CLASS}>Confirmada em</th>
          </tr>
        </thead>
        <tbody>
          {notifications.map((notification) => {
            const badge = NOTIFICATION_STATUS_BADGES[notification.status]
            return (
              <tr
                key={notification.id}
                className="border-b border-border/70 transition-colors last:border-0 hover:bg-muted/35"
              >
                <td className="px-3 py-2.5 font-mono tabular-nums">
                  {notification.certificateNumber}
                </td>
                <td className="px-3 py-2.5">
                  {notification.recipientName ?? '—'}
                </td>
                <td className="px-3 py-2.5">
                  {notification.recipientEmail ?? (
                    <span className="text-muted-foreground">— sem e-mail</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                    {notification.bounced ? (
                      <Badge variant="destructive">bounce</Badge>
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-mono tabular-nums">
                  {formatDateTime(notification.sentAt)}
                </td>
                <td className="px-3 py-2.5">
                  <span className="font-mono tabular-nums">
                    {formatDateTime(notification.acknowledgedAt)}
                  </span>
                  {notification.acknowledgedVia ? (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      via{' '}
                      {ACKNOWLEDGED_VIA_LABELS[notification.acknowledgedVia]}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
