import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  InformationCircleIcon,
} from '@hugeicons/core-free-icons'

import { api } from '@/utils/api'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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

export const Route = createFileRoute('/dashboard/jobs/new')({
  head: () => ({
    meta: [{ title: 'Nova Ordem de Servico | CalibraFacil' }],
  }),
  component: NewJobPage,
})

interface FormData {
  customerId: number | null
  assetId: number | null
  serviceId: number | null
  technicianId: string | null
  dueDate: Date | null
}

interface Customer {
  id: number
  name: string
  taxId: string | null
}

interface Asset {
  id: number
  name: string
  tag: string
  serialNumber: string
  assetTypeId: number
  assetTypeName: string | null
  customerId: number
}

interface Service {
  id: number
  name: string
  methodId: number | null
  methodName: string | null
  methodStatus: string | null
  assetTypeId: number | null
  price: number | null
  currency: string
  tat: number | null
}

interface Technician {
  id: string
  name: string
  email: string
  role: string
}

const initialFormData: FormData = {
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

function NewJobPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [formData, setFormData] = useState<FormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof FormData, string>>>(
    {},
  )

  // Selected entities for display
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(
    null,
  )
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null)
  const [selectedService, setSelectedService] = useState<Service | null>(null)

  // Fetch customers
  const { data: customersData, isLoading: customersLoading } = useQuery({
    queryKey: ['customers', 'list'],
    queryFn: async () => {
      const res = await api.api.customers.$get({
        query: { limit: '100' },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar clientes')
      }

      return res.json() as Promise<{
        data: Array<Customer>
      }>
    },
  })

  // Fetch assets (filtered by customer)
  const { data: assetsData, isLoading: assetsLoading } = useQuery({
    queryKey: ['assets', 'customer', formData.customerId],
    queryFn: async () => {
      if (!formData.customerId) return { data: [] }

      const res = await api.api.assets.$get({
        query: {
          customerId: String(formData.customerId),
          limit: '100',
        },
      })

      if (!res.ok) {
        throw new Error('Falha ao carregar ativos')
      }

      return res.json() as Promise<{
        data: Array<Asset>
      }>
    },
    enabled: !!formData.customerId,
  })

  // Fetch services (filtered by asset type when asset is selected)
  const { data: servicesData, isLoading: servicesLoading } = useQuery({
    queryKey: ['services', 'for-job', selectedAsset?.assetTypeId],
    queryFn: async () => {
      const query: Record<string, string> = {
        isActive: 'true',
        limit: '100',
      }

      // Filter by asset type if asset is selected
      if (selectedAsset?.assetTypeId) {
        query.assetTypeId = String(selectedAsset.assetTypeId)
      }

      const res = await api.api.services.$get({ query })

      if (!res.ok) {
        throw new Error('Falha ao carregar servicos')
      }

      return res.json() as Promise<{
        data: Array<Service>
      }>
    },
    enabled: !!formData.assetId,
  })

  // Fetch technicians
  const { data: techniciansData, isLoading: techniciansLoading } = useQuery({
    queryKey: ['jobs', 'technicians'],
    queryFn: async () => {
      const res = await api.api.jobs['technicians']['list'].$get()

      if (!res.ok) {
        throw new Error('Falha ao carregar tecnicos')
      }

      return res.json() as Promise<{
        data: Array<Technician>
      }>
    },
  })

  // Reset dependent fields when parent changes
  useEffect(() => {
    if (formData.customerId) {
      // Reset asset and service when customer changes
      const customer = customersData?.data?.find(
        (c) => c.id === formData.customerId,
      )
      setSelectedCustomer(customer || null)
    } else {
      setSelectedCustomer(null)
    }
  }, [formData.customerId, customersData?.data])

  useEffect(() => {
    if (formData.assetId) {
      const asset = assetsData?.data?.find((a) => a.id === formData.assetId)
      setSelectedAsset(asset || null)
    } else {
      setSelectedAsset(null)
    }
  }, [formData.assetId, assetsData?.data])

  useEffect(() => {
    if (formData.serviceId) {
      const service = servicesData?.data?.find(
        (s) => s.id === formData.serviceId,
      )
      setSelectedService(service || null)

      // Auto-suggest due date based on TAT
      if (service?.tat && !formData.dueDate) {
        const suggestedDueDate = new Date()
        suggestedDueDate.setDate(suggestedDueDate.getDate() + service.tat)
        setFormData((prev) => ({ ...prev, dueDate: suggestedDueDate }))
      }
    } else {
      setSelectedService(null)
    }
  }, [formData.serviceId, servicesData?.data])

  // Computed display values for combobox inputs
  const selectedCustomerName = useMemo(() => {
    return selectedCustomer?.name || ''
  }, [selectedCustomer])

  const selectedAssetDisplayName = useMemo(() => {
    if (!selectedAsset) return ''
    return `${selectedAsset.name} (${selectedAsset.tag})`
  }, [selectedAsset])

  const selectedServiceName = useMemo(() => {
    return selectedService?.name || ''
  }, [selectedService])

  const selectedTechnicianName = useMemo(() => {
    if (!formData.technicianId || !techniciansData?.data) return ''
    const tech = techniciansData.data.find((t) => t.id === formData.technicianId)
    return tech?.name || ''
  }, [formData.technicianId, techniciansData?.data])

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const res = await api.api.jobs.$post({
        json: {
          assetId: data.assetId!,
          serviceId: data.serviceId!,
          technicianId: data.technicianId || undefined,
          dueDate: data.dueDate?.toISOString() || undefined,
        },
      })

      if (!res.ok) {
        const error = await res.json()
        throw new Error(
          (error as { error?: string }).error || 'Erro ao criar ordem',
        )
      }

      return res.json() as Promise<{ id: number; jobId: string }>
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success(`Ordem ${data.jobId} criada com sucesso!`)
      navigate({ to: '/dashboard/jobs' })
    },
    onError: (error) => {
      toast.error(error.message)
    },
  })

  // Validation
  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof FormData, string>> = {}

    if (!formData.customerId) {
      newErrors.customerId = 'Selecione um cliente'
    }

    if (!formData.assetId) {
      newErrors.assetId = 'Selecione um ativo'
    }

    if (!formData.serviceId) {
      newErrors.serviceId = 'Selecione um servico'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!validate()) return
    createMutation.mutate(formData)
  }

  const updateField = <TKey extends keyof FormData>(
    field: TKey,
    value: FormData[TKey],
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

      return newData
    })

    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate({ to: '/dashboard/jobs' })}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} className="mr-2 h-4 w-4" />
          Voltar
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Main Form */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Nova Ordem de Servico</CardTitle>
              <CardDescription>
                Crie uma nova ordem de calibracao selecionando cliente, ativo e
                servico
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <FieldGroup>
                  {/* Step 1: Customer Selection */}
                  <Field>
                    <FieldLabel htmlFor="customer">1. Cliente *</FieldLabel>
                    <Combobox
                      value={
                        formData.customerId ? String(formData.customerId) : ''
                      }
                      onValueChange={(value) =>
                        updateField('customerId', value ? Number(value) : null)
                      }
                      disabled={createMutation.isPending}
                    >
                      <ComboboxInput
                        placeholder="Selecionar cliente..."
                        value={selectedCustomerName}
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
                              <div className="flex flex-col">
                                <span>{customer.name}</span>
                                {customer.taxId && (
                                  <span className="text-xs text-muted-foreground">
                                    {customer.taxId}
                                  </span>
                                )}
                              </div>
                            </ComboboxItem>
                          ))}
                        </ComboboxList>
                      </ComboboxContent>
                    </Combobox>
                    {errors.customerId && (
                      <FieldError>{errors.customerId}</FieldError>
                    )}
                  </Field>

                  {/* Step 2: Asset Selection */}
                  <Field>
                    <FieldLabel htmlFor="asset">2. Ativo *</FieldLabel>
                    <Combobox
                      value={formData.assetId ? String(formData.assetId) : ''}
                      onValueChange={(value) =>
                        updateField('assetId', value ? Number(value) : null)
                      }
                      disabled={
                        !formData.customerId || createMutation.isPending
                      }
                    >
                      <ComboboxInput
                        placeholder={
                          formData.customerId
                            ? 'Selecionar ativo...'
                            : 'Selecione um cliente primeiro'
                        }
                        value={selectedAssetDisplayName}
                      />
                      <ComboboxContent>
                        <ComboboxList>
                          <ComboboxEmpty>
                            {assetsLoading
                              ? 'Carregando...'
                              : 'Nenhum ativo encontrado para este cliente'}
                          </ComboboxEmpty>
                          {assetsData?.data?.map((asset) => (
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
                    {errors.assetId && (
                      <FieldError>{errors.assetId}</FieldError>
                    )}
                  </Field>

                  {/* Step 3: Service Selection */}
                  <Field>
                    <FieldLabel htmlFor="service">3. Servico *</FieldLabel>
                    <Combobox
                      value={
                        formData.serviceId ? String(formData.serviceId) : ''
                      }
                      onValueChange={(value) =>
                        updateField('serviceId', value ? Number(value) : null)
                      }
                      disabled={!formData.assetId || createMutation.isPending}
                    >
                      <ComboboxInput
                        placeholder={
                          formData.assetId
                            ? 'Selecionar servico...'
                            : 'Selecione um ativo primeiro'
                        }
                        value={selectedServiceName}
                      />
                      <ComboboxContent>
                        <ComboboxList>
                          <ComboboxEmpty>
                            {servicesLoading
                              ? 'Carregando...'
                              : selectedAsset?.assetTypeId
                                ? 'Nenhum servico encontrado para este tipo de ativo'
                                : 'Nenhum servico encontrado'}
                          </ComboboxEmpty>
                          {servicesData?.data?.map((service) => (
                            <ComboboxItem
                              key={service.id}
                              value={String(service.id)}
                            >
                              <div className="flex flex-col">
                                <div className="flex items-center gap-2">
                                  <span>{service.name}</span>
                                  {service.methodName && (
                                    <Badge
                                      variant="outline"
                                      className="text-xs"
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
                    {errors.serviceId && (
                      <FieldError>{errors.serviceId}</FieldError>
                    )}
                  </Field>

                  {/* Step 4: Details (Optional) */}
                  <div className="border-t pt-4 mt-4">
                    <h3 className="text-sm font-medium mb-4">
                      4. Detalhes (Opcional)
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Technician */}
                      <Field>
                        <FieldLabel htmlFor="technician">Tecnico</FieldLabel>
                        <Combobox
                          value={formData.technicianId || ''}
                          onValueChange={(value) =>
                            updateField('technicianId', value || null)
                          }
                          disabled={createMutation.isPending}
                        >
                          <ComboboxInput
                            placeholder="Atribuir tecnico..."
                            value={selectedTechnicianName}
                          />
                          <ComboboxContent>
                            <ComboboxList>
                              <ComboboxEmpty>
                                {techniciansLoading
                                  ? 'Carregando...'
                                  : 'Nenhum tecnico encontrado'}
                              </ComboboxEmpty>
                              {techniciansData?.data?.map((tech) => (
                                <ComboboxItem key={tech.id} value={tech.id}>
                                  <div className="flex flex-col">
                                    <span>{tech.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {tech.email}
                                    </span>
                                  </div>
                                </ComboboxItem>
                              ))}
                            </ComboboxList>
                          </ComboboxContent>
                        </Combobox>
                        <FieldDescription>
                          Pode ser atribuido posteriormente
                        </FieldDescription>
                      </Field>

                      {/* Due Date */}
                      <Field>
                        <FieldLabel htmlFor="dueDate">Prazo</FieldLabel>
                        <DatePicker
                          value={formData.dueDate || undefined}
                          onChange={(date) =>
                            updateField('dueDate', date || null)
                          }
                          disabled={createMutation.isPending}
                        />
                        {selectedService?.tat && (
                          <FieldDescription>
                            <HugeiconsIcon
                              icon={InformationCircleIcon}
                              className="inline h-3 w-3 mr-1"
                            />
                            Sugerido com base no TAT do servico (
                            {selectedService.tat} dias)
                          </FieldDescription>
                        )}
                      </Field>
                    </div>
                  </div>

                  {/* Submit Buttons */}
                  <div className="flex justify-end gap-4 pt-4 border-t mt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate({ to: '/dashboard/jobs' })}
                      disabled={createMutation.isPending}
                    >
                      Cancelar
                    </Button>
                    <Button
                      type="submit"
                      disabled={
                        createMutation.isPending ||
                        !formData.customerId ||
                        !formData.assetId ||
                        !formData.serviceId
                      }
                    >
                      {createMutation.isPending ? 'Criando...' : 'Criar Ordem'}
                    </Button>
                  </div>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* Summary Panel */}
        <div className="lg:col-span-1">
          <Card className="sticky top-4">
            <CardHeader>
              <CardTitle className="text-base">Resumo da Ordem</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Customer */}
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Cliente
                </p>
                {selectedCustomer ? (
                  <div className="flex items-center gap-2 mt-1">
                    <HugeiconsIcon
                      icon={CheckmarkCircle02Icon}
                      className="h-4 w-4 text-green-500"
                    />
                    <span className="font-medium">{selectedCustomer.name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Nao selecionado
                  </p>
                )}
              </div>

              {/* Asset */}
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Ativo
                </p>
                {selectedAsset ? (
                  <div className="mt-1">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        className="h-4 w-4 text-green-500"
                      />
                      <span className="font-medium">{selectedAsset.name}</span>
                    </div>
                    <p className="text-xs text-muted-foreground ml-6">
                      Tag: {selectedAsset.tag} | S/N:{' '}
                      {selectedAsset.serialNumber}
                    </p>
                    {selectedAsset.assetTypeName && (
                      <Badge variant="outline" className="ml-6 mt-1 text-xs">
                        {selectedAsset.assetTypeName}
                      </Badge>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Nao selecionado
                  </p>
                )}
              </div>

              {/* Service */}
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Servico
                </p>
                {selectedService ? (
                  <div className="mt-1">
                    <div className="flex items-center gap-2">
                      <HugeiconsIcon
                        icon={CheckmarkCircle02Icon}
                        className="h-4 w-4 text-green-500"
                      />
                      <span className="font-medium">
                        {selectedService.name}
                      </span>
                    </div>
                    {selectedService.methodName && (
                      <p className="text-xs text-muted-foreground ml-6">
                        Metodo: {selectedService.methodName}
                      </p>
                    )}
                    <div className="ml-6 mt-2 flex gap-4 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Preco</p>
                        <p className="font-mono">
                          {formatPrice(
                            selectedService.price,
                            selectedService.currency,
                          )}
                        </p>
                      </div>
                      {selectedService.tat && (
                        <div>
                          <p className="text-xs text-muted-foreground">Prazo</p>
                          <p>{selectedService.tat} dias</p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground italic">
                    Nao selecionado
                  </p>
                )}
              </div>

              {/* Technician */}
              {formData.technicianId && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Tecnico Atribuido
                  </p>
                  <p className="font-medium mt-1">
                    {
                      techniciansData?.data?.find(
                        (t) => t.id === formData.technicianId,
                      )?.name
                    }
                  </p>
                </div>
              )}

              {/* Due Date */}
              {formData.dueDate && (
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide">
                    Prazo de Entrega
                  </p>
                  <p className="font-medium mt-1">
                    {formData.dueDate.toLocaleDateString('pt-BR')}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
