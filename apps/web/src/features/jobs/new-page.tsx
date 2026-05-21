import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import { InformationCircleIcon } from '@hugeicons/core-free-icons'
import type { CreateJobInput } from '@calibra-facil/schemas'

import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import {
  useJobTechniciansData,
  useNewJobCustomerAssetsData,
  useNewJobCustomersData,
  useNewJobServicesData,
} from '@/features/jobs/queries'
import {
  parseJobForm,
  type JobFormData,
  type JobFormField,
} from '@/features/jobs/forms'

const initialFormData: JobFormData = {
  customerId: null,
  assetId: null,
  serviceId: null,
  technicianId: null,
  dueDate: null,
}

function formatPrice(priceInCents: number | null, currency: string): string {
  if (priceInCents === null) {
    return 'Sob consulta'
  }

  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency || 'BRL',
  }).format(priceInCents / 100)
}

export function NewJobPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<JobFormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<JobFormField, string>>>(
    {},
  )
  const [customerSearch, setCustomerSearch] = useState('')

  const { data: customersData, isLoading: customersLoading } =
    useNewJobCustomersData(customerSearch)

  const { data: assetsData, isLoading: assetsLoading } =
    useNewJobCustomerAssetsData({
      customerId: formData.customerId,
      enabled: !!formData.customerId,
    })

  const selectedAsset = useMemo(() => {
    if (!formData.assetId || !assetsData?.data) return null
    return assetsData.data.find((a) => a.id === formData.assetId) || null
  }, [formData.assetId, assetsData?.data])

  const { data: servicesData, isLoading: servicesLoading } =
    useNewJobServicesData({
      assetTypeId: selectedAsset?.assetTypeId ?? null,
      enabled: !!selectedAsset,
    })

  const { data: techniciansData, isLoading: techniciansLoading } =
    useJobTechniciansData()

  const selectedCustomer = useMemo(() => {
    if (!formData.customerId || !customersData?.data) return null
    return customersData.data.find((c) => c.id === formData.customerId) || null
  }, [formData.customerId, customersData?.data])

  const selectedService = useMemo(() => {
    if (!formData.serviceId || !servicesData?.data) return null
    return servicesData.data.find((s) => s.id === formData.serviceId) || null
  }, [formData.serviceId, servicesData?.data])

  // Computed display values for combobox inputs
  const selectedCustomerName = useMemo(() => {
    return selectedCustomer?.name || ''
  }, [selectedCustomer])

  const customerInputValue = formData.customerId
    ? selectedCustomerName
    : customerSearch

  const selectedCustomerIsSuspended =
    selectedCustomer?.compliance?.qualificationStatus === 'suspended'

  const selectedAssetDisplayName = useMemo(() => {
    if (!selectedAsset) return ''
    return `${selectedAsset.name} (${selectedAsset.tag})`
  }, [selectedAsset])

  const selectedServiceName = useMemo(() => {
    return selectedService?.name || ''
  }, [selectedService])

  const selectedTechnicianName = useMemo(() => {
    if (!formData.technicianId || !techniciansData?.data) return ''
    const tech = techniciansData.data.find(
      (t) => t.id === formData.technicianId,
    )
    return tech?.name || ''
  }, [formData.technicianId, techniciansData?.data])

  const selectedTechnician = useMemo(() => {
    if (!formData.technicianId || !techniciansData?.data) return null
    return (
      techniciansData.data.find((t) => t.id === formData.technicianId) || null
    )
  }, [formData.technicianId, techniciansData?.data])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CreateJobInput) => calibraApi.jobs.create(data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success(`Ordem ${data.jobId} criada com sucesso!`)
      navigate({ to: '/dashboard/jobs' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    const parsed = parseJobForm(formData)
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

  const updateField = <TKey extends keyof JobFormData>(
    field: TKey,
    value: JobFormData[TKey],
  ) => {
    setFormData((prev) => {
      const newData = { ...prev, [field]: value }

      // Reset dependent fields
      if (field === 'customerId') {
        newData.assetId = null
        newData.serviceId = null
      }
      if (field === 'assetId') {
        newData.serviceId = null
      }
      if (field === 'serviceId' && value) {
        const service = servicesData?.data?.find((s) => s.id === Number(value))
        if (service?.tat && !newData.dueDate) {
          const suggestedDueDate = new Date()
          suggestedDueDate.setDate(suggestedDueDate.getDate() + service.tat)
          newData.dueDate = suggestedDueDate
        }
      }

      return newData
    })

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const orderSummary = [
    {
      label: 'Cliente',
      value: selectedCustomer?.name || 'Pendente',
      complete: Boolean(formData.customerId),
    },
    {
      label: 'Ativo',
      value: selectedAsset
        ? `${selectedAsset.name} (${selectedAsset.tag})`
        : 'Pendente',
      complete: Boolean(formData.assetId),
    },
    {
      label: 'Serviço',
      value: selectedService?.name || 'Pendente',
      complete: Boolean(formData.serviceId),
    },
    {
      label: 'Prazo',
      value: formData.dueDate
        ? formData.dueDate.toLocaleDateString('pt-BR')
        : selectedService?.tat
          ? `${selectedService.tat} dias sugeridos`
          : 'Opcional',
      complete: Boolean(formData.dueDate),
    },
  ]

  return (
    <div className="space-y-6">
      <header className="border-b pb-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            Nova Calibração
          </h1>
          <p className="max-w-2xl text-sm text-muted-foreground text-pretty">
            Crie uma ordem a partir do cliente, ativo e serviço publicado; o
            prazo e a equipe podem ser definidos agora ou ajustados depois.
          </p>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <form id="job-registration-form" onSubmit={handleSubmit}>
          <FieldGroup className="gap-0 divide-y">
            <FormSection
              title="Origem"
              description="Cliente qualificado e instrumento que será calibrado."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="customer">Cliente *</FieldLabel>
                  <Combobox
                    value={
                      formData.customerId ? String(formData.customerId) : ''
                    }
                    onValueChange={(value) => {
                      const customerId = value ? Number(value) : null
                      updateField('customerId', customerId)
                      setCustomerSearch(
                        customersData?.data?.find((c) => c.id === customerId)
                          ?.name ?? '',
                      )
                    }}
                    disabled={createMutation.isPending}
                  >
                    <ComboboxInput
                      id="customer"
                      name="customerId"
                      placeholder="Selecionar cliente..."
                      value={customerInputValue}
                      onChange={(e) => {
                        setCustomerSearch(e.target.value)
                        if (formData.customerId) {
                          updateField('customerId', null)
                        }
                      }}
                      autoComplete="off"
                      showClear={Boolean(formData.customerId)}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        <ComboboxEmpty>
                          {customersLoading
                            ? 'Carregando...'
                            : 'Nenhum cliente encontrado'}
                        </ComboboxEmpty>
                        {customersData?.data?.map((customer) => (
                          <ComboboxItem
                            key={customer.id}
                            value={String(customer.id)}
                          >
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">{customer.name}</span>
                              {customer.taxId && (
                                <span className="truncate text-xs text-muted-foreground">
                                  {customer.taxId}
                                </span>
                              )}
                            </div>
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>
                    A ordem só pode avançar com cliente selecionado.
                  </FieldDescription>
                  {errors.customerId && (
                    <FieldError>{errors.customerId}</FieldError>
                  )}
                  {selectedCustomerIsSuspended && (
                    <FieldError>
                      Cliente suspenso. Reative a qualificação em Conformidade
                      antes de criar novas ordens de serviço.
                    </FieldError>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="asset">Ativo *</FieldLabel>
                  <Combobox
                    value={formData.assetId ? String(formData.assetId) : ''}
                    onValueChange={(value) =>
                      updateField('assetId', value ? Number(value) : null)
                    }
                    disabled={!formData.customerId || createMutation.isPending}
                  >
                    <ComboboxInput
                      id="asset"
                      name="assetId"
                      placeholder={
                        formData.customerId
                          ? 'Selecionar ativo...'
                          : 'Selecione um cliente primeiro'
                      }
                      value={selectedAssetDisplayName}
                      autoComplete="off"
                      showClear={Boolean(formData.assetId)}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        <ComboboxEmpty>
                          {assetsLoading
                            ? 'Carregando...'
                            : 'Nenhum ativo encontrado para este cliente'}
                        </ComboboxEmpty>
                        {assetsData?.data?.map((asset) => (
                          <ComboboxItem key={asset.id} value={String(asset.id)}>
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">
                                {asset.name}{' '}
                                <span className="text-muted-foreground">
                                  ({asset.tag})
                                </span>
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                S/N: {asset.serialNumber}
                                {asset.assetTypeName &&
                                  ` | ${asset.assetTypeName}`}
                              </span>
                            </div>
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>
                    A seleção do ativo filtra os serviços compatíveis.
                  </FieldDescription>
                  {errors.assetId && <FieldError>{errors.assetId}</FieldError>}
                </Field>
              </div>
            </FormSection>

            <FormSection
              title="Serviço"
              description="Catálogo comercial, método vinculado, preço e prazo previsto."
            >
              <Field>
                <FieldLabel htmlFor="service">Serviço *</FieldLabel>
                <Combobox
                  value={formData.serviceId ? String(formData.serviceId) : ''}
                  onValueChange={(value) =>
                    updateField('serviceId', value ? Number(value) : null)
                  }
                  disabled={!formData.assetId || createMutation.isPending}
                >
                  <ComboboxInput
                    id="service"
                    name="serviceId"
                    placeholder={
                      formData.assetId
                        ? 'Selecionar serviço...'
                        : 'Selecione um ativo primeiro'
                    }
                    value={selectedServiceName}
                    autoComplete="off"
                    showClear={Boolean(formData.serviceId)}
                  />
                  <ComboboxContent>
                    <ComboboxList>
                      <ComboboxEmpty>
                        {servicesLoading
                          ? 'Carregando...'
                          : selectedAsset?.assetTypeId
                            ? 'Nenhum serviço encontrado para este tipo de ativo'
                            : 'Nenhum serviço encontrado'}
                      </ComboboxEmpty>
                      {servicesData?.data?.map((service) => (
                        <ComboboxItem
                          key={service.id}
                          value={String(service.id)}
                        >
                          <div className="flex min-w-0 flex-col gap-1">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate">{service.name}</span>
                              {service.methodName && (
                                <Badge
                                  variant="outline"
                                  className="max-w-64 truncate text-xs"
                                >
                                  {service.methodName}
                                </Badge>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground">
                              {formatPrice(service.price, service.currency)}
                              {service.tat && ` | ${service.tat} dias`}
                            </span>
                          </div>
                        </ComboboxItem>
                      ))}
                    </ComboboxList>
                  </ComboboxContent>
                </Combobox>
                <FieldDescription>
                  Apenas serviços ativos e compatíveis são exibidos.
                </FieldDescription>
                {errors.serviceId && (
                  <FieldError>{errors.serviceId}</FieldError>
                )}
              </Field>

              {selectedService && (
                <dl className="mt-5 grid gap-4 border-t pt-5 text-sm md:grid-cols-3">
                  <div className="space-y-1">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Preço
                    </dt>
                    <dd className="tabular-nums">
                      {formatPrice(
                        selectedService.price,
                        selectedService.currency,
                      )}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Prazo
                    </dt>
                    <dd className="tabular-nums">
                      {selectedService.tat
                        ? `${selectedService.tat} dias`
                        : 'Não definido'}
                    </dd>
                  </div>
                  <div className="space-y-1">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Método
                    </dt>
                    <dd className="truncate">
                      {selectedService.methodName || 'Não vinculado'}
                    </dd>
                  </div>
                </dl>
              )}
            </FormSection>

            <FormSection
              title="Planejamento"
              description="Responsável técnico e data esperada para conclusão."
            >
              <div className="grid gap-5 md:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="technician">Técnico</FieldLabel>
                  <Combobox
                    value={formData.technicianId || ''}
                    onValueChange={(value) =>
                      updateField('technicianId', value || null)
                    }
                    disabled={createMutation.isPending}
                  >
                    <ComboboxInput
                      id="technician"
                      name="technicianId"
                      placeholder="Atribuir técnico..."
                      value={selectedTechnicianName}
                      autoComplete="off"
                      showClear={Boolean(formData.technicianId)}
                    />
                    <ComboboxContent>
                      <ComboboxList>
                        <ComboboxEmpty>
                          {techniciansLoading
                            ? 'Carregando...'
                            : 'Nenhum técnico encontrado'}
                        </ComboboxEmpty>
                        {techniciansData?.data?.map((tech) => (
                          <ComboboxItem key={tech.id} value={tech.id}>
                            <div className="flex min-w-0 flex-col">
                              <span className="truncate">{tech.name}</span>
                              <span className="truncate text-xs text-muted-foreground">
                                {tech.email}
                              </span>
                            </div>
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                  <FieldDescription>
                    Pode ser atribuído posteriormente.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="dueDate">Prazo</FieldLabel>
                  <DatePicker
                    id="dueDate"
                    name="dueDate"
                    value={formData.dueDate || undefined}
                    onChange={(date) => updateField('dueDate', date || null)}
                    disabled={createMutation.isPending}
                  />
                  {selectedService?.tat && (
                    <FieldDescription>
                      <HugeiconsIcon
                        icon={InformationCircleIcon}
                        className="mr-1 inline size-3"
                      />
                      Sugerido com base no TAT do serviço ({selectedService.tat}{' '}
                      dias).
                    </FieldDescription>
                  )}
                </Field>
              </div>
            </FormSection>

            <div className="flex flex-col-reverse gap-3 pt-6 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: '/dashboard/jobs' })}
                disabled={createMutation.isPending}
                className="active:scale-[0.96] transition-transform"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={
                  createMutation.isPending ||
                  selectedCustomerIsSuspended ||
                  !formData.customerId ||
                  !formData.assetId ||
                  !formData.serviceId
                }
                className="active:scale-[0.96] transition-transform"
              >
                {createMutation.isPending ? 'Criando...' : 'Criar Ordem'}
              </Button>
            </div>
          </FieldGroup>
        </form>

        <aside className="lg:sticky lg:top-20 lg:self-start">
          <div className="border-l pl-5">
            <h2 className="text-sm font-medium">Resumo da Ordem</h2>
            <dl className="mt-4 space-y-4">
              {orderSummary.map((item) => (
                <div key={item.label} className="space-y-1">
                  <dt className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <span
                      className={`size-1.5 rounded-full ${
                        item.complete ? 'bg-primary' : 'bg-muted-foreground/35'
                      }`}
                    />
                    {item.label}
                  </dt>
                  <dd className="min-w-0 truncate text-sm text-foreground">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>

            {(selectedAsset || selectedService || selectedTechnician) && (
              <dl className="mt-5 space-y-4 border-t pt-4">
                {selectedAsset?.assetTypeName && (
                  <div className="space-y-1">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Tipo do ativo
                    </dt>
                    <dd className="text-sm text-foreground">
                      {selectedAsset.assetTypeName}
                    </dd>
                  </div>
                )}
                {selectedService && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Preço
                      </dt>
                      <dd className="text-sm tabular-nums">
                        {formatPrice(
                          selectedService.price,
                          selectedService.currency,
                        )}
                      </dd>
                    </div>
                    <div className="space-y-1">
                      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        TAT
                      </dt>
                      <dd className="text-sm tabular-nums">
                        {selectedService.tat
                          ? `${selectedService.tat} dias`
                          : 'Não definido'}
                      </dd>
                    </div>
                  </div>
                )}
                {selectedTechnician && (
                  <div className="space-y-1">
                    <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Técnico
                    </dt>
                    <dd className="text-sm text-foreground">
                      {selectedTechnician.name}
                    </dd>
                  </div>
                )}
              </dl>
            )}

            <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground text-pretty">
              A ordem será criada em rascunho para execução, revisão e emissão
              do certificado.
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-6 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="space-y-1">
        <h2 className="text-sm font-medium text-balance">{title}</h2>
        {description && (
          <p className="text-sm leading-5 text-muted-foreground text-pretty">
            {description}
          </p>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  )
}
