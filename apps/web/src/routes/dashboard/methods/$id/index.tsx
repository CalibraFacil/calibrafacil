import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  Edit02Icon,
  RefreshIcon,
} from '@hugeicons/core-free-icons'
import { toast } from 'sonner'
import type { MethodData } from '@/components/method-runtime/types'

import { calibraApi } from '@/utils/api'
import {
  AuditTimeline,
  buildAuditTimelineEvents,
  type AuditLogRecord,
} from '@/components/audit-timeline'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { RoleGate } from '@/components/permission-gate'
import { cn } from '@/lib/utils'

export const Route = createFileRoute('/dashboard/methods/$id/')({
  head: () => ({
    meta: [{ title: 'Detalhes do Método | CalibraFacil' }],
  }),
  component: MethodDetailPage,
})

type MethodDetail = MethodData & {
  assetTypeName?: string
  createdByName?: string
  createdAt: string
  technicalReviewedByName?: string | null
  approvedByName?: string | null
  publishedAt?: string
  archivedAt?: string
}

type VoidMethodMutation = {
  mutate: () => void
  isPending: boolean
}

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

function getStatusLabel(status: string) {
  return statusLabels[status] ?? status
}

function getStatusVariant(status: string) {
  return statusVariants[status] ?? 'outline'
}

