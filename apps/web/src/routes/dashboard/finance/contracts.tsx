import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  Building02Icon,
  Delete02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import {
  CommercialAgreementStatusBadge,
  formatFinanceDate,
  formatFinanceMoney,
} from '@/components/finance/finance-ui'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/utils/api'

type ContractListItem = {
  id: number
  customerId: number
  customerName: string
  status: string
  agreementCode: string | null
  title: string
  currency: string
  effectiveFrom: string
  effectiveTo: string | null
  defaultPaymentTermDays: number
  updatedAt: string
}

type SelectOption = {
  id: number
  name: string
}

type ServiceTermDraft = {
  serviceId: string
  priceAmount: string
}

function createEmptyServiceTerm(): ServiceTermDraft {
  return {
    serviceId: '',
    priceAmount: '',
  }
}

const FINANCE_CURRENCY = 'BRL'

function parseCurrencyInputToCents(value: string) {
  const normalized = value.replace(/\s/g, '').replace(',', '.')
  const parsed = Number.parseFloat(normalized)

  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return Math.round(parsed * 100)
}

export const Route = createFileRoute('/dashboard/finance/contracts')({
  head: () => ({
    meta: [{ title: 'Contratos comerciais | CalibraFácil' }],
  }),
  component: FinanceContractsPage,
})

