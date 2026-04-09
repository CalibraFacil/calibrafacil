import { createFileRoute, useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { Clock01Icon } from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

export const Route = createFileRoute('/dashboard/clients/$id/compliance')({
  component: ClientComplianceTab,
})

type CustomerCompliance = {
  qualificationStatus?: 'pending' | 'qualified' | 'suspended' | 'expired'
  qualificationDate?: string
  qualificationExpiresAt?: string
  contractNumber?: string
  contractSignedAt?: string
  contractExpiresAt?: string
  qualityRequirementsAcknowledged?: boolean
  qualityRequirementsAcknowledgedAt?: string
  notes?: string
}

type AuditLogEntry = {
  id: number
  action: string
  changes: unknown
  performedAt: string
  reason: string | null
  performedByName: string
  performedByEmail: string
}

function ClientComplianceTab() {
  const { id } = useParams({ from: '/dashboard/clients/$id/compliance' })

  const { data: customer, isLoading: customerLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const res = await api.api.customers[':id'].$get({
        param: { id },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar cliente')
      }
      return res.json() as Promise<{
        id: number
        compliance?: CustomerCompliance
      }>
    },
  })

  const { data: auditLogData, isLoading: auditLoading } = useQuery({
    queryKey: ['customer-audit-log', id],
    queryFn: async () => {
      const res = await api.api.customers[':id']['audit-log'].$get({
        param: { id },
        query: { page: '1', limit: '50' },
      })
      if (!res.ok) {
        throw new Error('Falha ao carregar historico')
      }
      return res.json() as Promise<{
        data: Array<AuditLogEntry>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }>
    },
  })

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
      create: 'Criacao',
      update: 'Atualizacao',
      compliance_change: 'Alteracao de conformidade',
      user_invited: 'Usuario convidado',
      user_removed: 'Usuario removido',
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
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          Cliente não encontrado
        </CardContent>
      </Card>
    )
  }

  return (
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
  customer: { id: number; compliance?: CustomerCompliance }
  customerId: string
  auditLogData?:
    | {
        data: Array<AuditLogEntry>
        pagination: {
          page: number
          limit: number
          total: number
          totalPages: number
        }
      }
    | undefined
  auditLoading: boolean
  formatAction: (action: string) => string
  formatDate: (dateString: string) => string
  getStatusLabel: (status: string) => string
}) {
  const queryClient = useQueryClient()
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  const compliance = customer.compliance as CustomerCompliance | undefined

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
  const [contractNumber, setContractNumber] = useState(
    compliance?.contractNumber || '',
  )
  const [contractSignedAt, setContractSignedAt] = useState(
    compliance?.contractSignedAt || '',
  )
  const [contractExpiresAt, setContractExpiresAt] = useState(
    compliance?.contractExpiresAt || '',
  )
  const [qualityRequirementsAcknowledged, setQualityRequirementsAcknowledged] =
    useState(compliance?.qualityRequirementsAcknowledged || false)
  const [notes, setNotes] = useState(compliance?.notes || '')

  const updateComplianceMutation = useMutation({
    mutationFn: async (data: {
      compliance: CustomerCompliance
      reason: string
    }) => {
      const res = await api.api.customers[':id'].compliance.$put({
        param: { id: customerId },
        json: data,
      })
      if (!res.ok) {
        throw new Error('Falha ao atualizar conformidade')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] })
      queryClient.invalidateQueries({ queryKey: ['customer-audit-log', customerId] })
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
      setReasonError('Motivo e obrigatorio para alteracoes de conformidade')
      return
    }

    updateComplianceMutation.mutate({
      compliance: {
        qualificationStatus:
          qualificationStatus as CustomerCompliance['qualificationStatus'],
        qualificationDate: qualificationDate || undefined,
        qualificationExpiresAt: qualificationExpiresAt || undefined,
        contractNumber: contractNumber || undefined,
        contractSignedAt: contractSignedAt || undefined,
        contractExpiresAt: contractExpiresAt || undefined,
        qualityRequirementsAcknowledged,
        notes: notes || undefined,
      },
      reason: reason.trim(),
    })
  }

  return (
    <div className="space-y-6">
      {/* Qualification Status Card */}
      <Card>
        <CardHeader>
          <CardTitle>Status de Qualificação</CardTitle>
          <CardDescription>
            Gerenciamento do status de qualificação conforme ISO 17025:2017.
          </CardDescription>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>

      {/* Contract Card */}
      <Card>
        <CardHeader>
          <CardTitle>Contrato e Acordos</CardTitle>
          <CardDescription>
            Informações contratuais e reconhecimento de requisitos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field>
                <FieldLabel htmlFor="contract-number">
                  Número do Contrato
                </FieldLabel>
                <Input
                  id="contract-number"
                  value={contractNumber}
                  onChange={(e) => setContractNumber(e.target.value)}
                  placeholder="CT-2024-001"
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="contract-signed">
                  Data de Assinatura
                </FieldLabel>
                <Input
                  id="contract-signed"
                  type="date"
                  value={contractSignedAt}
                  onChange={(e) => setContractSignedAt(e.target.value)}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="contract-expires">
                  Validade do Contrato
                </FieldLabel>
                <Input
                  id="contract-expires"
                  type="date"
                  value={contractExpiresAt}
                  onChange={(e) => setContractExpiresAt(e.target.value)}
                />
              </Field>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <Switch
                id="quality-ack"
                checked={qualityRequirementsAcknowledged}
                onCheckedChange={setQualityRequirementsAcknowledged}
              />
              <Label htmlFor="quality-ack" className="cursor-pointer">
                Requisitos de qualidade reconhecidos pelo cliente
              </Label>
            </div>

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
                      Conforme ISO 17025:2017 (cláusula 8.4), alterações em
                      dados de conformidade devem ser justificadas para
                      rastreabilidade.
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
                        ? 'Salvando...'
                        : 'Confirmar'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      {/* Audit Log Card */}
      <Card>
        <CardHeader>
          <CardTitle>Historico de Alterações</CardTitle>
          <CardDescription>
            Registro de auditoria conforme ISO 17025:2017 (Cláusula 8.4).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <AuditLogSkeleton />
          ) : !auditLogData?.data.length ? (
            <Empty className="py-8">
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
            <div className="rounded-md border">
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
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function ComplianceSkeleton() {
  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-56 mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-9 w-full" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function AuditLogSkeleton() {
  return (
    <div className="rounded-md border">
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
    </div>
  )
}
