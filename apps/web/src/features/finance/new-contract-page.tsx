import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { toast } from 'sonner'

import { FINANCE_CURRENCY } from '@/lib/finance-formatters'
import { Panel, PanelHeader } from '@/components/instrument-panel'
import { Button } from '@/components/ui/button'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { calibraApi } from '@/utils/api'
import {
  useFinanceContractCustomerOptionsData,
  useFinanceContractServiceOptionsData,
} from '@/features/finance/queries'
import {
  ServiceTermsEditor,
  createEmptyServiceTerm,
  type ServiceTermDraft,
} from '@/features/finance/service-terms-editor'

export function NewFinanceContractPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [customerId, setCustomerId] = useState('')
  const [title, setTitle] = useState('')
  const [agreementCode, setAgreementCode] = useState('')
  const currency = FINANCE_CURRENCY
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  )
  const [effectiveTo, setEffectiveTo] = useState('')
  const [defaultPaymentTermDays, setDefaultPaymentTermDays] = useState('28')
  const [notes, setNotes] = useState('')
  const [serviceTerms, setServiceTerms] = useState<ServiceTermDraft[]>(() => [
    createEmptyServiceTerm(),
  ])

  const customersQuery = useFinanceContractCustomerOptionsData()
  const servicesQuery = useFinanceContractServiceOptionsData()

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!customerId) {
        throw new Error('Selecione um cliente para o contrato')
      }
      return calibraApi.finance.createContract<{ data: { id: number } }>({
        customerId: Number(customerId),
        title,
        agreementCode: agreementCode || undefined,
        currency,
        effectiveFrom: new Date(effectiveFrom).toISOString(),
        effectiveTo: effectiveTo
          ? new Date(effectiveTo).toISOString()
          : undefined,
        defaultPaymentTermDays: Number(defaultPaymentTermDays) || 28,
        notes: notes || undefined,
        unitIds: [],
        serviceTerms: serviceTerms
          .filter((term) => term.serviceId)
          .map((term) => ({
            serviceId: Number(term.serviceId),
            priceCents: term.priceCents,
            currency: FINANCE_CURRENCY,
            isActive: true,
          })),
      })
    },
    onSuccess: (result) => {
      toast.success('Contrato comercial criado')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'contracts'],
        refetchType: 'active',
      })
      navigate({
        to: '/dashboard/finance/contracts/$id',
        params: { id: String(result.data.id) },
      })
    },
    onError: (error) => toast.error(error.message),
  })

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/finance/contracts' })}
          className="w-fit"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
          Voltar para contratos
        </Button>
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight">
            Novo contrato comercial
          </h2>
          <p className="max-w-2xl text-muted-foreground">
            O contrato define vigência, prazo padrão e preço negociado por
            serviço.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
        <Panel className="p-5">
          <PanelHeader
            title="Dados do contrato"
            description="Cliente e referência comercial visível nas cobranças."
          />
          <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2">
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
                    <SelectItem key={customer.id} value={String(customer.id)}>
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
        </Panel>

        <Panel className="p-5">
          <PanelHeader
            title="Condições comerciais"
            description="Prazo padrão e janela de vigência usados na emissão."
          />
          <FieldGroup className="mt-4 grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Prazo padrão de pagamento (dias)</FieldLabel>
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
        </Panel>
      </div>

      <Panel className="p-5">
        <PanelHeader
          title="Preços por serviço"
          description="Cada termo congela o preço negociado usado no snapshot comercial do job."
        />
        <div className="mt-4">
          <ServiceTermsEditor
            value={serviceTerms}
            onChange={setServiceTerms}
            services={servicesQuery.data?.data ?? []}
          />
        </div>
      </Panel>

      <Panel className="p-5">
        <PanelHeader
          title="Observações internas"
          description="Descontos acordados, exceções ou notas operacionais."
        />
        <Field className="mt-4">
          <FieldLabel className="sr-only">Observações</FieldLabel>
          <Textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            className="min-h-28"
            placeholder="Notas internas do contrato…"
          />
        </Field>
      </Panel>

      <div className="flex flex-col gap-2 border-t pt-4 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: '/dashboard/finance/contracts' })}
        >
          Cancelar
        </Button>
        <Button
          type="button"
          onClick={() => createMutation.mutate()}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Criando…' : 'Criar contrato'}
        </Button>
      </div>
    </div>
  )
}
