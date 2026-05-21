import { Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  PlusSignIcon,
} from '@hugeicons/core-free-icons'

import { calibraApi } from '@/utils/api'
import {
  useNewServiceOrderAssetsData,
  useNewServiceOrderCustomersData,
} from '@/features/service-orders/queries'
import {
  parseServiceOrderForm,
  type ServiceOrderCreatePayload,
  type ServiceOrderFormData,
  type ServiceOrderFormField,
} from '@/features/service-orders/forms'
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

const initialFormData: ServiceOrderFormData = {
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

export function NewServiceOrderPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [formData, setFormData] =
    useState<ServiceOrderFormData>(initialFormData)
  const [customerSearch, setCustomerSearch] = useState('')
  const [assetSearch, setAssetSearch] = useState('')
  const [errors, setErrors] = useState<
    Partial<Record<ServiceOrderFormField, string>>
  >({})

  const { data: customersData, isLoading: customersLoading } =
    useNewServiceOrderCustomersData(customerSearch)
  const { data: assetsData, isLoading: assetsLoading } =
    useNewServiceOrderAssetsData({
      customerId: formData.customerId,
      search: assetSearch,
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
    mutationFn: async (data: ServiceOrderCreatePayload) =>
      calibraApi.serviceOrders.create(data),
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

  const updateField = <TKey extends keyof ServiceOrderFormData>(
    field: TKey,
    value: ServiceOrderFormData[TKey],
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

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (selectedCustomerIsSuspended) return

    const parsed = parseServiceOrderForm(formData)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((error) => [error.field, error.message]),
        ),
      )
      toast.error(parsed.message)
      return
    }

    setErrors({})
    createMutation.mutate(parsed.data)
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
                          event.target
                            .value as ServiceOrderFormData['intakeType'],
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
                        updateField(
                          'priority',
                          event.target
                            .value as ServiceOrderFormData['priority'],
                        )
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
                          event.target
                            .value as ServiceOrderFormData['deliveryMethod'],
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
