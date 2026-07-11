import { Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  CheckmarkBadge01Icon,
  Clock01Icon,
  LegalDocument01Icon,
  Shield01Icon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { CustomerOotEventsPanel } from '@/features/customers/components/oot-events-panel'
import {
  useCustomerAuditLogData,
  useCustomerDetailData,
} from '@/features/customers/queries'
import type {
  CustomerAuditLogData,
  CustomerCompliance,
  CustomerDetail,
} from '@/features/customers/types'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  ClientMetric,
  ClientMetricStrip,
  ClientPanel,
  ClientPanelBody,
  ClientSection,
  TableFrame,
} from '@/features/customers/components/client-detail-ui'

export function ClientComplianceTab({ id }: { id: string }) {
  const { data: customer, isLoading: customerLoading } =
    useCustomerDetailData(id)
  const { data: auditLogData, isLoading: auditLoading } =
    useCustomerAuditLogData(id)

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatAction = (action: string) => {
    const actions: Record<string, string> = {
      create: 'Criação',
      update: 'Atualização',
      compliance_change: 'Alteração de conformidade',
      user_invited: 'Usuário convidado',
      user_removed: 'Usuário removido',
      invitation_canceled: 'Convite cancelado',
      delete: 'Exclusao',
    }
    return actions[action] || action
  }

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      pending: 'Pendente',
      qualified: 'Qualificado',
      suspended: 'Suspenso',
      expired: 'Expirado',
    }
    return labels[status] || status
  }

  if (customerLoading) {
    return <ComplianceSkeleton />
  }

  if (!customer) {
    return (
      <div className="py-8 text-center text-sm text-muted-foreground">
        Cliente não encontrado
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <ClientComplianceForm
        key={customer.id}
        customer={customer}
        customerId={id}
        auditLogData={auditLogData}
        auditLoading={auditLoading}
        formatAction={formatAction}
        formatDate={formatDate}
        getStatusLabel={getStatusLabel}
      />
      <CustomerOotEventsPanel customerId={id} />
    </div>
  )
}

