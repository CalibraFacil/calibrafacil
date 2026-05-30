import { useDeferredValue, useState } from 'react'
import Papa from 'papaparse'
import { differenceInCalendarDays, format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Download01Icon,
  RefreshIcon,
  SecurityCheckIcon,
  ShieldKeyIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import { type SignalTone } from '@/components/instrument-panel'
import {
  ConsoleEmpty,
  ConsoleLoadingRows,
  ConsolePageHeader,
  ConsoleSearch,
  SectionPanel,
  StatusChip,
} from '@/features/backoffice/console'
import { useBackofficeAuditLogData } from '@/features/backoffice/queries'
import { formatDateTime } from '@/features/backoffice/customer-success/model'
import type { BackofficeAuditLogEntry } from '@/features/backoffice/types'

const PAGE_SIZE = 50

/** Quick categories — each is an ilike-on-action search preset. */
const AUDIT_CATEGORIES = [
  { label: 'Tudo', keyword: '' },
  { label: 'Impersonação', keyword: 'impersonation' },
  { label: 'Comercial', keyword: 'commercial' },
  { label: 'Aprovações', keyword: 'approval' },
  { label: 'Assinaturas', keyword: 'subscription' },
  { label: 'Acessos', keyword: 'entitlement' },
  { label: 'Contas', keyword: 'organization' },
] as const

function formatDayLabel(iso: string): string {
  const date = new Date(iso)
  const diff = differenceInCalendarDays(new Date(), date)
  if (diff === 0) return 'Hoje'
  if (diff === 1) return 'Ontem'
  return format(date, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
}

/** Group time-ordered entries into consecutive day buckets for scannability. */
function groupByDay(entries: ReadonlyArray<BackofficeAuditLogEntry>) {
  const groups: Array<{ day: string; entries: BackofficeAuditLogEntry[] }> = []
  for (const entry of entries) {
    const day = formatDayLabel(entry.createdAt)
    const last = groups.at(-1)
    if (last && last.day === day) last.entries.push(entry)
    else groups.push({ day, entries: [entry] })
  }
  return groups
}

function downloadAuditCsv(entries: ReadonlyArray<BackofficeAuditLogEntry>) {
  const csv = Papa.unparse({
    fields: [
      'Quando',
      'Ação',
      'Entidade',
      'ID da entidade',
      'Ator',
      'Email do ator',
      'Alvo',
      'Detalhes',
    ],
    data: entries.map((entry) => [
      entry.createdAt,
      entry.action,
      entry.entityType,
      entry.entityId ?? '',
      entry.actorUser?.name ?? 'Sistema',
      entry.actorUser?.email ?? '',
      entry.targetUser?.name ?? '',
      entry.details ? JSON.stringify(entry.details) : '',
    ]),
  })
  // Prepend a BOM so Excel opens UTF-8 accents correctly.
  const blob = new Blob([`﻿${csv}`], {
    type: 'text/csv;charset=utf-8;',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `auditoria-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function actionTone(action: string): SignalTone {
  if (/(banned|failed|cancel|escalat|void|delete)/i.test(action)) {
    return 'critical'
  }
  if (/impersonation/i.test(action)) return 'warning'
  if (
    /(created|issued|provisioned|completed|synced|reissued|unbanned)/i.test(
      action,
    )
  ) {
    return 'ok'
  }
  if (/(updated|assigned|responded|requested|status)/i.test(action)) {
    return 'info'
  }
  return 'neutral'
}

export function AuditLogExplorerPage() {
  const [search, setSearch] = useState('')
  const [entityType, setEntityType] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const deferredSearch = useDeferredValue(search.trim())

  const query = useBackofficeAuditLogData({
    search: deferredSearch || undefined,
    entityType: entityType || undefined,
    limit,
  })

  const entries = query.data?.data ?? []
  const groups = groupByDay(entries)
  const hasMore = query.data?.nextCursor != null
  const isForbidden =
    query.isError &&
    query.error instanceof Error &&
    /403|administrador|forbidden|acesso/i.test(query.error.message)

  return (
    <div className="space-y-5">
      <ConsolePageHeader
        eyebrow="Governança"
        title="Auditoria"
        description="Trilha imutável de toda ação sensível do backoffice — impersonação, banimentos, provisionamentos, ofertas e mudanças de conta — com ator, alvo e contexto."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => downloadAuditCsv(entries)}
              disabled={entries.length === 0}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon icon={Download01Icon} className="size-4" />
              Exportar CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => query.refetch()}
              disabled={query.isFetching}
              className="min-h-10 transition-transform active:scale-[0.96]"
            >
              <HugeiconsIcon
                icon={RefreshIcon}
                className={cn('size-4', query.isFetching && 'animate-spin')}
              />
              Atualizar
            </Button>
          </>
        }
      />

      <SectionPanel
        eyebrow="Registro"
        title="Eventos da plataforma"
        description={
          query.isPending || isForbidden
            ? undefined
            : `${entries.length} evento(s)${hasMore ? '+' : ''} · mais recentes primeiro`
        }
        contentClassName="space-y-4"
      >
        <div className="flex flex-wrap gap-1.5">
          {AUDIT_CATEGORIES.map((category) => (
            <Button
              key={category.label}
              type="button"
              size="xs"
              variant={search === category.keyword ? 'default' : 'outline'}
              onClick={() => setSearch(category.keyword)}
              className="transition-transform active:scale-[0.96]"
            >
              {category.label}
            </Button>
          ))}
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <ConsoleSearch
            value={search}
            onChange={setSearch}
            placeholder="Buscar por ação, tipo de entidade ou ID…"
          />
          <NativeSelect
            className="sm:w-56"
            value={entityType}
            onChange={(event) => setEntityType(event.target.value)}
          >
            <NativeSelectOption value="">Todas as entidades</NativeSelectOption>
            {Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => (
              <NativeSelectOption key={value} value={value}>
                {label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </div>

        {query.isPending ? (
          <ConsoleLoadingRows count={8} />
        ) : isForbidden ? (
          <ConsoleEmpty
            icon={ShieldKeyIcon}
            title="Acesso restrito"
            description="A auditoria é visível apenas para administradores da plataforma."
          />
        ) : entries.length === 0 ? (
          <ConsoleEmpty
            icon={SecurityCheckIcon}
            title="Nenhum evento neste recorte"
            description="Ajuste os filtros para ver outros eventos da trilha de auditoria."
          />
        ) : (
          <>
            <div className="space-y-4">
              {groups.map((group) => (
                <div key={group.day} className="space-y-1.5">
                  <p className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {group.day}
                  </p>
                  <div className="overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                    <div className="divide-y">
                      {group.entries.map((entry) => (
                        <AuditRow key={entry.id} entry={entry} />
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {hasMore ? (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setLimit((current) => current + PAGE_SIZE)}
                  disabled={query.isFetching}
                  className="min-h-10 transition-transform active:scale-[0.96]"
                >
                  Carregar mais {PAGE_SIZE}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </SectionPanel>
    </div>
  )
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  'backoffice.impersonation.start': 'Impersonação iniciada',
  'backoffice.impersonation.stop': 'Impersonação encerrada',
  'backoffice.impersonation.handoff.started':
    'Impersonação — transferência iniciada',
  'backoffice.bootstrap.completed': 'Bootstrap do backoffice concluído',
  'backoffice.entitlement_override.granted': 'Acesso concedido (comp/trial)',
  'backoffice.entitlement_override.revoked': 'Acesso revogado',
  'backoffice.subscription.plan_changed': 'Plano da assinatura alterado',
  'backoffice.subscription.canceled': 'Assinatura cancelada',
  'backoffice.subscription.reactivated': 'Assinatura reativada',
  'backoffice.approval.requested': 'Aprovação solicitada',
  'backoffice.approval.approved': 'Aprovação concedida',
  'backoffice.approval.rejected': 'Aprovação recusada',
  'backoffice.interaction.recorded': 'Interação registrada',
  'backoffice.operator_alert.acknowledged': 'Alerta reconhecido',
  'backoffice.operator_alerts.recomputed': 'Alertas recalculados',
  'backoffice.import_run.validated': 'Importação validada (simulação)',
  'backoffice.account_task.created': 'Tarefa criada',
  'backoffice.account_task.completed': 'Tarefa concluída',
  'backoffice.user.role_updated': 'Papel de plataforma atualizado',
  'backoffice.user.banned': 'Usuário banido',
  'backoffice.user.unbanned': 'Usuário reabilitado',
  'commercial.offer.issued': 'Oferta emitida',
  'commercial.offer.canceled': 'Oferta cancelada',
  'commercial.offer.reissued': 'Oferta reemitida',
  'commercial.billing_contact.created': 'Contato de cobrança criado',
  'commercial.billing_customer.synced': 'Cliente de cobrança sincronizado',
}

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  user: 'Usuário',
  organization: 'Organização',
  commercial_offer: 'Oferta comercial',
  billing_contact: 'Contato de cobrança',
  billing_customer: 'Cliente de cobrança',
  approval_request: 'Aprovação',
  operator_alert: 'Alerta',
  import_run: 'Importação',
  account_task: 'Tarefa',
  entitlement_override: 'Concessão de acesso',
  subscription: 'Assinatura',
  platform: 'Plataforma',
  portal_domain: 'Domínio do portal',
}

/** Friendly label for an audit action, humanizing anything not mapped. */
function friendlyAuditAction(action: string): string {
  const mapped = AUDIT_ACTION_LABELS[action]
  if (mapped) return mapped
  const text = action
    .replace(/^(backoffice|commercial)\./, '')
    .replace(/[._]+/g, ' ')
    .trim()
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function friendlyEntityType(entityType: string): string {
  return (
    AUDIT_ENTITY_LABELS[entityType] ??
    entityType.replace(/[._]+/g, ' ').trim()
  )
}

/** Short, de-noised id for display (raw ids/UUIDs are noise in the feed). */
function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 8)}…` : id
}

function AuditRow({ entry }: { entry: BackofficeAuditLogEntry }) {
  const actor = entry.actorUser
  const target = entry.targetUser
  const hasDetails =
    entry.details != null && Object.keys(entry.details).length > 0

  return (
    <div className="grid grid-cols-1 gap-2 px-4 py-3 md:grid-cols-[minmax(0,11rem)_minmax(0,1.4fr)_minmax(0,1fr)] md:items-start md:gap-3">
      <span className="font-mono text-xs tabular-nums text-muted-foreground">
        {formatDateTime(entry.createdAt)}
      </span>

      <span className="min-w-0">
        <StatusChip tone={actionTone(entry.action)}>
          {friendlyAuditAction(entry.action)}
        </StatusChip>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {friendlyEntityType(entry.entityType)}
          {target
            ? ` → ${target.name}`
            : entry.entityId
              ? ` · ${shortId(entry.entityId)}`
              : ''}
        </span>
        {hasDetails ? (
          <details className="group mt-1">
            <summary className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground">
              Ver detalhes
            </summary>
            <pre className="mt-1 max-w-full overflow-x-auto rounded-lg bg-muted/50 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
              {JSON.stringify(entry.details, null, 2)}
            </pre>
          </details>
        ) : null}
      </span>

      <span className="min-w-0 text-sm">
        {actor ? (
          <>
            <span className="block truncate font-medium">{actor.name}</span>
            <span className="block truncate text-xs text-muted-foreground">
              {actor.email}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Sistema</span>
        )}
      </span>
    </div>
  )
}
