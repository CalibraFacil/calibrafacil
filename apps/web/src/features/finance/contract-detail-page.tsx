import { useState } from 'react'
import { toast } from 'sonner'

import { CommercialAgreementStatusBadge } from '@/components/finance-status-badges'
import { formatFinanceDate } from '@/lib/finance-formatters'
import { Money } from '@/features/finance/finance-display'
import {
  ACTION_BUTTON_CLASS,
  BlueprintField,
  BlueprintGrid,
  BlueprintOverlay,
  InfoHint,
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  useFinanceContractDetailData,
  useFinanceContractServiceOptionsData,
} from '@/features/finance/queries'
import {
  useActivateContractMutation,
  useCancelContractMutation,
} from '@/features/finance/mutations'
import type { FinanceContractDetails } from '@/features/finance/types'

const QUALIFICATION_LABELS: Record<string, string> = {
  qualified: 'Qualificado',
  suspended: 'Suspenso',
  expired: 'Expirado',
}

export function FinanceContractDetailsPage({ id }: { id: string }) {
  const [cancelOpen, setCancelOpen] = useState(false)

  const contractQuery = useFinanceContractDetailData<{
    data: FinanceContractDetails
  }>(id)
  const serviceOptionsQuery = useFinanceContractServiceOptionsData()

  const activateMutation = useActivateContractMutation()
  const cancelMutation = useCancelContractMutation()

  const contract = contractQuery.data?.data

  if (!contract) {
    return (
      <Panel className="p-6">
        <PanelHeader
          eyebrow="Contrato comercial"
          title={
            contractQuery.isPending
              ? 'Carregando contrato…'
              : 'Contrato não encontrado'
          }
        />
      </Panel>
    )
  }

  const serviceName = (serviceId: number) =>
    serviceOptionsQuery.data?.data.find((option) => option.id === serviceId)
      ?.name ?? `Serviço #${serviceId}`

  const compliance = contract.customerCompliance
  const qualification = compliance?.qualificationStatus
    ? (QUALIFICATION_LABELS[compliance.qualificationStatus] ?? 'Pendente')
    : 'Pendente'

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <Panel className="relative overflow-hidden p-5 sm:p-6">
          <BlueprintOverlay />
          <div className="relative flex flex-col gap-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  Contrato comercial
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-balance text-xl font-semibold tracking-tight sm:text-2xl">
                    {contract.title}
                  </h1>
                  <CommercialAgreementStatusBadge status={contract.status} />
                </div>
                <p className="mt-0.5 text-pretty text-sm text-muted-foreground">
                  {contract.customerName} ·{' '}
                  {contract.agreementCode || `#${contract.id}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {contract.status === 'DRAFT' ? (
                  <Button
                    className={ACTION_BUTTON_CLASS}
                    onClick={() =>
                      activateMutation.mutate(id, {
                        onSuccess: () => toast.success('Contrato ativado'),
                      })
                    }
                    disabled={activateMutation.isPending}
                  >
                    {activateMutation.isPending ? 'Ativando…' : 'Ativar contrato'}
                  </Button>
                ) : null}
                {contract.status === 'ACTIVE' ? (
                  <Button
                    variant="outline"
                    className={ACTION_BUTTON_CLASS}
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancelar contrato
                  </Button>
                ) : null}
              </div>
            </div>

            <BlueprintGrid className="grid-cols-2 xl:grid-cols-4">
              <BlueprintField label="Moeda">
                {contract.currency === 'BRL' ? 'R$ (BRL)' : contract.currency}
              </BlueprintField>
              <BlueprintField label="Vigência inicial">
                {formatFinanceDate(contract.effectiveFrom)}
              </BlueprintField>
              <BlueprintField label="Vigência final">
                {contract.effectiveTo
                  ? formatFinanceDate(contract.effectiveTo)
                  : 'Sem término'}
              </BlueprintField>
              <BlueprintField label="Prazo padrão" mono>
                {contract.defaultPaymentTermDays} dias
              </BlueprintField>
            </BlueprintGrid>
          </div>
        </Panel>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            eyebrow="Conformidade"
            title={
              <span className="inline-flex items-center gap-1.5">
                Compatibilidade com Compliance
                <InfoHint>
                  Um contrato ativo alimenta o cadastro de conformidade do
                  cliente (qualificação, requisitos e datas de reconhecimento).
                </InfoHint>
              </span>
            }
            description="Reflete o estado de qualificação do cliente vinculado."
          />
          <BlueprintGrid className="mt-4 grid-cols-2 xl:grid-cols-4">
            <BlueprintField label="Qualificação">{qualification}</BlueprintField>
            <BlueprintField label="Requisitos reconhecidos">
              {compliance?.qualityRequirementsAcknowledged ? 'Sim' : 'Não'}
            </BlueprintField>
            <BlueprintField label="Reconhecimento do cliente">
              {compliance?.contractSignedAt
                ? formatFinanceDate(compliance.contractSignedAt)
                : 'Não registrado'}
            </BlueprintField>
            <BlueprintField label="Contrato sincronizado">
              {compliance?.contractNumber || `Contrato #${contract.id}`}
            </BlueprintField>
          </BlueprintGrid>
        </Panel>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader
            eyebrow="Tabela negociada"
            title="Preços por serviço"
            description="Estes valores alimentam o snapshot comercial dos jobs novos."
          />
          <div className="mt-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Serviço</TableHead>
                  <TableHead>Unidade</TableHead>
                  <TableHead className="text-right">Preço</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contract.serviceTerms.map((term) => (
                  <TableRow key={term.id}>
                    <TableCell className="font-medium">
                      {serviceName(term.serviceId)}
                    </TableCell>
                    <TableCell>
                      {term.unitId ? `Unidade #${term.unitId}` : 'Todas'}
                    </TableCell>
                    <TableCell className="text-right">
                      <Money cents={term.priceCents} currency={term.currency} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </Panel>
      </StaggerItem>

      <StaggerItem>
        <Panel className="p-5 sm:p-6">
          <PanelHeader eyebrow="Notas" title="Observações" />
          <p className="mt-3 text-pretty text-sm text-muted-foreground">
            {contract.notes || 'Sem observações registradas.'}
          </p>
        </Panel>
      </StaggerItem>

      <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancelar contrato</DialogTitle>
            <DialogDescription>
              O cancelamento encerra o contrato e interrompe novos snapshots
              comerciais a partir dele. Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCancelOpen(false)}
            >
              Voltar
            </Button>
            <Button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() =>
                cancelMutation.mutate(id, {
                  onSuccess: () => {
                    toast.success('Contrato cancelado')
                    setCancelOpen(false)
                  },
                })
              }
            >
              {cancelMutation.isPending ? 'Cancelando…' : 'Confirmar cancelamento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </StaggerGroup>
  )
}
