import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSeparator,
} from '@/components/ui/field'

export const Route = createFileRoute('/dashboard/service-orders/new')({
  head: () => ({ meta: [{ title: 'Nova OS | CalibraFácil' }] }),
  component: NewServiceOrderPage,
})

type IntakeType =
  | 'counter'
  | 'carrier'
  | 'third_party'
  | 'internal'
  | 'warranty_return'
type Priority = 'normal' | 'urgent' | 'contract' | 'warranty'
type DeliveryMethod = 'pickup_at_lab' | 'ship_to_client' | 'third_party_pickup'

type FormData = {
  customerId: number | null
  assetId: number | null
  intakeType: IntakeType
  priority: Priority
  deliveryMethod: DeliveryMethod
  claimedDefect: string
  intakeCondition: string
  accessories: string
  oldSealNumber: string
  invoiceRemittanceNumber: string
  invoiceRemittanceKey: string
  carrierName: string
  carrierDocument: string
  thirdPartyName: string
  thirdPartyDocument: string
  thirdPartyPhone: string
  clientVisibleNotes: string
  internalNotes: string
  evaluationFeeCents: string
}

type Customer = {
  id: number
  name: string
  taxId: string | null
  email: string | null
  phone: string | null
  compliance?: {
    qualificationStatus?: 'pending' | 'qualified' | 'suspended' | 'expired'
  } | null
}

type Asset = {
  id: number
  customerId: number
  customerName: string
  name: string
  tag: string
  serialNumber: string | null
  manufacturer: string | null
  model: string | null
  assetTypeName: string | null
  status: string
}

const initialFormData: FormData = {
  customerId: null,
  assetId: null,
  intakeType: 'counter',
  priority: 'normal',
  deliveryMethod: 'pickup_at_lab',
  claimedDefect: '',
  intakeCondition: '',
  accessories: '',
  oldSealNumber: '',
  invoiceRemittanceNumber: '',
  invoiceRemittanceKey: '',
  carrierName: '',
  carrierDocument: '',
  thirdPartyName: '',
  thirdPartyDocument: '',
  thirdPartyPhone: '',
  clientVisibleNotes: '',
  internalNotes: '',
  evaluationFeeCents: '',
}

