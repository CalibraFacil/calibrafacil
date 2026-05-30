import { useDeferredValue, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Download01Icon,
  RefreshIcon,
  SecurityCheckIcon,
  ShieldKeyIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
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

function csvCell(value: unknown): string {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

function downloadAuditCsv(entries: ReadonlyArray<BackofficeAuditLogEntry>) {
  const header = [
    'Quando',
    'Ação',
    'Entidade',
    'ID da entidade',
    'Ator',
    'Email do ator',
    'Alvo',
    'Detalhes',
  ]
  const rows = entries.map((entry) =>
    [
      entry.createdAt,
      entry.action,
      entry.entityType,
      entry.entityId ?? '',
      entry.actorUser?.name ?? 'Sistema',
      entry.actorUser?.email ?? '',
      entry.targetUser?.name ?? '',
      entry.details ? JSON.stringify(entry.details) : '',
    ]
      .map(csvCell)
      .join(','),
  )
  const csv = [header.map(csvCell).join(','), ...rows].join('\r\n')
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
  const [limit, setLimit] = useState(PAGE_SIZE)
  const deferredSearch = useDeferredValue(search.trim())

  const query = useBackofficeAuditLogData({
    search: deferredSearch || undefined,
    limit,
  })

  const entries = query.data?.data ?? []
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
        <ConsoleSearch
          value={search}
          onChange={setSearch}
          placeholder="Buscar por ação, tipo de entidade ou ID…"
        />

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
            description="Ajuste a busca para ver outros eventos da trilha de auditoria."
          />
        ) : (
          <>
            <div className="overflow-hidden rounded-xl shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              <div className="divide-y">
                {entries.map((entry) => (
                  <AuditRow key={entry.id} entry={entry} />
                ))}
              </div>
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
        <StatusChip tone={actionTone(entry.action)}>{entry.action}</StatusChip>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {entry.entityType}
          {entry.entityId ? ` · ${entry.entityId}` : ''}
          {target ? ` → ${target.name}` : ''}
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
