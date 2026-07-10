import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import type { OotNotificationData } from '@calibra-facil/client-runtime'

import { calibraApi } from '@/utils/api'
import {
  useNonConformanceAuditLogData,
  useNonConformanceDetailData,
  useNonConformanceOotNotificationData,
} from '@/features/quality/queries'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { BlueprintOverlay, Panel } from '@/components/instrument-panel'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  CloudOnlyOfflineState,
  useDesktopCloudOnlyUnavailable,
} from '@/runtime/sync-status'

function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return '-'
  return new Date(dateString).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'work':
      return 'Trabalho'
    case 'equipment':
      return 'Equipamento'
    case 'documentation':
      return 'Documentacao'
    case 'out_of_tolerance':
      return 'Fora de tolerância'
    default:
      return type
  }
}

function getOotStatusBadge(status: OotNotificationData['status']) {
  switch (status) {
    case 'ACKNOWLEDGED':
      return { variant: 'default' as const, label: 'Confirmada' }
    case 'SENT':
      return { variant: 'secondary' as const, label: 'Enviada' }
    case 'GENERATED':
    case 'PENDING':
    default:
      return { variant: 'outline' as const, label: 'Gerada' }
  }
}

function getAcknowledgedViaLabel(
  via: NonNullable<OotNotificationData['acknowledgedVia']>,
): string {
  switch (via) {
    case 'email_link':
      return 'link do e-mail'
    case 'portal_link':
      return 'portal'
    case 'manual':
      return 'registro manual'
    default:
      return via
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case 'open':
      return { variant: 'destructive' as const, label: 'Aberta' }
    case 'under_review':
      return { variant: 'outline' as const, label: 'Em Analise' }
    case 'resolved':
      return { variant: 'default' as const, label: 'Resolvida' }
    default:
      return { variant: 'secondary' as const, label: status }
  }
}

function getDispositionLabel(disposition: string | null): string {
  if (!disposition) return 'Pendente'
  switch (disposition) {
    case 'rework':
      return 'Retrabalho'
    case 'scrap':
      return 'Sucata'
    case 'use_as_is':
      return 'Uso como esta'
    case 'concession':
      return 'Concessao'
    default:
      return disposition
  }
}

