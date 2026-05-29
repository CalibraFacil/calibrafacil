import { useState } from 'react'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { CertificateReleasePolicyMode } from '@calibra-facil/shared'
import { calibraApi } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Panel,
  PanelHeader,
  StaggerGroup,
  StaggerItem,
} from '@/components/instrument-panel'
import { Label } from '@/components/ui/label'
import { ScopeTargetSelect } from '@/features/settings/finance-scope-target-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select'
import { toast } from 'sonner'

type Scope = 'customer' | 'agreement' | 'service' | 'organization'

interface PolicyDTO {
  id: number
  mode: CertificateReleasePolicyMode
  customerId: number | null
  customerName?: string | null
  commercialAgreementId: number | null
  serviceCategory: string | null
  priority: number
  scope: Scope
  archivedAt: string | null
  createdAt: string
  updatedAt: string
}

const MODE_LABEL: Record<CertificateReleasePolicyMode, string> = {
  release_after_invoice: 'Após emissão da fatura',
  release_after_first_installment: 'Após primeira parcela paga',
  release_after_full_payment: 'Após pagamento integral',
  trusted_customer: 'Cliente de confiança (sempre liberar)',
  manual_only: 'Apenas manual',
}

const MODE_KEYS: ReadonlyArray<CertificateReleasePolicyMode> = [
  'release_after_invoice',
  'release_after_first_installment',
  'release_after_full_payment',
  'trusted_customer',
  'manual_only',
]

function isPolicyMode(
  value: string | null,
): value is CertificateReleasePolicyMode {
  return value !== null && MODE_KEYS.some((mode) => mode === value)
}

function isScope(
  value: string | null,
): value is 'customer' | 'agreement' | 'service' {
  return value === 'customer' || value === 'agreement' || value === 'service'
}

const SCOPE_LABEL: Record<Scope, string> = {
  customer: 'Cliente',
  agreement: 'Contrato',
  service: 'Serviço',
  organization: 'Organização (padrão)',
}

function listPoliciesQueryOptions() {
  return queryOptions<{ data: PolicyDTO[] }>({
    queryKey: ['finance', 'certificate-release-policies'],
    queryFn: () =>
      calibraApi.finance.listCertificateReleasePolicies<{
        data: PolicyDTO[]
      }>(),
  })
}

