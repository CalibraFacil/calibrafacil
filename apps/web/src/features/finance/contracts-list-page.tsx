import { Link } from '@tanstack/react-router'
import { parseAsString, useQueryState } from 'nuqs'
import { Building02Icon, PlusSignIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { CommercialAgreementStatusBadge } from '@/components/finance-status-badges'
import { formatFinanceDate } from '@/lib/finance-formatters'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useFinanceContractsData } from '@/features/finance/queries'

export function FinanceContractsPage() {
  const [query, setQuery] = useQueryState(
    'query',
    parseAsString.withDefault(''),
  )
  const contractsQuery = useFinanceContractsData({ search: query })

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Contratos comerciais</CardTitle>
            <CardDescription>
              Defina preços negociados, vigência e condições comerciais por
              cliente.
            </CardDescription>
          </div>
          <Button
            render={<Link to="/dashboard/finance/contracts/new" />}
            type="button"
          >
            <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
            Novo contrato
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="max-w-sm">
            <Input
              placeholder="Buscar por cliente, título ou código"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          {contractsQuery.isError ? (
            <div className="text-destructive text-sm">
              Não foi possível carregar os contratos.
            </div>
          ) : contractsQuery.data?.data.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contrato</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Vigência</TableHead>
                  <TableHead>Prazo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contractsQuery.data.data.map((contract) => (
                  <TableRow key={contract.id}>
                    <TableCell>
                      <Link
                        to="/dashboard/finance/contracts/$id"
                        params={{ id: String(contract.id) }}
                        className="font-medium hover:underline"
                      >
                        {contract.title}
                      </Link>
                      <div className="text-muted-foreground text-xs">
                        {contract.agreementCode || `Contrato #${contract.id}`}
                      </div>
                    </TableCell>
                    <TableCell>{contract.customerName}</TableCell>
                    <TableCell>
                      <CommercialAgreementStatusBadge
                        status={contract.status}
                      />
                    </TableCell>
                    <TableCell>
                      {formatFinanceDate(contract.effectiveFrom)}
                      {contract.effectiveTo ? (
                        <div className="text-muted-foreground text-xs">
                          até {formatFinanceDate(contract.effectiveTo)}
                        </div>
                      ) : (
                        <div className="text-muted-foreground text-xs">
                          sem término
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      {contract.defaultPaymentTermDays} dias
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HugeiconsIcon icon={Building02Icon} />
                </EmptyMedia>
                <EmptyTitle>Nenhum contrato cadastrado</EmptyTitle>
                <EmptyDescription>
                  Cadastre o primeiro contrato para congelar a base comercial
                  antes da emissão dos documentos.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