export function NCDetailPage({ id }: { id: string }) {
  const queryClient = useQueryClient()
  const cloudOnlyUnavailable = useDesktopCloudOnlyUnavailable()
  const [dispositionDialogOpen, setDispositionDialogOpen] = useState(false)
  const [resolveDialogOpen, setResolveDialogOpen] = useState(false)
  const [capaDialogOpen, setCapaDialogOpen] = useState(false)
  const [ootAckDialogOpen, setOotAckDialogOpen] = useState(false)

  const {
    data: nc,
    isLoading,
    error,
  } = useNonConformanceDetailData({
    id,
    enabled: !cloudOnlyUnavailable,
  })

  const { data: auditLog } = useNonConformanceAuditLogData({
    id,
    enabled: !cloudOnlyUnavailable,
  })

  const { data: ootNotificationResponse } =
    useNonConformanceOotNotificationData({
      id,
      enabled: !cloudOnlyUnavailable && nc?.type === 'out_of_tolerance',
    })
  const ootNotification = ootNotificationResponse?.data ?? null

  // Disposition mutation
  const dispositionMutation = useMutation({
    mutationFn: async (data: { disposition: string; justification?: string }) =>
      calibraApi.nonConformances.setDisposition(id, {
        // oxlint-disable-next-line typescript/consistent-type-assertions -- Form submit validates disposition from fixed UI choices.
        ...(data as {
          disposition: 'rework' | 'scrap' | 'use_as_is' | 'concession'
          justification?: string
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['non-conformance', id] })
      queryClient.invalidateQueries({ queryKey: ['non-conformance-audit', id] })
      queryClient.invalidateQueries({ queryKey: ['non-conformances'] })
      toast.success('Disposicao definida com sucesso')
      setDispositionDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  // Resolve mutation
  const resolveMutation = useMutation({
    mutationFn: async (data: { correctionTaken: string }) => {
      return calibraApi.nonConformances.resolve(id, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['non-conformance', id] })
      queryClient.invalidateQueries({ queryKey: ['non-conformance-audit', id] })
      queryClient.invalidateQueries({ queryKey: ['non-conformances'] })
      toast.success('NC resolvida com sucesso')
      setResolveDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  // §7.10 acknowledgement mutation
  const ootAckMutation = useMutation({
    mutationFn: async (data: { note: string }) =>
      calibraApi.nonConformances.registerOotAcknowledgement(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['non-conformance-oot-notification', id],
      })
      queryClient.invalidateQueries({ queryKey: ['non-conformance-audit', id] })
      toast.success('Confirmação de recebimento registrada')
      setOotAckDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  // Escalate to CAPA mutation
  const escalateMutation = useMutation({
    mutationFn: async (data: {
      rootCauseAnalysis?: string
      actionPlan?: string
    }) => calibraApi.nonConformances.escalateToCapa(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['non-conformance', id] })
      queryClient.invalidateQueries({ queryKey: ['non-conformance-audit', id] })
      queryClient.invalidateQueries({ queryKey: ['non-conformances'] })
      toast.success('CAPA criada com sucesso')
      setCapaDialogOpen(false)
    },
    onError: (error) => toast.error(error.message),
  })

  if (cloudOnlyUnavailable) {
    return (
      <CloudOnlyOfflineState title="Não conformidade indisponível offline" />
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-muted-foreground">Carregando...</p>
        </CardContent>
      </Card>
    )
  }

  if (error || !nc) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-red-500">
            Erro ao carregar nao conformidade:{' '}
            {error?.message || 'NC nao encontrada'}
          </p>
        </CardContent>
      </Card>
    )
  }

  const statusBadge = getStatusBadge(nc.status)
  const isResolved = nc.status === 'resolved'

  return (
    <div className="space-y-6">
      {/* Header */}
      <Panel className="relative overflow-hidden p-6">
        <BlueprintOverlay />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Não conformidade
            </p>
            <h1 className="text-balance font-mono text-2xl font-semibold tracking-tight">
              {nc.ncNumber}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
            {nc.capaId && (
              <Badge
                variant="outline"
                className="border-blue-500 text-blue-600"
              >
                CAPA Vinculada
              </Badge>
            )}
          </div>
        </div>
      </Panel>

      <div className="grid gap-6 md:grid-cols-2">
        {/* NC Details */}
        <Card>
          <CardHeader>
            <CardTitle>Detalhes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Tipo</Label>
                <p className="font-medium">{getTypeLabel(nc.type)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Detectada em</Label>
                <p className="font-medium">{formatDate(nc.detectedAt)}</p>
              </div>
              <div>
                <Label className="text-muted-foreground">Detectada por</Label>
                <p className="font-medium">
                  {nc.detectedByName || nc.detectedBy}
                </p>
              </div>
              <div>
                <Label className="text-muted-foreground">Idade</Label>
                <p className="font-medium">{nc.ageDays} dias</p>
              </div>
              {nc.job && (
                <div className="col-span-2">
                  <Label className="text-muted-foreground">
                    Ordem de Servico
                  </Label>
                  <p>
                    <Link
                      to="/dashboard/jobs/$id"
                      params={{ id: String(nc.job.id) }}
                      className="font-medium text-primary hover:underline"
                    >
                      {nc.job.jobId}
                    </Link>
                    <Badge variant="outline" className="ml-2">
                      {nc.job.status}
                    </Badge>
                  </p>
                </div>
              )}
            </div>
            <div>
              <Label className="text-muted-foreground">Descrição</Label>
              <p className="mt-1 whitespace-pre-wrap">{nc.description}</p>
            </div>
          </CardContent>
        </Card>

        {/* Disposition */}
        <Card>
          <CardHeader>
            <CardTitle>Disposicao</CardTitle>
            <CardDescription>
              Decisao sobre o tratamento da nao conformidade
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Disposicao</Label>
              <p className="font-medium">
                {getDispositionLabel(nc.disposition)}
              </p>
            </div>
            {nc.dispositionJustification && (
              <div>
                <Label className="text-muted-foreground">Justificativa</Label>
                <p className="whitespace-pre-wrap">
                  {nc.dispositionJustification}
                </p>
              </div>
            )}
            {nc.dispositionApproverName && (
              <div>
                <Label className="text-muted-foreground">Aprovada por</Label>
                <p>
                  {nc.dispositionApproverName} em{' '}
                  {formatDate(nc.dispositionApprovedAt)}
                </p>
              </div>
            )}
            {nc.correctionTaken && (
              <div>
                <Label className="text-muted-foreground">Correcao Tomada</Label>
                <p className="whitespace-pre-wrap">{nc.correctionTaken}</p>
              </div>
            )}
            {nc.resolverName && (
              <div>
                <Label className="text-muted-foreground">Resolvida por</Label>
                <p>
                  {nc.resolverName} em {formatDate(nc.resolvedAt)}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            {!isResolved && (
              <div className="flex flex-wrap gap-2 pt-4 border-t">
                {!nc.disposition && (
                  <Dialog
                    open={dispositionDialogOpen}
                    onOpenChange={setDispositionDialogOpen}
                  >
                    <DialogTrigger
                      render={<Button>Definir Disposicao</Button>}
                    />
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Definir Disposicao</DialogTitle>
                        <DialogDescription>
                          Escolha como tratar esta nao conformidade. Disposicoes
                          &quot;uso como esta&quot; e &quot;concessao&quot;
                          requerem aprovacao do gerente tecnico.
                        </DialogDescription>
                      </DialogHeader>
                      <DispositionForm
                        onSubmit={(data) => dispositionMutation.mutate(data)}
                        isLoading={dispositionMutation.isPending}
                      />
                    </DialogContent>
                  </Dialog>
                )}

                {nc.disposition && (
                  <Dialog
                    open={resolveDialogOpen}
                    onOpenChange={setResolveDialogOpen}
                  >
                    <DialogTrigger render={<Button>Resolver NC</Button>} />
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Resolver Nao Conformidade</DialogTitle>
                        <DialogDescription>
                          Descreva a correcao tomada para resolver esta NC.
                        </DialogDescription>
                      </DialogHeader>
                      <ResolveForm
                        onSubmit={(data) => resolveMutation.mutate(data)}
                        isLoading={resolveMutation.isPending}
                      />
                    </DialogContent>
                  </Dialog>
                )}

                {!nc.capaId && (
                  <Dialog
                    open={capaDialogOpen}
                    onOpenChange={setCapaDialogOpen}
                  >
                    <DialogTrigger
                      render={
                        <Button variant="outline">Escalar para CAPA</Button>
                      }
                    />
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Criar CAPA</DialogTitle>
                        <DialogDescription>
                          Crie uma acao corretiva/preventiva a partir desta NC
                          para analise de causa raiz.
                        </DialogDescription>
                      </DialogHeader>
                      <CapaForm
                        onSubmit={(data) => escalateMutation.mutate(data)}
                        isLoading={escalateMutation.isPending}
                      />
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* §7.10 out-of-tolerance customer notification */}
      {nc.type === 'out_of_tolerance' && (
        <Card>
          <CardHeader>
            <CardTitle>Notificação 7.10</CardTitle>
            <CardDescription>
              Notificação ao cliente sobre resultado fora de tolerância (ISO/IEC
              17025 §7.10)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {ootNotification ? (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-muted-foreground">Status</Label>
                    <p className="mt-1">
                      <Badge
                        variant={
                          getOotStatusBadge(ootNotification.status).variant
                        }
                      >
                        {getOotStatusBadge(ootNotification.status).label}
                      </Badge>
                    </p>
                  </div>
                  <div>
                    <Label className="text-muted-foreground">
                      Destinatário
                    </Label>
                    <p className="font-medium">
                      {ootNotification.recipientName || '-'}
                    </p>
                    {ootNotification.recipientEmail ? (
                      <p className="text-sm text-muted-foreground">
                        {ootNotification.recipientEmail}
                      </p>
                    ) : (
                      <p className="text-sm text-destructive">
                        — sem e-mail cadastrado
                      </p>
                    )}
                  </div>
                  {ootNotification.certificateNumber && (
                    <div>
                      <Label className="text-muted-foreground">
                        Certificado
                      </Label>
                      <p className="font-mono font-medium">
                        {ootNotification.certificateNumber}
                      </p>
                    </div>
                  )}
                  {ootNotification.sentAt && (
                    <div>
                      <Label className="text-muted-foreground">
                        Enviada em
                      </Label>
                      <p className="font-medium">
                        {formatDate(ootNotification.sentAt)}
                      </p>
                    </div>
                  )}
                  {ootNotification.acknowledgedAt && (
                    <div>
                      <Label className="text-muted-foreground">
                        Confirmada em
                      </Label>
                      <p className="font-medium">
                        {formatDate(ootNotification.acknowledgedAt)}
                        {ootNotification.acknowledgedVia && (
                          <span className="ml-1 text-sm text-muted-foreground">
                            via{' '}
                            {getAcknowledgedViaLabel(
                              ootNotification.acknowledgedVia,
                            )}
                          </span>
                        )}
                      </p>
                    </div>
                  )}
                </div>
                {ootNotification.affectedScope && (
                  <div>
                    <Label className="text-muted-foreground">
                      Escopo potencialmente afetado
                    </Label>
                    <p className="whitespace-pre-wrap">
                      {ootNotification.affectedScope}
                    </p>
                  </div>
                )}
                {ootNotification.acknowledgedNote && (
                  <div>
                    <Label className="text-muted-foreground">
                      Nota da confirmação
                    </Label>
                    <p className="whitespace-pre-wrap">
                      {ootNotification.acknowledgedNote}
                    </p>
                  </div>
                )}
                {ootNotification.status !== 'ACKNOWLEDGED' && (
                  <div className="border-t pt-4">
                    <Dialog
                      open={ootAckDialogOpen}
                      onOpenChange={setOotAckDialogOpen}
                    >
                      <DialogTrigger
                        render={
                          <Button variant="outline">
                            Registrar confirmação
                          </Button>
                        }
                      />
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>
                            Registrar confirmação de recebimento
                          </DialogTitle>
                          <DialogDescription>
                            Registre manualmente que o cliente confirmou o
                            recebimento da notificação 7.10.
                          </DialogDescription>
                        </DialogHeader>
                        <OotAcknowledgementForm
                          onSubmit={(data) => ootAckMutation.mutate(data)}
                          isLoading={ootAckMutation.isPending}
                        />
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma notificação ao cliente foi gerada para esta NC.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* CAPA Info */}
      {nc.capa && (
        <Card>
          <CardHeader>
            <CardTitle>CAPA Vinculada</CardTitle>
            <CardDescription>
              Acao Corretiva / Preventiva - {nc.capa.capaNumber}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground">Status</Label>
                <p>
                  <Badge variant="outline">{nc.capa.status}</Badge>
                </p>
              </div>
              {nc.capa.dueDate && (
                <div>
                  <Label className="text-muted-foreground">Prazo</Label>
                  <p>{formatDate(nc.capa.dueDate)}</p>
                </div>
              )}
            </div>
            {nc.capa.rootCauseAnalysis && (
              <div>
                <Label className="text-muted-foreground">
                  Analise de Causa Raiz
                </Label>
                <p className="whitespace-pre-wrap">
                  {nc.capa.rootCauseAnalysis}
                </p>
              </div>
            )}
            {nc.capa.actionPlan && (
              <div>
                <Label className="text-muted-foreground">Plano de Acao</Label>
                <p className="whitespace-pre-wrap">{nc.capa.actionPlan}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Audit Log */}
      {auditLog && auditLog.data.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Histórico de alterações</CardTitle>
            <CardDescription>
              Registro de atividades desta não conformidade
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {auditLog.data.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between border-b pb-3 last:border-b-0"
                >
                  <div>
                    <p className="font-medium text-sm">
                      {log.action === 'create'
                        ? 'NC registrada'
                        : log.action === 'disposition'
                          ? 'Disposicao definida'
                          : log.action === 'resolve'
                            ? 'NC resolvida'
                            : log.action === 'escalate_to_capa'
                              ? 'Escalada para CAPA'
                              : log.action}
                    </p>
                    {log.reason && (
                      <p className="text-sm text-muted-foreground">
                        {log.reason}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {formatDate(log.performedAt)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ============================================================================
// Sub-forms
// ============================================================================

function DispositionForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: { disposition: string; justification?: string }) => void
  isLoading: boolean
}) {
  const [disposition, setDisposition] = useState('')
  const [justification, setJustification] = useState('')

  const requiresJustification =
    disposition === 'use_as_is' || disposition === 'concession'

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Disposicao</Label>
        <Select
          value={disposition}
          onValueChange={(value) => setDisposition(value ?? '')}
        >
          <SelectTrigger>
            <SelectValue placeholder="Selecione a disposicao" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rework">Retrabalho</SelectItem>
            <SelectItem value="scrap">Sucata</SelectItem>
            <SelectItem value="use_as_is">
              Uso como esta (requer aprovacao)
            </SelectItem>
            <SelectItem value="concession">
              Concessao (requer aprovacao)
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {requiresJustification && (
        <div className="space-y-2">
          <Label>Justificativa (obrigatoria)</Label>
          <Textarea
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            placeholder="Justifique a disposicao escolhida..."
            rows={3}
          />
        </div>
      )}

      <Button
        onClick={() =>
          onSubmit({
            disposition,
            justification: justification || undefined,
          })
        }
        disabled={
          !disposition ||
          isLoading ||
          (requiresJustification && justification.length < 10)
        }
        className="w-full"
      >
        {isLoading ? 'Salvando...' : 'Confirmar Disposicao'}
      </Button>
    </div>
  )
}

function ResolveForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: { correctionTaken: string }) => void
  isLoading: boolean
}) {
  const [correctionTaken, setCorrectionTaken] = useState('')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Correcao Tomada</Label>
        <Textarea
          value={correctionTaken}
          onChange={(e) => setCorrectionTaken(e.target.value)}
          placeholder="Descreva a correcao aplicada..."
          rows={4}
        />
      </div>
      <Button
        onClick={() => onSubmit({ correctionTaken })}
        disabled={correctionTaken.length < 10 || isLoading}
        className="w-full"
      >
        {isLoading ? 'Salvando...' : 'Resolver NC'}
      </Button>
    </div>
  )
}

function OotAcknowledgementForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: { note: string }) => void
  isLoading: boolean
}) {
  const [note, setNote] = useState('')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nota (obrigatória)</Label>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Como o recebimento foi confirmado? (ex.: telefone, e-mail)"
          rows={3}
        />
      </div>
      <Button
        onClick={() => onSubmit({ note })}
        disabled={note.trim().length === 0 || isLoading}
        className="w-full"
      >
        {isLoading ? 'Registrando...' : 'Registrar confirmação'}
      </Button>
    </div>
  )
}

function CapaForm({
  onSubmit,
  isLoading,
}: {
  onSubmit: (data: { rootCauseAnalysis?: string; actionPlan?: string }) => void
  isLoading: boolean
}) {
  const [rootCause, setRootCause] = useState('')
  const [actionPlan, setActionPlan] = useState('')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Analise de Causa Raiz (opcional)</Label>
        <Textarea
          value={rootCause}
          onChange={(e) => setRootCause(e.target.value)}
          placeholder="Descreva a analise de causa raiz..."
          rows={3}
        />
      </div>
      <div className="space-y-2">
        <Label>Plano de Acao (opcional)</Label>
        <Textarea
          value={actionPlan}
          onChange={(e) => setActionPlan(e.target.value)}
          placeholder="Descreva o plano de acao corretiva/preventiva..."
          rows={3}
        />
      </div>
      <Button
        onClick={() =>
          onSubmit({
            rootCauseAnalysis: rootCause || undefined,
            actionPlan: actionPlan || undefined,
          })
        }
        disabled={isLoading}
        className="w-full"
      >
        {isLoading ? 'Criando...' : 'Criar CAPA'}
      </Button>
    </div>
  )
}
