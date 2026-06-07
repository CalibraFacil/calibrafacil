import { Link } from '@tanstack/react-router'
import { Fragment, type ReactNode } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkCircle02Icon,
  DistributionIcon,
  Edit02Icon,
  FunctionIcon,
  RefreshIcon,
  TaskDone01Icon,
  TextFontIcon,
  Tick02Icon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import {
  useMethodAuditLogData,
  useMethodDetailData,
} from '@/features/methods/queries'
import type { MethodDetail } from '@/features/methods/types'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { RoleGate } from '@/components/permission-gate'
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  Panel,
  PanelHeader,
  SignalTile,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { cn } from '@/lib/utils'

type VoidMethodMutation = { mutate: () => void; isPending: boolean }
type ReturnToDraftMutation = {
  mutate: (reason: string) => void
  isPending: boolean
}

const statusLabels: Record<string, string> = {
  DRAFT: 'Rascunho',
  PENDING_APPROVAL: 'Em aprovação',
  TECHNICAL_REVIEWED: 'Revisão técnica',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Arquivado',
}

const statusVariants: Record<string, 'default' | 'secondary' | 'outline'> = {
  DRAFT: 'secondary',
  PENDING_APPROVAL: 'outline',
  TECHNICAL_REVIEWED: 'outline',
  PUBLISHED: 'default',
  ARCHIVED: 'outline',
}

const LIFECYCLE = [
  { key: 'DRAFT', label: 'Rascunho' },
  { key: 'PENDING_APPROVAL', label: 'Em aprovação' },
  { key: 'TECHNICAL_REVIEWED', label: 'Revisão técnica' },
  { key: 'PUBLISHED', label: 'Publicado' },
] as const

function getStatusLabel(status: string) {
  return statusLabels[status] ?? status
}

function getStatusVariant(status: string) {
  return statusVariants[status] ?? 'outline'
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function hasCertificateContent(method: MethodDetail): boolean {
  const content = method.certificateContent
  if (!content) return false
  return Boolean(
    (content.procedureCode ?? '').trim() ||
    (content.referenceStandards?.length ?? 0) > 0 ||
    (content.sections?.length ?? 0) > 0,
  )
}

/** Horizontal approval-lifecycle stepper — governance at a glance. */
function LifecycleStepper({ status }: { status: string }) {
  const archived = status === 'ARCHIVED'
  const currentIndex = archived
    ? LIFECYCLE.length - 1
    : LIFECYCLE.findIndex((stage) => stage.key === status)

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {LIFECYCLE.map((stage, index) => {
        const done = index < currentIndex
        const active = index === currentIndex && !archived
        const isLast = index === LIFECYCLE.length - 1
        return (
          <Fragment key={stage.key}>
            <div className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums',
                  done
                    ? 'bg-primary text-primary-foreground'
                    : active
                      ? 'bg-primary text-primary-foreground ring-4 ring-primary/15'
                      : 'bg-muted text-muted-foreground ring-1 ring-inset ring-foreground/15',
                )}
              >
                {done ? (
                  <HugeiconsIcon
                    icon={Tick02Icon}
                    className="size-3"
                    strokeWidth={2.5}
                    aria-hidden
                  />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  'hidden text-xs whitespace-nowrap sm:inline',
                  active
                    ? 'font-medium text-foreground'
                    : done
                      ? 'text-foreground/70'
                      : 'text-muted-foreground',
                )}
              >
                {stage.label}
              </span>
            </div>
            {!isLast && (
              <span
                aria-hidden
                className={cn(
                  'h-px w-5 shrink-0 sm:w-8',
                  index < currentIndex ? 'bg-primary' : 'bg-foreground/15',
                )}
              />
            )}
          </Fragment>
        )
      })}
      {archived && (
        <Badge variant="outline" className="ml-2 shrink-0">
          Arquivado
        </Badge>
      )}
    </div>
  )
}

