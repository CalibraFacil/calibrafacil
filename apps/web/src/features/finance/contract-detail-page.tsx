import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { CommercialAgreementStatusBadge } from '@/components/finance-status-badges'
import { formatFinanceDate, formatFinanceMoney } from '@/lib/finance-formatters'
import { Button } from '@/components/ui/button'
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
import { calibraApi } from '@/utils/api'
import { useFinanceContractDetailData } from '@/features/finance/queries'
import type { FinanceContractDetails } from '@/features/finance/types'

export function FinanceContractDetailsPage({ id }: { id: string }) {
  const queryClient = useQueryClient()

  const contractQuery = useFinanceContractDetailData<{
    data: FinanceContractDetails
  }>(id)

  const activateMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.finance.activateContract(id)
    },
    onSuccess: () => {
      toast.success('Contrato ativado')
      queryClient.invalidateQueries({ queryKey: ['finance', 'contracts'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const cancelMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.finance.cancelContract(id)
    },
    onSuccess: () => {
      toast.success('Contrato cancelado')
      queryClient.invalidateQueries({ queryKey: ['finance', 'contracts'] })
    },
    onError: (error) => toast.error(error.message),
  })

  const contract = contractQuery.data?.data

  if (!contract) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Contrato comercial</CardTitle>
          <CardDescription>
            {contractQuery.isPending
              ? 'Carregando contrato...'
              : 'Contrato não encontrado.'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <CardTitle>{contract.title}</CardTitle>
              <CommercialAgreementStatusBadge status={contract.status} />
            </div>
            <CardDescription>
              {contract.customerName} ·{' '}
              {contract.agreementCode || `#${contract.id}`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {contract.status === 'DRAFT' && (
              <Button
                onClick={() => activateMutation.mutate()}
                disabled={activateMutation.isPending}
              >
                {activateMutation.isPending ? 'Ativando...' : 'Ativar contrato'}
              </Button>
            )}
            {contract.status === 'ACTIVE' && (
              <Button
                variant="outline"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending
                  ? 'Cancelando...'
                  : 'Cancelar contrato'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InfoItem
            label="Moeda"
            value={contract.currency === 'BRL' ? 'R$' : contract.currency}
          />
          <InfoItem
            label="Vigência inicial"
            value={formatFinanceDate(contract.effectiveFrom)}
          />
          <InfoItem
            label="Vigência final"
            value={
              contract.effectiveTo
                ? formatFinanceDate(contract.effectiveTo)
                : 'Sem término'
            }
          />
          <InfoItem
            label="Prazo padrão"
            value={`${contract.defaultPaymentTermDays} dias`}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compatibilidade com Compliance</CardTitle>
          <CardDescription>
            O contrato ativo alimenta o cadastro de conformidade do cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <InfoItem
            label="Status de qualificação"
            value={
              contract.customerCompliance?.qualificationStatus === 'qualified'
                ? 'Qualificado'
                : contract.customerCompliance?.qualificationStatus ===
                    'suspended'
                  ? 'Suspenso'
                  : contract.customerCompliance?.qualificationStatus ===
                      'expired'
                    ? 'Expirado'
                    : 'Pendente'
            }
          />
          <InfoItem
            label="Requisitos reconhecidos"
            value={
              contract.customerCompliance?.qualityRequirementsAcknowledged
                ? 'Sim'
                : 'Não'
            }
          />
          <InfoItem
            label="Reconhecimento do cliente"
            value={
              contract.customerCompliance?.contractSignedAt
                ? formatFinanceDate(
                    contract.customerCompliance.contractSignedAt,
                  )
                : 'Não registrado'
            }
          />
          <InfoItem
            label="Contrato sincronizado"
            value={
              contract.customerCompliance?.contractNumber ||
              `Contrato #${contract.id}`
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tabela negociada</CardTitle>
          <CardDescription>
            Estes valores alimentam o snapshot comercial dos jobs novos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Serviço</TableHead>
                <TableHead>Unidade</TableHead>
                <TableHead>Moeda</TableHead>
                <TableHead className="text-right">Preço</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {contract.serviceTerms.map(
                (term: {
                  id: number
                  serviceId: number
                  unitId: number | null
                  priceCents: number
                  currency: string
                }) => (
                  <TableRow key={term.id}>
                    <TableCell>Serviço #{term.serviceId}</TableCell>
                    <TableCell>
                      {term.unitId ? `Unidade #${term.unitId}` : 'Geral'}
                    </TableCell>
                    <TableCell>{term.currency}</TableCell>
                    <TableCell className="text-right">
                      {formatFinanceMoney(term.priceCents, term.currency)}
                    </TableCell>
                  </TableRow>
                ),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Observações</CardTitle>
          <CardDescription>
            Notas internas e condições vinculadas ao contrato.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {contract.notes || 'Sem observações registradas.'}
        </CardContent>
      </Card>
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="mt-2 font-medium">{value}</div>
    </div>
  )
}