function FinanceContractsPage() {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [customerId, setCustomerId] = useState('')
  const [title, setTitle] = useState('')
  const [agreementCode, setAgreementCode] = useState('')
  const [currency, setCurrency] = useState(FINANCE_CURRENCY)
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [effectiveTo, setEffectiveTo] = useState('')
  const [defaultPaymentTermDays, setDefaultPaymentTermDays] = useState('28')
  const [notes, setNotes] = useState('')
  const [serviceTerms, setServiceTerms] = useState<ServiceTermDraft[]>([
    createEmptyServiceTerm(),
  ])

  const contractsQuery = useQuery({
    queryKey: ['finance', 'contracts', query],
    queryFn: async () => {
      const response = await api.api.finance.contracts.$get({
        query: { query: query || undefined },
      })
      if (!response.ok) {
        throw new Error('Erro ao carregar contratos')
      }

      return response.json() as Promise<{ data: ContractListItem[] }>
    },
  })

  const customersQuery = useQuery({
    queryKey: ['finance', 'contract-form', 'customers'],
    queryFn: async () => {
      const response = await api.api.customers.$get({
        query: { page: '1', limit: '100' },
      })
      if (!response.ok) {
        throw new Error('Erro ao carregar clientes')
      }

      return response.json() as Promise<{ data: SelectOption[] }>
    },
  })

  const servicesQuery = useQuery({
    queryKey: ['finance', 'contract-form', 'services'],
    queryFn: async () => {
      const response = await api.api.services.$get({
        query: { page: '1', limit: '100', isActive: 'true' },
      })
      if (!response.ok) {
        throw new Error('Erro ao carregar serviços')
      }

      return response.json() as Promise<{
        data: Array<{ id: number; name: string; price: number | null; currency: string }>
      }>
    },
  })

  const servicePriceLookup = useMemo(
    () =>
      new Map(
        (servicesQuery.data?.data ?? []).map((service) => [service.id, service]),
      ),
    [servicesQuery.data],
  )

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) {
        throw new Error('Selecione um cliente para o contrato')
      }

      const payload = {
        customerId: Number(customerId),
        title,
        agreementCode: agreementCode || undefined,
        currency,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        effectiveTo: effectiveTo ? new Date(effectiveTo).toISOString() : undefined,
        defaultPaymentTermDays: Number(defaultPaymentTermDays) || 28,
        notes: notes || undefined,
        unitIds: [],
        serviceTerms: serviceTerms.map((term) => ({
          serviceId: Number(term.serviceId),
          priceCents: parseCurrencyInputToCents(term.priceAmount),
          currency: FINANCE_CURRENCY,
          isActive: true,
        })),
      }

      const response = await api.api.finance.contracts.$post({
        json: payload,
      })

      if (!response.ok) {
        const error = (await response.json()) as { error?: string }
        throw new Error(error.error || 'Erro ao criar contrato')
      }

      return response.json()
    },
    onSuccess: () => {
      toast.success('Contrato comercial criado')
      queryClient.invalidateQueries({ queryKey: ['finance', 'contracts'] })
      setDialogOpen(false)
      resetForm()
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  function resetForm() {
    setCustomerId('')
    setTitle('')
    setAgreementCode('')
    setCurrency(FINANCE_CURRENCY)
    setEffectiveFrom(new Date().toISOString().slice(0, 10))
    setEffectiveTo('')
    setDefaultPaymentTermDays('28')
    setNotes('')
    setServiceTerms([createEmptyServiceTerm()])
  }

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
          <Button onClick={() => setDialogOpen(true)}>
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
                      <CommercialAgreementStatusBadge status={contract.status} />
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
                    <TableCell>{contract.defaultPaymentTermDays} dias</TableCell>
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-5xl gap-0 overflow-hidden p-0 sm:max-w-[1100px]">
          <DialogHeader className="border-b px-6 pt-6 pb-4">
            <DialogTitle>Novo contrato comercial</DialogTitle>
            <DialogDescription>
              O contrato define vigência, prazo padrão e preço negociado por
              serviço.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[calc(92vh-9.5rem)] overflow-y-auto px-6 py-5">
            <div className="space-y-6">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
                <section className="space-y-5 rounded-2xl border bg-muted/20 p-5">
                  <div className="space-y-1">
                    <h3 className="font-medium">Dados do contrato</h3>
                    <p className="text-muted-foreground text-sm">
                      Identifique o cliente e a referência comercial que ficará
                      visível nas cobranças.
                    </p>
                  </div>

                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <Field className="md:col-span-2">
                      <FieldLabel>Cliente</FieldLabel>
                      <Select
                        value={customerId || undefined}
                        onValueChange={(value) => setCustomerId(value ?? '')}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Selecione um cliente" />
                        </SelectTrigger>
                        <SelectContent align="start">
                          {(customersQuery.data?.data ?? []).map((customer) => (
                            <SelectItem
                              key={customer.id}
                              value={String(customer.id)}
                            >
                              {customer.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field>
                      <FieldLabel>Título</FieldLabel>
                      <Input
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        placeholder="Ex: Contrato matriz 2026"
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Código do contrato</FieldLabel>
                      <Input
                        value={agreementCode}
                        onChange={(event) => setAgreementCode(event.target.value)}
                        placeholder="Ex: AC-2026-001"
                      />
                    </Field>
                  </FieldGroup>
                </section>

                <section className="space-y-5 rounded-2xl border bg-muted/20 p-5">
                  <div className="space-y-1">
                    <h3 className="font-medium">Condições comerciais</h3>
                    <p className="text-muted-foreground text-sm">
                      Vigência e prazo padrão usados na emissão.
                    </p>
                  </div>

                  <FieldGroup className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>Prazo padrão de pagamento</FieldLabel>
                      <Input
                        type="number"
                        min={1}
                        max={180}
                        value={defaultPaymentTermDays}
                        onChange={(event) =>
                          setDefaultPaymentTermDays(event.target.value)
                        }
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Início da vigência</FieldLabel>
                      <Input
                        type="date"
                        value={effectiveFrom}
                        onChange={(event) => setEffectiveFrom(event.target.value)}
                      />
                    </Field>

                    <Field>
                      <FieldLabel>Fim da vigência</FieldLabel>
                      <Input
                        type="date"
                        value={effectiveTo}
                        onChange={(event) => setEffectiveTo(event.target.value)}
                      />
                    </Field>
                  </FieldGroup>
                </section>
              </div>

              <section className="space-y-4 rounded-2xl border bg-muted/20 p-5">
                <div className="space-y-1">
                  <h3 className="font-medium">Observações internas</h3>
                  <p className="text-muted-foreground text-sm">
                    Registre descontos, exceções ou notas operacionais do
                    contrato.
                  </p>
                </div>

                <Field>
                  <FieldLabel>Observações</FieldLabel>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="min-h-28"
                    placeholder="Condições comerciais, descontos acordados, notas internas..."
                  />
                </Field>
              </section>

              <section className="space-y-4 rounded-2xl border bg-muted/20 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <h3 className="font-medium">Tabela negociada por serviço</h3>
                    <p className="text-muted-foreground max-w-2xl text-sm">
                      Cada termo congela o snapshot comercial usado no job e
                      mantém a referência de preço negociado por serviço.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      setServiceTerms((current) => [
                        ...current,
                        createEmptyServiceTerm(),
                      ])
                    }
                  >
                    <HugeiconsIcon icon={PlusSignIcon} className="mr-2 size-4" />
                    Adicionar termo
                  </Button>
                </div>

                <div className="space-y-3">
                  {serviceTerms.map((term, index) => (
                    <div
                      key={`${index}-${term.serviceId}`}
                      className="rounded-2xl border bg-background p-4 shadow-sm"
                    >
                      <div className="hidden grid-cols-[minmax(0,2fr)_220px_48px] gap-4 border-b px-1 pb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase md:grid">
                        <span>Serviço</span>
                        <span>Preço negociado</span>
                        <span className="sr-only">Ações</span>
                      </div>

                      <div className="mt-0 grid gap-4 md:mt-4 md:grid-cols-[minmax(0,2fr)_220px_48px]">
                        <Field>
                          <FieldLabel className="md:sr-only">Serviço</FieldLabel>
                          <Select
                            value={term.serviceId || undefined}
                            onValueChange={(value) => {
                              const nextServiceId = value ?? ''
                              const selectedServiceId = Number(nextServiceId)
                              const selectedService =
                                servicePriceLookup.get(selectedServiceId)

                              setServiceTerms((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? {
                                        ...entry,
                                        serviceId: nextServiceId,
                                        priceAmount:
                                          selectedService?.price != null
                                            ? (selectedService.price / 100)
                                                .toFixed(2)
                                                .replace('.', ',')
                                            : entry.priceAmount,
                                      }
                                    : entry,
                                ),
                              )
                            }}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Selecione um serviço" />
                            </SelectTrigger>
                            <SelectContent align="start">
                              {(servicesQuery.data?.data ?? []).map((service) => (
                                <SelectItem
                                  key={service.id}
                                  value={String(service.id)}
                                >
                                  {service.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>

                        <Field>
                          <FieldLabel className="md:sr-only">Preço negociado</FieldLabel>
                          <Input
                            type="text"
                            inputMode="decimal"
                            value={term.priceAmount}
                            onChange={(event) =>
                              setServiceTerms((current) =>
                                current.map((entry, entryIndex) =>
                                  entryIndex === index
                                    ? { ...entry, priceAmount: event.target.value }
                                    : entry,
                                ),
                              )
                            }
                            placeholder="R$ 150,00"
                          />
                        </Field>

                        <div className="flex items-end md:justify-end">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              setServiceTerms((current) =>
                                current.length === 1
                                  ? current
                                  : current.filter(
                                      (_, entryIndex) => entryIndex !== index,
                                    ),
                              )
                            }
                            disabled={serviceTerms.length === 1}
                          >
                            <HugeiconsIcon
                              icon={Delete02Icon}
                              className="size-4"
                            />
                          </Button>
                        </div>
                      </div>

                      {term.serviceId && term.priceAmount && (
                        <label className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
                          <Checkbox checked={true} disabled />
                          Snapshot inicial estimado:{' '}
                          {formatFinanceMoney(
                            parseCurrencyInputToCents(term.priceAmount),
                            FINANCE_CURRENCY,
                          )}
                        </label>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>

          <DialogFooter className="border-t bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
                resetForm()
              }}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={() => createMutation.mutate()}
              disabled={createMutation.isPending}
            >
              {createMutation.isPending ? 'Criando...' : 'Criar contrato'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