export function CertificateReleasePolicyPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery(listPoliciesQueryOptions())

  const updateMutation = useMutation({
    mutationFn: async (input: {
      id: number
      mode?: CertificateReleasePolicyMode
      archived?: boolean
    }) =>
      calibraApi.finance.updateCertificateReleasePolicy(input.id, {
        mode: input.mode,
        archived: input.archived,
      }),
    onSuccess: () => {
      toast.success('Política atualizada')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'certificate-release-policies'],
      })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao atualizar política',
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: async (input: {
      mode: CertificateReleasePolicyMode
      customerId?: number | null
      commercialAgreementId?: number | null
      serviceCategory?: string | null
    }) => calibraApi.finance.createCertificateReleasePolicy(input),
    onSuccess: () => {
      toast.success('Exceção criada')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'certificate-release-policies'],
      })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar exceção')
    },
  })

  const policies = data?.data ?? []
  const orgDefault = policies.find(
    (policy) => policy.scope === 'organization' && !policy.archivedAt,
  )
  const overrides = policies.filter((policy) => policy.scope !== 'organization')

  if (isLoading) {
    return (
      <Panel className="p-5 text-sm text-muted-foreground">
        Carregando políticas…
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="p-5 text-sm text-destructive">
        Não foi possível carregar as políticas de liberação.
      </Panel>
    )
  }

  return (
    <StaggerGroup className="space-y-6">
      {orgDefault && (
        <StaggerItem>
          <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Label htmlFor="org-default-mode" className="text-sm font-medium">
                Política padrão da organização
              </Label>
              <p className="text-xs text-muted-foreground">
                Aplica-se a todos os certificados sem exceção configurada.
              </p>
            </div>
            <div className="w-full sm:w-64">
              <Select
                value={orgDefault.mode}
                onValueChange={(value) =>
                  updateMutation.mutate({
                    id: orgDefault.id,
                    mode: isPolicyMode(value) ? value : undefined,
                  })
                }
              >
                <SelectTrigger id="org-default-mode" className="w-full">
                  <span className="truncate">{MODE_LABEL[orgDefault.mode]}</span>
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  className="w-auto min-w-56"
                >
                  {MODE_KEYS.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {MODE_LABEL[mode]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Panel>
        </StaggerItem>
      )}

      <StaggerItem>
      <Panel className="p-5 sm:p-6">
        <PanelHeader
          eyebrow="Exceções"
          title="Exceções por cliente, contrato ou serviço"
          description="Sobrescreve a política padrão para o escopo selecionado."
        />
        <div className="mt-4 space-y-4">
          {overrides.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma exceção configurada.
            </p>
          )}
          <ul className="space-y-3">
            {overrides.map((policy) => (
              <li
                key={policy.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1 min-w-0">
                  <Badge variant="outline">{SCOPE_LABEL[policy.scope]}</Badge>
                  <p className="text-sm font-medium truncate">
                    {policy.customerName ||
                      (policy.customerId
                        ? `Cliente #${policy.customerId}`
                        : policy.commercialAgreementId
                          ? `Contrato #${policy.commercialAgreementId}`
                          : policy.serviceCategory || 'Escopo')}
                  </p>
                  {policy.archivedAt && (
                    <p className="text-xs text-muted-foreground">
                      Arquivada em{' '}
                      {new Date(policy.archivedAt).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={policy.mode}
                    onValueChange={(value) =>
                      updateMutation.mutate({
                        id: policy.id,
                        mode: isPolicyMode(value) ? value : undefined,
                      })
                    }
                    disabled={policy.archivedAt !== null}
                  >
                    <SelectTrigger className="sm:w-64">
                      {MODE_LABEL[policy.mode]}
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} className="w-auto min-w-56">
                      {(
                        MODE_KEYS
                      ).map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {MODE_LABEL[mode]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!policy.archivedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          id: policy.id,
                          archived: true,
                        })
                      }
                    >
                      Arquivar
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <CreateOverrideForm
            onSubmit={(input) => createMutation.mutate(input)}
            disabled={createMutation.isPending}
          />
        </div>
      </Panel>
      </StaggerItem>
    </StaggerGroup>
  )
}

interface CreateOverrideInput {
  mode: CertificateReleasePolicyMode
  customerId?: number | null
  commercialAgreementId?: number | null
  serviceCategory?: string | null
}

function CreateOverrideForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (input: CreateOverrideInput) => void
  disabled: boolean
}) {
  const [scope, setScope] = useState<'customer' | 'agreement' | 'service'>(
    'customer',
  )
  const [scopeValue, setScopeValue] = useState('')
  const [mode, setMode] = useState<CertificateReleasePolicyMode>('manual_only')

  function handleSubmit() {
    const trimmed = scopeValue.trim()
    if (!trimmed) {
      toast.error('Informe o escopo da exceção')
      return
    }

    if (scope === 'customer' || scope === 'agreement') {
      const id = Number.parseInt(trimmed, 10)
      if (!Number.isFinite(id) || id <= 0) {
        toast.error('Informe um ID numérico válido')
        return
      }
      onSubmit({
        mode,
        customerId: scope === 'customer' ? id : null,
        commercialAgreementId: scope === 'agreement' ? id : null,
      })
    } else {
      onSubmit({
        mode,
        serviceCategory: trimmed,
      })
    }

    setScopeValue('')
  }

  return (
    <div className="rounded-md border border-dashed p-4 space-y-3">
      <p className="text-sm font-medium">Adicionar exceção</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label>Escopo</Label>
          <Select
            value={scope}
            onValueChange={(value) => {
              if (isScope(value)) {
                setScope(value)
                setScopeValue('')
              }
            }}
          >
            <SelectTrigger>{SCOPE_LABEL[scope]}</SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="w-auto min-w-56">
              <SelectItem value="customer">Cliente</SelectItem>
              <SelectItem value="agreement">Contrato</SelectItem>
              <SelectItem value="service">Serviço</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>{scope === 'service' ? 'Serviço' : 'Registro'}</Label>
          <ScopeTargetSelect
            scope={scope}
            value={scopeValue}
            onChange={setScopeValue}
          />
        </div>
        <div className="space-y-1">
          <Label>Modo</Label>
          <Select
            value={mode}
            onValueChange={(value) => {
              if (isPolicyMode(value)) setMode(value)
            }}
          >
            <SelectTrigger>{MODE_LABEL[mode]}</SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="w-auto min-w-56">
              {(
                MODE_KEYS
              ).map((option) => (
                <SelectItem key={option} value={option}>
                  {MODE_LABEL[option]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end">
        <Button onClick={handleSubmit} disabled={disabled}>
          Adicionar exceção
        </Button>
      </div>
    </div>
  )
}