function formatDateTime(date: string | null | undefined): string {
  if (!date) return '-'

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

function MethodDetailPage() {
  const { id } = Route.useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const {
    data: method,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['methods', id],
    queryFn: async () => {
      return calibraApi.methods.get(id) as Promise<MethodDetail>
    },
  })

  const { data: auditLogData } = useQuery({
    queryKey: ['methods', id, 'audit'],
    queryFn: async () => {
      return calibraApi.methods.audit<AuditLogRecord>(id)
    },
  })

  const technicalReviewMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.methods.technicalReview(method?.id ?? id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Revisão técnica registrada')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const qualityApproveMutation = useMutation({
    mutationFn: async () => {
      if (!method) throw new Error('Método não carregado')
      return calibraApi.methods.qualityApprove(method.id, {})
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método aprovado e publicado')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const returnToDraftMutation = useMutation({
    mutationFn: async (reason: string) => {
      return calibraApi.methods.returnToDraft(method?.id ?? id, reason)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['methods', id] })
      queryClient.invalidateQueries({ queryKey: ['methods'] })
      toast.success('Método retornou para rascunho')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  if (error) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/methods' })}
          className="-ml-2 active:scale-[0.96] transition-transform"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
        <div className="rounded-lg bg-destructive/5 px-6 py-8 text-center text-sm text-destructive shadow-[inset_0_0_0_1px_rgba(220,38,38,0.18)]">
          Erro ao carregar método: {error.message}
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
          <div className="flex items-start gap-4">
            <Skeleton className="size-9 rounded-md" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-72" />
              <Skeleton className="h-4 w-96 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-3 py-3">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-6 w-36" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-8">
            {Array.from({ length: 3 }).map((_, sectionIndex) => (
              <div key={sectionIndex} className="space-y-4">
                <Skeleton className="h-5 w-44" />
                <div className="border-t border-border/70">
                  {Array.from({ length: 4 }).map((_, rowIndex) => (
                    <div key={rowIndex} className="space-y-2 border-b py-4">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-5 w-3/4" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="space-y-8 lg:border-l lg:pl-8">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-40 w-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!method) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/methods' })}
          className="-ml-2 active:scale-[0.96] transition-transform"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar
        </Button>
        <div className="rounded-lg bg-muted/35 px-6 py-8 text-center text-sm text-muted-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          Método não encontrado.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 sm:flex sm:items-start sm:justify-between sm:gap-4 sm:space-y-0">
        <div className="flex items-start gap-3 sm:gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate({ to: '/dashboard/methods' })}
            className="mt-0.5 active:scale-[0.96]"
            aria-label="Voltar para métodos"
          >
            <HugeiconsIcon icon={ArrowLeft01Icon} className="size-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="space-y-3">
              <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
                <h1 className="text-balance text-2xl font-semibold tracking-tight">
                  {method.name}
                </h1>
                <Badge variant={getStatusVariant(method.status)}>
                  {getStatusLabel(method.status)}
                </Badge>
              </div>
              <p className="max-w-5xl text-pretty text-sm leading-6 text-muted-foreground">
                {method.description || 'Sem descrição'}
              </p>
            </div>
          </div>
        </div>

        <MethodActions
          method={method}
          id={id}
          technicalReviewMutation={technicalReviewMutation}
          qualityApproveMutation={qualityApproveMutation}
          returnToDraftMutation={returnToDraftMutation}
          className="hidden sm:flex"
        />
      </div>

      <MethodActions
        method={method}
        id={id}
        technicalReviewMutation={technicalReviewMutation}
        qualityApproveMutation={qualityApproveMutation}
        returnToDraftMutation={returnToDraftMutation}
        className="flex sm:hidden"
        mobile
      />

      <dl className="grid overflow-hidden rounded-lg bg-muted/35 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)] sm:grid-cols-2 xl:grid-cols-4 dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
        <SummaryItem
          label="Versão"
          value={`v${method.version}`}
          detail="Controle de revisão"
          className="border-b border-border/70 sm:border-r xl:border-b-0"
          mono
        />
        <SummaryItem
          label="Tipo de instrumento"
          value={method.assetTypeName || '-'}
          detail="Aplicação técnica"
          className="border-b border-border/70 xl:border-r xl:border-b-0"
        />
        <SummaryItem
          label="Campos"
          value={method.dataFields.length}
          detail="Entradas do executor"
          className="border-b border-border/70 sm:border-r sm:border-b-0"
          numeric
        />
        <SummaryItem
          label="Fórmulas"
          value={method.formulas.length}
          detail={`${method.validations.length} critérios`}
          numeric
        />
      </dl>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-10">
          {hasCertificateContent(method) && (
            <DetailSection
              title="Conteúdo do certificado"
              description="Textos e blocos que acompanham os certificados gerados por este método."
            >
              <div className="border-t border-border/70">
                {method.certificateContent?.procedureCode ? (
                  <DetailItem
                    label="Procedimento"
                    value={method.certificateContent.procedureCode}
                    mono
                  />
                ) : null}

                {(method.certificateContent?.referenceStandards?.length ?? 0) >
                0 ? (
                  <DetailItem
                    label="Normas de referência"
                    value={method.certificateContent?.referenceStandards?.join(
                      ', ',
                    )}
                  />
                ) : null}

                {method.certificateContent?.sections?.map((section, index) => (
                  <DetailItem
                    key={`${section.kind}-${index}`}
                    label={
                      'title' in section && section.title
                        ? section.title
                        : 'Notas'
                    }
                  >
                    <Badge variant="outline">{section.kind}</Badge>
                  </DetailItem>
                ))}
              </div>
            </DetailSection>
          )}

          <DetailSection
            title={`Campos de entrada (${method.dataFields.length})`}
            description="Dados solicitados durante a execução da calibração."
          >
            {method.dataFields.length === 0 ? (
              <EmptyLine>Nenhum campo de entrada definido.</EmptyLine>
            ) : (
              <div className="border-t border-border/70">
                {method.dataFields.map((field) => (
                  <DetailItem key={field.key} label={field.label}>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {field.key}
                      </span>
                      <Badge variant="outline">{field.type}</Badge>
                      {field.unit ? (
                        <Badge variant="secondary">{field.unit}</Badge>
                      ) : null}
                      {field.required ? (
                        <span className="text-xs font-medium text-destructive">
                          obrigatório
                        </span>
                      ) : null}
                    </div>
                  </DetailItem>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection
            title={`Fórmulas (${method.formulas.length})`}
            description="Cálculos derivados dos campos de entrada e das constantes do método."
          >
            {method.formulas.length === 0 ? (
              <EmptyLine>Nenhuma fórmula definida.</EmptyLine>
            ) : (
              <div className="border-t border-border/70">
                {method.formulas.map((formula) => (
                  <DetailItem
                    key={formula.outputKey}
                    label={formula.label || formula.outputKey}
                  >
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
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
                      <code className="block max-w-full overflow-x-auto rounded-md bg-muted/45 px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]">
                        {formula.expression}
                      </code>
                    </div>
                  </DetailItem>
                ))}
              </div>
            )}
          </DetailSection>

          <DetailSection
            title={`Critérios de aceitação (${method.validations.length})`}
            description="Regras de conformidade avaliadas ao finalizar a calibração."
          >
            {method.validations.length === 0 ? (
              <EmptyLine>Nenhum critério definido.</EmptyLine>
            ) : (
              <div className="border-t border-border/70">
                {method.validations.map((validation, index) => (
                  <DetailItem
                    key={`${validation.leftExpression}-${validation.operator}-${validation.rightExpression}-${index}`}
                    label={validation.severity === 'error' ? 'Erro' : 'Aviso'}
                  >
                    <div className="space-y-2">
                      <code className="block max-w-full overflow-x-auto rounded-md bg-muted/45 px-2.5 py-2 font-mono text-xs leading-relaxed text-foreground shadow-[inset_0_0_0_1px_rgba(0,0,0,0.05)]">
                        {validation.leftExpression} {validation.operator}{' '}
                        {validation.rightExpression}
                      </code>
                      <p className="text-pretty text-sm text-muted-foreground">
                        {validation.message}
                      </p>
                    </div>
                  </DetailItem>
                ))}
              </div>
            )}
          </DetailSection>

          {method.uncertaintyParams.length > 0 && (
            <DetailSection
              title={`Componentes tipo B (${method.uncertaintyParams.length})`}
              description="Parâmetros de incerteza cadastrados como constantes do método."
            >
              <div className="border-t border-border/70">
                {method.uncertaintyParams.map((component) => (
                  <DetailItem key={component.name} label={component.name}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono tabular-nums">
                        {component.value}
                      </span>
                      <Badge variant="outline">{component.distribution}</Badge>
                      {component.degreesOfFreedom ? (
                        <span className="text-xs text-muted-foreground">
                          veff {component.degreesOfFreedom}
                        </span>
                      ) : null}
                    </div>
                  </DetailItem>
                ))}
              </div>
            </DetailSection>
          )}
        </div>

        <aside className="space-y-10 lg:border-l lg:border-border/70 lg:pl-8">
          <DetailSection title="Governança">
            <dl className="border-t border-border/70">
              <DetailItem label="Status">
                <Badge variant={getStatusVariant(method.status)}>
                  {getStatusLabel(method.status)}
                </Badge>
              </DetailItem>
              <DetailItem label="Versão" value={`v${method.version}`} mono />
              <DetailItem
                label="Tipo de instrumento"
                value={method.assetTypeName || '-'}
              />
            </dl>
          </DetailSection>

          <DetailSection
            title="Evidência compilada"
            description="Artefato usado para publicação e execução rastreável."
          >
            <dl className="border-t border-border/70">
              <DetailItem
                label="Method fingerprint"
                value={method.methodFingerprint || '-'}
                mono
              />
              <DetailItem
                label="Publication fingerprint"
                value={
                  method.publicationEvidence?.publicationFingerprint || '-'
                }
                mono
              />
              <DetailItem
                label="Engine"
                value={
                  method.methodEngine?.version ||
                  method.publicationEvidence?.engineVersion ||
                  '-'
                }
                mono
              />
              <DetailItem
                label="Engine options"
                value={
                  method.methodEngine?.optionsFingerprint ||
                  method.publicationEvidence?.engineOptionsFingerprint ||
                  '-'
                }
                mono
              />
              <DetailItem
                label="Compilado em"
                value={formatDateTime(
                  method.methodCompiledAt ||
                    method.publicationEvidence?.compiledAt,
                )}
                mono
              />
              <DetailItem
                label="Previews"
                value={String(
                  method.publicationEvidence?.previewResults?.length ?? 0,
                )}
                mono
              />
              <DetailItem
                label="Diagnósticos"
                value={String(
                  method.publicationEvidence?.diagnostics?.length ?? 0,
                )}
                mono
              />
            </dl>
          </DetailSection>

          <DetailSection title="Responsáveis">
            <dl className="border-t border-border/70">
              <DetailItem
                label="Criado por"
                value={method.createdByName || '-'}
              />
              <DetailItem
                label="Revisado tecnicamente por"
                value={method.technicalReviewedByName || '-'}
              />
              <DetailItem
                label="Aprovado por (Qualidade)"
                value={method.approvedByName || '-'}
              />
            </dl>
          </DetailSection>

          <DetailSection title="Datas">
            <dl className="border-t border-border/70">
              <DetailItem
                label="Criado em"
                value={formatDateTime(method.createdAt)}
                mono
              />
              <DetailItem
                label="Publicado em"
                value={formatDateTime(method.publishedAt)}
                mono
              />
              {method.archivedAt ? (
                <DetailItem
                  label="Arquivado em"
                  value={formatDateTime(method.archivedAt)}
                  mono
                />
              ) : null}
            </dl>
          </DetailSection>
        </aside>
      </div>

      {auditLogData?.data && auditLogData.data.length > 0 && (
        <DetailSection
          title="Histórico de alterações"
          description="Registros de controle para rastreabilidade ISO 17025."
        >
          <div className="border-t border-border/70 pt-4">
            <AuditTimeline
              events={buildAuditTimelineEvents(auditLogData.data)}
              title="Histórico de Alterações (ISO 17025)"
              showCard={false}
            />
          </div>
        </DetailSection>
      )}
    </div>
  )
}

function MethodActions({
  method,
  id,
  technicalReviewMutation,
  qualityApproveMutation,
  returnToDraftMutation,
  className,
  mobile = false,
}: {
  method: MethodDetail
  id: string
  technicalReviewMutation: VoidMethodMutation
  qualityApproveMutation: VoidMethodMutation
  returnToDraftMutation: ReturnToDraftMutation
  className?: string
  mobile?: boolean
}) {
  return (
    <div
      className={cn(
        'items-center gap-2',
        mobile && 'flex-col items-stretch',
        className,
      )}
    >
      {method.status === 'DRAFT' && (
        <Button
          variant="outline"
          render={<Link to="/dashboard/methods/$id/edit" params={{ id }} />}
          className={cn('active:scale-[0.96]', mobile && 'w-full')}
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
            className={cn('active:scale-[0.96]', mobile && 'w-full')}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 size-4"
            />
            {technicalReviewMutation.isPending
              ? 'Revisando...'
              : 'Revisar tecnicamente'}
          </Button>
        )}
      </RoleGate>

      <RoleGate roles={['owner']}>
        {method.status === 'TECHNICAL_REVIEWED' && (
          <Button
            onClick={() => qualityApproveMutation.mutate()}
            disabled={qualityApproveMutation.isPending}
            className={cn('active:scale-[0.96]', mobile && 'w-full')}
          >
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="mr-2 size-4"
            />
            {qualityApproveMutation.isPending
              ? 'Aprovando...'
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
            className={cn('active:scale-[0.96]', mobile && 'w-full')}
          >
            <HugeiconsIcon icon={RefreshIcon} className="mr-2 size-4" />
            {returnToDraftMutation.isPending
              ? 'Retornando...'
              : 'Retornar para rascunho'}
          </Button>
        )}
      </RoleGate>
    </div>
  )
}

function SummaryItem({
  label,
  value,
  detail,
  className,
  mono = false,
  numeric = false,
}: {
  label: string
  value: ReactNode
  detail?: string
  className?: string
  mono?: boolean
  numeric?: boolean
}) {
  return (
    <div className={cn('min-w-0 px-5 py-4', className)}>
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-2 min-w-0 truncate text-base font-medium',
          mono && 'font-mono tabular-nums',
          numeric && 'tabular-nums',
        )}
      >
        {value}
      </dd>
      {detail ? (
        <dd className="mt-1 text-pretty text-xs text-muted-foreground">
          {detail}
        </dd>
      ) : null}
    </div>
  )
}

function DetailSection({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cn('space-y-4', className)}>
      <div className="max-w-4xl">
        <h2 className="text-balance text-base font-medium">{title}</h2>
        {description ? (
          <p className="mt-1 text-pretty text-sm text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

function DetailItem({
  label,
  value,
  mono = false,
  children,
}: {
  label: string
  value?: ReactNode
  mono?: boolean
  children?: ReactNode
}) {
  return (
    <div className="min-w-0 border-b border-border/70 py-4">
      <dt className="text-sm font-medium text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          'mt-1 min-w-0 text-sm text-foreground',
          mono && 'font-mono tabular-nums',
        )}
      >
        {children ?? value ?? '-'}
      </dd>
    </div>
  )
}

function EmptyLine({ children }: { children: ReactNode }) {
  return (
    <p className="border-t border-border/70 py-4 text-sm text-muted-foreground">
      {children}
    </p>
  )
}