export function MethodDetailPage({ id }: { id: string }) {
  const queryClient = useQueryClient()

  const { data: method, isLoading, error } = useMethodDetailData(id)
  const { data: auditLogData } = useMethodAuditLogData(id)

  const technicalReviewMutation = useMutation({
    mutationFn: async () =>
      calibraApi.methods.technicalReview(method?.id ?? id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Revisão técnica registrada')
    },
    onError: (error) => toast.error(error.message),
  })

  const qualityApproveMutation = useMutation({
    mutationFn: async () => {
      if (!method) throw new Error('Método não carregado')
      return calibraApi.methods.qualityApprove(method.id ?? id, {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método aprovado e publicado')
    },
    onError: (error) => toast.error(error.message),
  })

  const returnToDraftMutation = useMutation({
    mutationFn: async (reason: string) =>
      calibraApi.methods.returnToDraft(method?.id ?? id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método retornou para rascunho')
    },
    onError: (error) => toast.error(error.message),
  })

  if (isLoading) {
    return <MethodDetailSkeleton />
  }

  if (error || !method) {
    return (
      <Panel className="p-8 text-center">
        <p className="text-sm text-destructive">
          {error
            ? `Erro ao carregar método: ${error.message}`
            : 'Método não encontrado.'}
        </p>
      </Panel>
    )
  }

  const auditEvents = auditLogData?.data?.length
    ? buildAuditTimelineEvents(auditLogData.data)
    : []
  const hasEvidence = Boolean(
    method.methodFingerprint || method.publicationEvidence,
  )

  return (
    <div className="space-y-6">
      {/* Hero — identity, lifecycle, key counts, workflow actions */}
      <Panel className="relative overflow-hidden">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Método de calibração
                {method.assetTypeName ? ` · ${method.assetTypeName}` : ''}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {method.name}
                </h1>
                <span className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs font-medium tabular-nums text-muted-foreground">
                  v{method.version}
                </span>
                <Badge variant={getStatusVariant(method.status)}>
                  {getStatusLabel(method.status)}
                </Badge>
              </div>
              {method.description ? (
                <p className="mt-1 max-w-3xl text-pretty text-sm leading-6 text-muted-foreground">
                  {method.description}
                </p>
              ) : null}
            </div>

            <MethodActions
              method={method}
              id={id}
              technicalReviewMutation={technicalReviewMutation}
              qualityApproveMutation={qualityApproveMutation}
              returnToDraftMutation={returnToDraftMutation}
            />
          </div>

          <div className="border-t border-foreground/10 pt-4">
            <LifecycleStepper status={method.status} />
          </div>

          <StaggerGroup className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            <StaggerItem>
              <SignalTile
                icon={TextFontIcon}
                label="Campos"
                value={String(method.dataFields.length)}
                hint="entradas"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={FunctionIcon}
                label="Fórmulas"
                value={String(method.formulas.length)}
                hint="cálculos"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={TaskDone01Icon}
                label="Critérios"
                value={String(method.validations.length)}
                hint="aceitação"
                tone="neutral"
              />
            </StaggerItem>
            <StaggerItem>
              <SignalTile
                icon={DistributionIcon}
                label="Incerteza B"
                value={String(method.uncertaintyParams.length)}
                hint="componentes"
                tone="neutral"
              />
            </StaggerItem>
          </StaggerGroup>
        </div>
      </Panel>

      <div className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-w-0 space-y-6">
          {/* Specification — fields / formulas / criteria / uncertainty */}
          <Panel className="divide-y divide-foreground/10">
            <SpecBlock
              eyebrow="Campos de entrada"
              count={method.dataFields.length}
            >
              {method.dataFields.length === 0 ? (
                <EmptyNote>Nenhum campo de entrada definido.</EmptyNote>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {method.dataFields.map((field) => (
                    <div
                      key={field.key}
                      className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {field.label}
                        </span>
                        <Badge variant="outline" className="shrink-0">
                          {field.type}
                        </Badge>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {field.key}
                        </span>
                        {field.unit ? (
                          <Badge variant="secondary">{field.unit}</Badge>
                        ) : null}
                        {field.required ? (
                          <span className="text-[11px] font-medium text-destructive">
                            obrigatório
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SpecBlock>

            <SpecBlock eyebrow="Fórmulas" count={method.formulas.length}>
              {method.formulas.length === 0 ? (
                <EmptyNote>Nenhuma fórmula definida.</EmptyNote>
              ) : (
                <div className="space-y-2.5">
                  {method.formulas.map((formula) => (
                    <div
                      key={formula.outputKey}
                      className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">
                          {formula.label || formula.outputKey}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formula.outputKey}
                        </span>
                        {formula.unit ? (
                          <Badge variant="secondary">{formula.unit}</Badge>
                        ) : null}
                        {formula.reporting?.role ? (
                          <Badge variant="outline">
                            {formula.reporting.role}
                          </Badge>
                        ) : null}
                      </div>
                      <code className="mt-2 block max-w-full overflow-x-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed">
                        {formula.expression}
                      </code>
                    </div>
                  ))}
                </div>
              )}
            </SpecBlock>

            <SpecBlock
              eyebrow="Critérios de aceitação"
              count={method.validations.length}
            >
              {method.validations.length === 0 ? (
                <EmptyNote>Nenhum critério definido.</EmptyNote>
              ) : (
                <div className="space-y-2.5">
                  {method.validations.map((validation, index) => (
                    <div
                      key={`${validation.leftExpression}-${validation.operator}-${validation.rightExpression}-${index}`}
                      className="rounded-xl bg-background p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.08)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <code className="min-w-0 flex-1 overflow-x-auto rounded-md bg-muted/50 px-2.5 py-2 font-mono text-xs leading-relaxed">
                          {validation.leftExpression} {validation.operator}{' '}
                          {validation.rightExpression}
                        </code>
                        <Badge
                          variant={
                            validation.severity === 'error'
                              ? 'destructive'
                              : 'outline'
                          }
                          className="shrink-0"
                        >
                          {validation.severity === 'error' ? 'Erro' : 'Aviso'}
                        </Badge>
                      </div>
                      {validation.message ? (
                        <p className="mt-1.5 text-pretty text-sm text-muted-foreground">
                          {validation.message}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </SpecBlock>

            {method.uncertaintyParams.length > 0 ? (
              <SpecBlock
                eyebrow="Componentes de incerteza (tipo B)"
                count={method.uncertaintyParams.length}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {method.uncertaintyParams.map((component) => (
                    <div
                      key={component.name}
                      className="rounded-xl bg-muted/40 p-3 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.07)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-sm font-medium">
                          {component.name}
                        </span>
                        <span className="shrink-0 font-mono text-sm tabular-nums">
                          {component.value}
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {component.distribution}
                        </Badge>
                        {component.degreesOfFreedom ? (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            veff {component.degreesOfFreedom}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </SpecBlock>
            ) : null}
          </Panel>

          {hasCertificateContent(method) ? (
            <Panel className="p-4 sm:p-5">
              <PanelHeader
                eyebrow="Saída"
                title="Conteúdo do certificado"
                description="Textos e blocos que acompanham os certificados gerados."
              />
              <BlueprintGrid className="mt-4 sm:grid-cols-2">
                {method.certificateContent?.procedureCode ? (
                  <BlueprintField label="Procedimento" mono>
                    {method.certificateContent.procedureCode}
                  </BlueprintField>
                ) : null}
                {(method.certificateContent?.referenceStandards?.length ?? 0) >
                0 ? (
                  <BlueprintField label="Normas de referência">
                    {method.certificateContent?.referenceStandards?.join(', ')}
                  </BlueprintField>
                ) : null}
                {(method.certificateContent?.sections?.length ?? 0) > 0 ? (
                  <BlueprintField label="Blocos de texto">
                    {method.certificateContent?.sections?.length} seç
                    {(method.certificateContent?.sections?.length ?? 0) === 1
                      ? 'ão'
                      : 'ões'}
                  </BlueprintField>
                ) : null}
              </BlueprintGrid>
            </Panel>
          ) : null}
        </main>

        <aside className="min-w-0 space-y-6">
          <Panel className="p-4 sm:p-5">
            <PanelHeader eyebrow="Governança" title="Responsáveis e datas" />
            <BlueprintGrid className="mt-4">
              <BlueprintField label="Criado por">
                {method.createdByName || '—'}
              </BlueprintField>
              <BlueprintField label="Criado em" mono>
                {formatDateTime(method.createdAt)}
              </BlueprintField>
              <BlueprintField label="Revisão técnica">
                {method.technicalReviewedByName || '—'}
              </BlueprintField>
              <BlueprintField label="Aprovação (qualidade)">
                {method.approvedByName || '—'}
              </BlueprintField>
              <BlueprintField label="Publicado em" mono>
                {formatDateTime(method.publishedAt)}
              </BlueprintField>
              {method.archivedAt ? (
                <BlueprintField label="Arquivado em" mono>
                  {formatDateTime(method.archivedAt)}
                </BlueprintField>
              ) : null}
            </BlueprintGrid>
          </Panel>

          {hasEvidence ? (
            <Panel className="p-4 sm:p-5">
              <Accordion>
                <AccordionItem value="evidence">
                  <AccordionTrigger className="min-h-9 py-0 hover:no-underline">
                    <div className="min-w-0 text-left">
                      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Técnico
                      </p>
                      <h2 className="text-sm font-semibold">
                        Evidência de publicação
                      </h2>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="pt-4">
                    <BlueprintGrid>
                      <BlueprintField label="Method fingerprint" mono>
                        {method.methodFingerprint || '—'}
                      </BlueprintField>
                      <BlueprintField label="Publication fingerprint" mono>
                        {method.publicationEvidence?.publicationFingerprint ||
                          '—'}
                      </BlueprintField>
                      <BlueprintField label="Engine" mono>
                        {method.methodEngine?.version ||
                          method.publicationEvidence?.engineVersion ||
                          '—'}
                      </BlueprintField>
                      <BlueprintField label="Compilado em" mono>
                        {formatDateTime(
                          method.methodCompiledAt ||
                            method.publicationEvidence?.compiledAt,
                        )}
                      </BlueprintField>
                      <BlueprintField label="Previews / diagnósticos" mono>
                        {method.publicationEvidence?.previewResults?.length ??
                          0}
                        {' / '}
                        {method.publicationEvidence?.diagnostics?.length ?? 0}
                      </BlueprintField>
                    </BlueprintGrid>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </Panel>
          ) : null}

          {auditEvents.length > 0 ? (
            <Panel className="p-4 sm:p-5">
              <PanelHeader eyebrow="Atividade" title="Histórico" />
              <div className="mt-4">
                <AuditTimeline events={auditEvents} showCard={false} />
              </div>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  )
}

function MethodActions({
  method,
  id,
  technicalReviewMutation,
  qualityApproveMutation,
  returnToDraftMutation,
}: {
  method: MethodDetail
  id: string
  technicalReviewMutation: VoidMethodMutation
  qualityApproveMutation: VoidMethodMutation
  returnToDraftMutation: ReturnToDraftMutation
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {method.status === 'DRAFT' && (
        <Button
          variant="outline"
          render={<Link to="/dashboard/methods/$id/edit" params={{ id }} />}
          className={ACTION_BUTTON_CLASS}
        >
          <HugeiconsIcon icon={Edit02Icon} className="mr-2 size-4" />
          Editar
        </Button>
      )}

      <RoleGate roles={['admin']}>
        {method.status === 'PENDING_APPROVAL' && (
          <Button
            onClick={() => technicalReviewMutation.mutate()}
            disabled={technicalReviewMutation.isPending}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 size-4"
            />
            {technicalReviewMutation.isPending
              ? 'Revisando…'
              : 'Revisar tecnicamente'}
          </Button>
        )}
      </RoleGate>

      <RoleGate roles={['owner']}>
        {method.status === 'TECHNICAL_REVIEWED' && (
          <Button
            onClick={() => qualityApproveMutation.mutate()}
            disabled={qualityApproveMutation.isPending}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 size-4"
            />
            {qualityApproveMutation.isPending
              ? 'Aprovando…'
              : 'Aprovar qualidade'}
          </Button>
        )}
      </RoleGate>

      <RoleGate roles={['admin', 'owner']}>
        {(method.status === 'PENDING_APPROVAL' ||
          method.status === 'TECHNICAL_REVIEWED') && (
          <Button
            variant="outline"
            onClick={() => {
              if (
                !window.confirm('Deseja retornar este método para rascunho?')
              ) {
                return
              }
              const reason = window.prompt(
                'Informe o motivo para retornar ao rascunho',
              )
              if (!reason || reason.trim().length < 3) {
                toast.error('Motivo obrigatório (mín. 3 caracteres)')
                return
              }
              returnToDraftMutation.mutate(reason.trim())
            }}
            disabled={returnToDraftMutation.isPending}
            className={ACTION_BUTTON_CLASS}
          >
            <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
            {returnToDraftMutation.isPending
              ? 'Retornando…'
              : 'Retornar para rascunho'}
          </Button>
        )}
      </RoleGate>
    </div>
  )
}

function SpecBlock({
  eyebrow,
  count,
  children,
}: {
  eyebrow: string
  count?: number
  children: ReactNode
}) {
  return (
    <section className="p-4 sm:p-5">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          {eyebrow}
        </p>
        {count !== undefined ? (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {count}
          </span>
        ) : null}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

function EmptyNote({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>
}

function MethodDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Panel className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-7 w-80 max-w-full" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
        <Skeleton className="mt-5 h-6 w-full max-w-md" />
        <div className="mt-5 grid gap-3 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
          {Array.from({ length: 4 }).map((_item, index) => (
            <Skeleton key={index} className="h-[88px] rounded-xl" />
          ))}
        </div>
      </Panel>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  )
}