function toOptional(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function centsFromCurrency(value: string) {
  if (!value.trim()) return 0
  return Math.max(0, Math.round(Number(value.replace(',', '.')) * 100))
}

function NewServiceOrderPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [customerSearch, setCustomerSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )

  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', 'service-order-open', customerSearch],
    queryFn: () =>
      calibraApi.customers.list({
        page: 1,
        limit: 100,
        query: customerSearch.trim() || undefined,
      }) as Promise<{ data: Array<Customer> }>,
  })

  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: [
      'assets',
      'service-order-open',
      formData.customerId,
      assetSearch,
    ],
    queryFn: () => {
      if (!formData.customerId) return { data: [] }

      return calibraApi.assets.list({
        page: 1,
        limit: 100,
        customerId: formData.customerId,
        query: assetSearch.trim() || undefined,
      }) as Promise<{ data: Array<Asset> }>
    },
    enabled: !!formData.customerId,
  })

  const selectedCustomer = useMemo(() => {
    if (!formData.customerId) return null
    return (
      customersData?.data.find((item) => item.id === formData.customerId) ??
      null
    )
  }, [customersData?.data, formData.customerId])

  const selectedAsset = useMemo(() => {
    if (!formData.assetId) return null
    return assetsData?.data.find((item) => item.id === formData.assetId) ?? null
  }, [assetsData?.data, formData.assetId])

  const selectedCustomerName = selectedCustomer?.name ?? ''
  const selectedAssetLabel = selectedAsset
    ? `${selectedAsset.name} (${selectedAsset.tag})`
    : ''
  const selectedCustomerIsSuspended =
    selectedCustomer?.compliance?.qualificationStatus === 'suspended'

  const createMutation = useMutation({
    mutationFn: async () => {
      return calibraApi.serviceOrders.create({
        customerId: formData.customerId!,
        assetId: formData.assetId!,
        intakeType: formData.intakeType,
        priority: formData.priority,
        deliveryMethod: formData.deliveryMethod,
        claimedDefect: formData.claimedDefect.trim(),
        intakeCondition: formData.intakeCondition.trim(),
        accessories: toOptional(formData.accessories),
        oldSealNumber: toOptional(formData.oldSealNumber),
        invoiceRemittanceNumber: toOptional(formData.invoiceRemittanceNumber),
        invoiceRemittanceKey: toOptional(formData.invoiceRemittanceKey),
        carrierName:
          formData.intakeType === 'carrier'
            ? toOptional(formData.carrierName)
            : null,
        carrierDocument:
          formData.intakeType === 'carrier'
            ? toOptional(formData.carrierDocument)
            : null,
        thirdPartyName:
          formData.intakeType === 'third_party'
            ? toOptional(formData.thirdPartyName)
            : null,
        thirdPartyDocument:
          formData.intakeType === 'third_party'
            ? toOptional(formData.thirdPartyDocument)
            : null,
        thirdPartyPhone:
          formData.intakeType === 'third_party'
            ? toOptional(formData.thirdPartyPhone)
            : null,
        clientVisibleNotes: toOptional(formData.clientVisibleNotes),
        internalNotes: toOptional(formData.internalNotes),
        evaluationFeeCents: centsFromCurrency(formData.evaluationFeeCents),
      })
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['service-orders'] })
      toast.success('OS criada com comprovante e etiqueta em processamento')
      navigate({
        to: '/dashboard/service-orders/$id',
        params: { id: String(result.data.id) },
      })
    },
    onError: (error) => toast.error(error.message),
  })

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
  ) => {
    setFormData((current) => {
      const next = { ...current, [field]: value }
      if (field === 'customerId') {
        next.assetId = null
        setAssetSearch('')
      }
      if (field === 'intakeType' && value !== 'carrier') {
        next.carrierName = ''
        next.carrierDocument = ''
      }
      if (field === 'intakeType' && value !== 'third_party') {
        next.thirdPartyName = ''
        next.thirdPartyDocument = ''
        next.thirdPartyPhone = ''
      }
      if (field === 'intakeType' && value === 'warranty_return') {
        next.priority = 'warranty'
      }
      return next
    })

    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }))
    }
  }

  const validate = () => {
    const nextErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.customerId) nextErrors.customerId = 'Selecione um cliente'
    if (!formData.assetId) nextErrors.assetId = 'Selecione um instrumento'
    if (!formData.claimedDefect.trim()) {
      nextErrors.claimedDefect = 'Informe o defeito reclamado'
    }
    if (!formData.intakeCondition.trim()) {
      nextErrors.intakeCondition = 'Informe a condição aparente de recebimento'
    }
    if (formData.intakeType === 'carrier' && !formData.carrierName.trim()) {
      nextErrors.carrierName = 'Informe a transportadora'
    }
    if (
      formData.intakeType === 'third_party' &&
      !formData.thirdPartyName.trim()
    ) {
      nextErrors.thirdPartyName = 'Informe o portador terceiro'
    }

    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!validate() || selectedCustomerIsSuspended) return
    createMutation.mutate()
  }

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => navigate({ to: '/dashboard/service-orders' })}
      >
        <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 size-4" />
        Voltar
      </Button>

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardHeader>
            <CardTitle>Nova Ordem de Serviço</CardTitle>
            <CardDescription>
              Selecione o cliente e o instrumento antes de registrar o
              recebimento.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit}>
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel>Cliente *</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        render={<Link to="/dashboard/clients/new" />}
                      >
                        <HugeiconsIcon
                          icon={PlusSignIcon}
                          className="mr-1 size-3"
                        />
                        Novo cliente
                      </Button>
                    </div>
                    <Combobox
                      value={
                        formData.customerId ? String(formData.customerId) : ''
                      }
                      onValueChange={(value) => {
                        updateField('customerId', value ? Number(value) : null)
                        setCustomerSearch('')
                      }}
                      disabled={createMutation.isPending}
                    >
                      <ComboboxInput
                        placeholder="Buscar por nome, CNPJ/CPF ou email"
                        value={selectedCustomerName || customerSearch}
                        onChange={(event) => {
                          if (formData.customerId) {
                            updateField('customerId', null)
                          }
                          setCustomerSearch(event.target.value)
                        }}
                        showClear={!!formData.customerId || !!customerSearch}
                      />
                      <ComboboxContent>
                        <ComboboxList>
                          <ComboboxEmpty>
                            {customersLoading
                              ? 'Carregando clientes...'
                              : 'Nenhum cliente encontrado'}
                          </ComboboxEmpty>
                          {customersData?.data.map((customer) => (
                            <ComboboxItem
                              key={customer.id}
                              value={String(customer.id)}
                            >
                              <div className="flex flex-col">
                                <span>{customer.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  {[customer.taxId, customer.email]
                                    .filter(Boolean)
                                    .join(' | ') || 'Sem documento/email'}
                                </span>
                              </div>
                            </ComboboxItem>
                          ))}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    {errors.customerId && (
                      <FieldError>{errors.customerId}</FieldError>
                    )}
                    {selectedCustomerIsSuspended && (
                      <FieldError>
                        Cliente suspenso. Regularize a qualificação antes de
                        abrir uma nova OS.
                      </FieldError>
                    )}
                  </Field>

                  <Field>
                    <div className="flex items-center justify-between gap-3">
                      <FieldLabel>Instrumento *</FieldLabel>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!formData.customerId}
                        render={<Link to="/dashboard/assets/new" />}
                      >
                        <HugeiconsIcon
                          icon={PlusSignIcon}
                          className="mr-1 size-3"
                        />
                        Novo ativo
                      </Button>
                    </div>
                    <Combobox
                      value={formData.assetId ? String(formData.assetId) : ''}
                      onValueChange={(value) => {
                        updateField('assetId', value ? Number(value) : null)
                        setAssetSearch('')
                      }}
                      disabled={
                        !formData.customerId || createMutation.isPending
                      }
                    >
                      <ComboboxInput
                        placeholder={
                          formData.customerId
                            ? 'Buscar por nome, patrimônio, série ou modelo'
                            : 'Selecione um cliente primeiro'
                        }
                        value={selectedAssetLabel || assetSearch}
                        onChange={(event) => {
                          if (formData.assetId) {
                            updateField('assetId', null)
                          }
                          setAssetSearch(event.target.value)
                        }}
                        showClear={!!formData.assetId || !!assetSearch}
                      />
                      <ComboboxContent>
                        <ComboboxList>
                          <ComboboxEmpty>
                            {assetsLoading
                              ? 'Carregando instrumentos...'
                              : 'Nenhum instrumento encontrado para este cliente'}
                          </ComboboxEmpty>
                          {assetsData?.data.map((asset) => (
                            <ComboboxItem
                              key={asset.id}
                              value={String(asset.id)}
                            >
                              <div className="flex flex-col">
                                <span>
                                  {asset.name}{' '}
                                  <span className="text-muted-foreground">
                                    ({asset.tag})
                                  </span>
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {[
                                    asset.assetTypeName,
                                    asset.manufacturer,
                                    asset.model,
                                    asset.serialNumber
                                      ? `S/N ${asset.serialNumber}`
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' | ')}
                                </span>
                              </div>
                            </ComboboxItem>
                          ))}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    {errors.assetId && (
                      <FieldError>{errors.assetId}</FieldError>
                    )}
                    <FieldDescription>
                      A OS é uma por instrumento; o sistema congela estes dados
                      no comprovante.
                    </FieldDescription>
                  </Field>
                </div>

                <FieldSeparator>Recebimento</FieldSeparator>

                <div className="grid gap-4 md:grid-cols-3">
                  <Field>
                    <FieldLabel>Tipo de entrada</FieldLabel>
                    <NativeSelect
                      value={formData.intakeType}
                      onChange={(event) =>
                        updateField(
                          'intakeType',
                          event.target.value as IntakeType,
                        )
                      }
                      className="w-full"
                    >
                      <NativeSelectOption value="counter">
                        Balcão
                      </NativeSelectOption>
                      <NativeSelectOption value="carrier">
                        Transportadora
                      </NativeSelectOption>
                      <NativeSelectOption value="third_party">
                        Portador terceiro
                      </NativeSelectOption>
                      <NativeSelectOption value="internal">
                        Interna
                      </NativeSelectOption>
                      <NativeSelectOption value="warranty_return">
                        Retorno em garantia
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>

                  <Field>
                    <FieldLabel>Condição operacional</FieldLabel>
                    <NativeSelect
                      value={formData.priority}
                      onChange={(event) =>
                        updateField('priority', event.target.value as Priority)
                      }
                      className="w-full"
                    >
                      <NativeSelectOption value="normal">
                        Normal
                      </NativeSelectOption>
                      <NativeSelectOption value="urgent">
                        Urgente
                      </NativeSelectOption>
                      <NativeSelectOption value="contract">
                        Contrato
                      </NativeSelectOption>
                      <NativeSelectOption value="warranty">
                        Garantia
                      </NativeSelectOption>
                    </NativeSelect>
                    <FieldDescription>
                      Quando marcado como garantia, o comprovante destaca o
                      serviço solicitado como atendimento em garantia.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel>Entrega prevista</FieldLabel>
                    <NativeSelect
                      value={formData.deliveryMethod}
                      onChange={(event) =>
                        updateField(
                          'deliveryMethod',
                          event.target.value as DeliveryMethod,
                        )
                      }
                      className="w-full"
                    >
                      <NativeSelectOption value="pickup_at_lab">
                        Retirada no laboratório
                      </NativeSelectOption>
                      <NativeSelectOption value="ship_to_client">
                        Envio ao cliente
                      </NativeSelectOption>
                      <NativeSelectOption value="third_party_pickup">
                        Retirada por terceiro
                      </NativeSelectOption>
                    </NativeSelect>
                  </Field>
                </div>

                {formData.intakeType === 'carrier' && (
                  <div className="grid gap-4 md:grid-cols-2">
                    <Field>
                      <FieldLabel>Transportadora *</FieldLabel>
                      <Input
                        value={formData.carrierName}
                        onChange={(event) =>
                          updateField('carrierName', event.target.value)
                        }
                      />
                      {errors.carrierName && (
                        <FieldError>{errors.carrierName}</FieldError>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel>Documento da transportadora</FieldLabel>
                      <Input
                        value={formData.carrierDocument}
                        onChange={(event) =>
                          updateField('carrierDocument', event.target.value)
                        }
                      />
                    </Field>
                  </div>
                )}

                {formData.intakeType === 'third_party' && (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Field>
                      <FieldLabel>Portador *</FieldLabel>
                      <Input
                        value={formData.thirdPartyName}
                        onChange={(event) =>
                          updateField('thirdPartyName', event.target.value)
                        }
                      />
                      {errors.thirdPartyName && (
                        <FieldError>{errors.thirdPartyName}</FieldError>
                      )}
                    </Field>
                    <Field>
                      <FieldLabel>Documento</FieldLabel>
                      <Input
                        value={formData.thirdPartyDocument}
                        onChange={(event) =>
                          updateField('thirdPartyDocument', event.target.value)
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel>Telefone</FieldLabel>
                      <Input
                        value={formData.thirdPartyPhone}
                        onChange={(event) =>
                          updateField('thirdPartyPhone', event.target.value)
                        }
                      />
                    </Field>
                  </div>
                )}

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Defeito reclamado *</FieldLabel>
                    <Textarea
                      value={formData.claimedDefect}
                      onChange={(event) =>
                        updateField('claimedDefect', event.target.value)
                      }
                      placeholder="Descreva a reclamação do cliente"
                    />
                    {errors.claimedDefect && (
                      <FieldError>{errors.claimedDefect}</FieldError>
                    )}
                  </Field>
                  <Field>
                    <FieldLabel>Condição aparente *</FieldLabel>
                    <Textarea
                      value={formData.intakeCondition}
                      onChange={(event) =>
                        updateField('intakeCondition', event.target.value)
                      }
                      placeholder="Estado físico, danos, sujeira, lacres, embalagem"
                    />
                    {errors.intakeCondition && (
                      <FieldError>{errors.intakeCondition}</FieldError>
                    )}
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Acessórios recebidos</FieldLabel>
                    <Input
                      value={formData.accessories}
                      onChange={(event) =>
                        updateField('accessories', event.target.value)
                      }
                      placeholder="Fonte, cabo, maleta, adaptadores"
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Taxa de avaliação</FieldLabel>
                    <Input
                      value={formData.evaluationFeeCents}
                      onChange={(event) =>
                        updateField('evaluationFeeCents', event.target.value)
                      }
                      inputMode="decimal"
                      placeholder="0,00"
                    />
                    <FieldDescription>
                      Opcional, aplicada se o orçamento for recusado.
                    </FieldDescription>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Lacre antigo</FieldLabel>
                    <Input
                      value={formData.oldSealNumber}
                      onChange={(event) =>
                        updateField('oldSealNumber', event.target.value)
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>NF de remessa</FieldLabel>
                    <Input
                      value={formData.invoiceRemittanceNumber}
                      onChange={(event) =>
                        updateField(
                          'invoiceRemittanceNumber',
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Chave NF-e</FieldLabel>
                    <Input
                      value={formData.invoiceRemittanceKey}
                      onChange={(event) =>
                        updateField('invoiceRemittanceKey', event.target.value)
                      }
                    />
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Observação visível ao cliente</FieldLabel>
                    <Textarea
                      value={formData.clientVisibleNotes}
                      onChange={(event) =>
                        updateField('clientVisibleNotes', event.target.value)
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Observação interna</FieldLabel>
                    <Textarea
                      value={formData.internalNotes}
                      onChange={(event) =>
                        updateField('internalNotes', event.target.value)
                      }
                    />
                  </Field>
                </div>

                <div className="flex justify-end gap-3 border-t pt-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() =>
                      navigate({ to: '/dashboard/service-orders' })
                    }
                    disabled={createMutation.isPending}
                  >
                    Cancelar
                  </Button>
                  <Button
                    type="submit"
                    disabled={
                      createMutation.isPending ||
                      selectedCustomerIsSuspended ||
                      !formData.customerId ||
                      !formData.assetId
                    }
                  >
                    {createMutation.isPending
                      ? 'Criando...'
                      : 'Criar OS e emitir comprovante'}
                  </Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader>
            <CardTitle className="text-base">Resumo do recebimento</CardTitle>
            <CardDescription>
              Confirme os dados antes de emitir o comprovante.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <SummaryItem
              label="Cliente"
              value={selectedCustomer?.name}
              detail={[selectedCustomer?.taxId, selectedCustomer?.email]
                .filter(Boolean)
                .join(' | ')}
            />
            <SummaryItem
              label="Instrumento"
              value={selectedAsset?.name}
              detail={[
                selectedAsset?.tag,
                selectedAsset?.assetTypeName,
                selectedAsset?.serialNumber
                  ? `S/N ${selectedAsset.serialNumber}`
                  : null,
              ]
                .filter(Boolean)
                .join(' | ')}
            />
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Entrada
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="secondary">
                  {formData.intakeType === 'counter'
                    ? 'Balcão'
                    : formData.intakeType === 'carrier'
                      ? 'Transportadora'
                      : formData.intakeType === 'third_party'
                        ? 'Portador terceiro'
                        : formData.intakeType === 'warranty_return'
                          ? 'Retorno em garantia'
                          : 'Interna'}
                </Badge>
                <Badge variant="outline">{formData.priority}</Badge>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase text-muted-foreground">
                Próximos passos
              </p>
              <ul className="mt-2 space-y-2 text-sm text-muted-foreground">
                <li className="flex gap-2">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="mt-0.5 size-4 text-primary"
                  />
                  Número único de OS
                </li>
                <li className="flex gap-2">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="mt-0.5 size-4 text-primary"
                  />
                  Snapshot do instrumento
                </li>
                <li className="flex gap-2">
                  <HugeiconsIcon
                    icon={CheckmarkCircle02Icon}
                    className="mt-0.5 size-4 text-primary"
                  />
                  Comprovante de recebimento e etiqueta
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function SummaryItem({
  label,
  value,
  detail,
}: {
  label: string
  value?: string | null
  detail?: string | null
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      {value ? (
        <div className="mt-1">
          <div className="flex items-center gap-2">
            <HugeiconsIcon
              icon={CheckmarkCircle02Icon}
              className="size-4 text-primary"
            />
            <p className="font-medium">{value}</p>
          </div>
          {detail && (
            <p className="ml-6 text-xs text-muted-foreground">{detail}</p>
          )}
        </div>
      ) : (
        <p className="mt-1 text-sm text-muted-foreground">Não selecionado</p>
      )}
    </div>
  )
}