function ClientComplianceForm({
  customer,
  customerId,
  auditLogData,
  auditLoading,
  formatAction,
  formatDate,
  getStatusLabel,
}: {
  customer: CustomerDetail
  customerId: string
  auditLogData?: CustomerAuditLogData
  auditLoading: boolean
  formatAction: (action: string) => string
  formatDate: (dateString: string) => string
  getStatusLabel: (status: string) => string
}) {
  const queryClient = useQueryClient()
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  // oxlint-disable-next-line typescript/consistent-type-assertions -- API customer detail includes the CustomerCompliance JSON payload.
  const compliance = customer.compliance as CustomerCompliance | undefined
  const activeCommercialAgreement = customer.activeCommercialAgreement ?? null

  // Form state
  const [qualificationStatus, setQualificationStatus] = useState<string>(
    compliance?.qualificationStatus || 'pending',
  )
  const [qualificationDate, setQualificationDate] = useState(
    compliance?.qualificationDate || '',
  )
  const [qualificationExpiresAt, setQualificationExpiresAt] = useState(
    compliance?.qualificationExpiresAt || '',
  )
  const [contractSignedAt, setContractSignedAt] = useState(
    compliance?.contractSignedAt || '',
  )
  const [qualityRequirementsAcknowledged, setQualityRequirementsAcknowledged] =
    useState(compliance?.qualityRequirementsAcknowledged || false)
  const [notes, setNotes] = useState(compliance?.notes || '')

  const updateComplianceMutation = useMutation({
    mutationFn: async (data: {
      compliance: CustomerCompliance
      reason: string
    }) => {
      return calibraApi.customers.updateCompliance(customerId, data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      queryClient.invalidateQueries({
        queryKey: ['customer-audit-log', customerId],
      })
      toast.success('Conformidade atualizada!')
      setSaveDialogOpen(false)
      setReason('')
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSave = () => {
    setReasonError(null)

    if (!reason.trim()) {
      setReasonError('Motivo é obrigatório para alterações de conformidade.')
      return
    }

    updateComplianceMutation.mutate({
      compliance: {
        qualificationStatus:
          // oxlint-disable-next-line typescript/consistent-type-assertions -- Select options are limited to compliance qualification statuses.
          qualificationStatus as CustomerCompliance['qualificationStatus'],
        qualificationDate: qualificationDate || undefined,
        qualificationExpiresAt: qualificationExpiresAt || undefined,
        contractAgreementId: activeCommercialAgreement?.id,
        contractSignedAt: contractSignedAt || undefined,
        qualityRequirementsAcknowledged,
        notes: notes || undefined,
      },
      reason: reason.trim(),
    })
  }

  return (
    <ClientPanel
      eyebrow="Conformidade"
      title="Qualificação e Auditoria"
      description="Controle a qualificação ISO 17025, o reconhecimento comercial e o histórico de alterações do cliente."
      icon={<HugeiconsIcon icon={Shield01Icon} className="size-5" />}
    >
      <ClientMetricStrip className="xl:grid-cols-3">
        <ClientMetric
          icon={
            <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" />
          }
          label="Status"
          value={getStatusLabel(qualificationStatus)}
          tone={
            qualificationStatus === 'suspended' ||
            qualificationStatus === 'expired'
              ? 'danger'
              : 'default'
          }
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={LegalDocument01Icon} className="size-4" />}
          label="Contrato Ativo"
          value={activeCommercialAgreement ? 'Sim' : 'Não'}
        />
        <ClientMetric
          icon={<HugeiconsIcon icon={Clock01Icon} className="size-4" />}
          label="Registros"
          value={String(auditLogData?.data.length ?? 0)}
        />
      </ClientMetricStrip>

      <ClientPanelBody className="space-y-8">
        <ClientSection
          icon={
            <HugeiconsIcon icon={CheckmarkBadge01Icon} className="size-4" />
          }
          title="Status de Qualificação"
          description="Gerenciamento do status de qualificação conforme ISO 17025:2017."
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="status">Status</FieldLabel>
                <Select
                  value={qualificationStatus}
                  onValueChange={(value) =>
                    value && setQualificationStatus(value)
                  }
                >
                  <SelectTrigger id="status">
                    <SelectValue>
                      {getStatusLabel(qualificationStatus)}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pendente</SelectItem>
                    <SelectItem value="qualified">Qualificado</SelectItem>
                    <SelectItem value="suspended">Suspenso</SelectItem>
                    <SelectItem value="expired">Expirado</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="qualification-date">
                  Data de Qualificação
                </FieldLabel>
                <Input
                  id="qualification-date"
                  type="date"
                  value={qualificationDate}
                  onChange={(e) => setQualificationDate(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="qualification-expires">
                  Validade
                </FieldLabel>
                <Input
                  id="qualification-expires"
                  type="date"
                  value={qualificationExpiresAt}
                  onChange={(e) => setQualificationExpiresAt(e.target.value)}
                />
              </Field>
            </div>
          </FieldGroup>
        </ClientSection>

        <ClientSection
          icon={<HugeiconsIcon icon={LegalDocument01Icon} className="size-4" />}
          title="Contrato e Acordos"
          description="O contrato comercial ativo vem do módulo Financeiro; aqui ficam o reconhecimento do cliente e o controle de qualificação."
        >
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field>
                <FieldLabel>Contrato ativo</FieldLabel>
                <div className="rounded-md bg-muted/30 px-3 py-2 text-sm ring-1 ring-foreground/10">
                  {activeCommercialAgreement ? (
                    <div className="space-y-1">
                      <div className="font-medium">
                        {activeCommercialAgreement.agreementCode ||
                          `Contrato #${activeCommercialAgreement.id}`}
                      </div>
                      <div className="text-muted-foreground">
                        {activeCommercialAgreement.title}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      Nenhum contrato comercial ativo
                    </span>
                  )}
                </div>
                {activeCommercialAgreement && (
                  <FieldDescription>
                    <Link
                      to="/dashboard/finance/contracts/$id"
                      params={{ id: String(activeCommercialAgreement.id) }}
                      className="underline underline-offset-4"
                    >
                      Abrir contrato no Financeiro
                    </Link>
                  </FieldDescription>
                )}
              </Field>

              <Field>
                <FieldLabel>Vigência contratual</FieldLabel>
                <div className="rounded-md bg-muted/30 px-3 py-2 text-sm ring-1 ring-foreground/10">
                  {activeCommercialAgreement ? (
                    <div className="space-y-1">
                      <div>
                        Início:{' '}
                        {new Date(
                          activeCommercialAgreement.effectiveFrom,
                        ).toLocaleDateString('pt-BR')}
                      </div>
                      <div className="text-muted-foreground">
                        {activeCommercialAgreement.effectiveTo
                          ? `Fim: ${new Date(activeCommercialAgreement.effectiveTo).toLocaleDateString('pt-BR')}`
                          : 'Sem término definido'}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">
                      Defina e ative um contrato no Financeiro para refletir a
                      vigência aqui.
                    </span>
                  )}
                </div>
              </Field>

              <Field>
                <FieldLabel htmlFor="contract-signed">
                  Reconhecimento do cliente
                </FieldLabel>
                <Input
                  id="contract-signed"
                  type="date"
                  value={contractSignedAt}
                  onChange={(e) => setContractSignedAt(e.target.value)}
                />
                <FieldDescription>
                  Data em que o cliente reconheceu formalmente os requisitos de
                  qualidade do contrato ativo.
                </FieldDescription>
              </Field>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Switch
                id="quality-ack"
                checked={qualityRequirementsAcknowledged}
                onCheckedChange={setQualityRequirementsAcknowledged}
                disabled={!activeCommercialAgreement}
              />
              <Label htmlFor="quality-ack" className="cursor-pointer">
                Requisitos de qualidade reconhecidos pelo cliente
              </Label>
            </div>
            {!activeCommercialAgreement && (
              <FieldDescription>
                Ative primeiro um contrato comercial no Financeiro para poder
                registrar o reconhecimento formal do cliente.
              </FieldDescription>
            )}

            <Field>
              <FieldLabel htmlFor="notes">Observações</FieldLabel>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Observações internas sobre conformidade..."
                rows={3}
              />
              <FieldDescription>
                Notas internas sobre o status de conformidade.
              </FieldDescription>
            </Field>

            <div className="flex justify-end pt-4">
              <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
                <DialogTrigger render={<Button />}>
                  Salvar Alterações
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Justificativa da Alteração</DialogTitle>
                    <DialogDescription>
                      Alterações em dados de conformidade devem ser justificadas
                      para garantir a rastreabilidade.
                    </DialogDescription>
                  </DialogHeader>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="reason">
                        Motivo da alteração
                      </FieldLabel>
                      <Textarea
                        id="reason"
                        value={reason}
                        onChange={(e) => {
                          setReason(e.target.value)
                          setReasonError(null)
                        }}
                        placeholder="Descreva o motivo desta alteração..."
                        rows={3}
                      />
                      {reasonError && <FieldError>{reasonError}</FieldError>}
                    </Field>
                  </FieldGroup>
                  <DialogFooter>
                    <DialogClose render={<Button variant="outline" />}>
                      Cancelar
                    </DialogClose>
                    <Button
                      onClick={handleSave}
                      disabled={updateComplianceMutation.isPending}
                    >
                      {updateComplianceMutation.isPending
                        ? 'Salvando…'
                        : 'Confirmar'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </FieldGroup>
        </ClientSection>

        <ClientSection
          icon={<HugeiconsIcon icon={Clock01Icon} className="size-4" />}
          title="Histórico de alterações"
          description="Registro de alterações em dados de conformidade."
        >
          {auditLoading ? (
            <AuditLogSkeleton />
          ) : !auditLogData?.data.length ? (
            <Empty className="rounded-none border-x-0 border-y border-solid border-border/70 py-10">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Clock01Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum registro</EmptyTitle>
                <EmptyDescription>
                  O histórico de alterações aparecerá aqui.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <TableFrame>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Ação</TableHead>
                    <TableHead>Motivo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditLogData.data.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap">
                        {formatDate(entry.performedAt)}
                      </TableCell>
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {entry.performedByName}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {entry.performedByEmail}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {formatAction(entry.action)}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-50 truncate">
                        {entry.reason || '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableFrame>
          )}
        </ClientSection>
      </ClientPanelBody>
    </ClientPanel>
  )
}

function ComplianceSkeleton() {
  return (
    <div className="space-y-6">
      <div className="px-1">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
      <div className="border-t border-border/70 pt-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AuditLogSkeleton() {
  return (
    <TableFrame>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Data</TableHead>
            <TableHead>Usuário</TableHead>
            <TableHead>Ação</TableHead>
            <TableHead>Motivo</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <Skeleton className="h-4 w-32" />
              </TableCell>
              <TableCell>
                <div className="space-y-1">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </TableCell>
              <TableCell>
                <Skeleton className="h-5 w-28" />
              </TableCell>
              <TableCell>
                <Skeleton className="h-4 w-40" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableFrame>
  )
}
