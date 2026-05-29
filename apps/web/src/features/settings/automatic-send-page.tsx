import { useState } from 'react'
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import type { AutomaticSendMilestone } from '@calibra-facil/shared'
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

interface RuleDTO {
  id: number
  milestone: AutomaticSendMilestone
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

const MILESTONE_LABEL: Record<AutomaticSendMilestone, string> = {
  certificate_approved: 'Após aprovação do certificado',
  service_order_delivered: 'Após entrega da OS',
  contract_anniversary: 'No aniversário do contrato',
  manual_only: 'Apenas manual',
}

const MILESTONE_KEYS: ReadonlyArray<AutomaticSendMilestone> = [
  'certificate_approved',
  'service_order_delivered',
  'contract_anniversary',
  'manual_only',
]

const SCOPE_LABEL: Record<Scope, string> = {
  customer: 'Cliente',
  agreement: 'Contrato',
  service: 'Serviço',
  organization: 'Organização (padrão)',
}

function isMilestone(value: string | null): value is AutomaticSendMilestone {
  return value !== null && MILESTONE_KEYS.some((m) => m === value)
}

function isScope(
  value: string | null,
): value is 'customer' | 'agreement' | 'service' {
  return value === 'customer' || value === 'agreement' || value === 'service'
}

function listRulesQueryOptions() {
  return queryOptions<{ data: RuleDTO[] }>({
    queryKey: ['finance', 'automatic-send-rules'],
    queryFn: () =>
      calibraApi.finance.listAutomaticSendRules<{ data: RuleDTO[] }>(),
  })
}

export function AutomaticSendSettingsPage() {
  const queryClient = useQueryClient()
  const { data, isLoading, error } = useQuery(listRulesQueryOptions())

  const updateMutation = useMutation({
    mutationFn: (input: {
      id: number
      milestone?: AutomaticSendMilestone
      archived?: boolean
    }) =>
      calibraApi.finance.updateAutomaticSendRule(input.id, {
        milestone: input.milestone,
        archived: input.archived,
      }),
    onSuccess: () => {
      toast.success('Regra atualizada')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'automatic-send-rules'],
      })
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Erro ao atualizar regra',
      )
    },
  })

  const createMutation = useMutation({
    mutationFn: (input: {
      milestone: AutomaticSendMilestone
      customerId?: number | null
      commercialAgreementId?: number | null
      serviceCategory?: string | null
    }) => calibraApi.finance.createAutomaticSendRule(input),
    onSuccess: () => {
      toast.success('Exceção criada')
      queryClient.invalidateQueries({
        queryKey: ['finance', 'automatic-send-rules'],
      })
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Erro ao criar exceção')
    },
  })

  const rules = data?.data ?? []
  const orgDefault = rules.find(
    (rule) => rule.scope === 'organization' && !rule.archivedAt,
  )
  const overrides = rules.filter((rule) => rule.scope !== 'organization')

  if (isLoading) {
    return (
      <Panel className="p-5 text-sm text-muted-foreground">
        Carregando regras…
      </Panel>
    )
  }

  if (error) {
    return (
      <Panel className="p-5 text-sm text-destructive">
        Não foi possível carregar as regras de envio.
      </Panel>
    )
  }

  return (
    <StaggerGroup className="space-y-6">
      <StaggerItem>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Regras de envio automático
          </h2>
          <p className="text-sm text-muted-foreground">
            Defina quando uma ordem pronta para faturar é enviada
            automaticamente ao financeiro — na aprovação do certificado, na
            entrega da OS ou no aniversário do contrato.
          </p>
        </div>
      </StaggerItem>

      {orgDefault && (
        <StaggerItem>
          <Panel className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <Label
                htmlFor="org-default-milestone"
                className="text-sm font-medium"
              >
                Regra padrão da organização
              </Label>
              <p className="text-xs text-muted-foreground">
                Aplica-se a todas as OS sem exceção configurada.
              </p>
            </div>
            <div className="w-full sm:w-64">
              <Select
                value={orgDefault.milestone}
                onValueChange={(value) => {
                  if (isMilestone(value)) {
                    updateMutation.mutate({
                      id: orgDefault.id,
                      milestone: value,
                    })
                  }
                }}
              >
                <SelectTrigger id="org-default-milestone" className="w-full">
                  <span className="truncate">
                    {MILESTONE_LABEL[orgDefault.milestone]}
                  </span>
                </SelectTrigger>
                <SelectContent
                  alignItemWithTrigger={false}
                  className="w-auto min-w-56"
                >
                  {MILESTONE_KEYS.map((milestone) => (
                    <SelectItem key={milestone} value={milestone}>
                      {MILESTONE_LABEL[milestone]}
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
          description="Sobrescreve a regra padrão para o escopo selecionado."
        />
        <div className="mt-4 space-y-4">
          {overrides.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma exceção configurada.
            </p>
          )}
          <ul className="space-y-3">
            {overrides.map((rule) => (
              <li
                key={rule.id}
                className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                data-testid="automatic-send-rule-row"
              >
                <div className="space-y-1 min-w-0">
                  <Badge variant="outline">{SCOPE_LABEL[rule.scope]}</Badge>
                  <p className="text-sm font-medium truncate">
                    {rule.customerName ||
                      (rule.customerId
                        ? `Cliente #${rule.customerId}`
                        : rule.commercialAgreementId
                          ? `Contrato #${rule.commercialAgreementId}`
                          : rule.serviceCategory || 'Escopo')}
                  </p>
                  {rule.archivedAt && (
                    <p className="text-xs text-muted-foreground">
                      Arquivada em{' '}
                      {new Date(rule.archivedAt).toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    value={rule.milestone}
                    onValueChange={(value) => {
                      if (isMilestone(value)) {
                        updateMutation.mutate({
                          id: rule.id,
                          milestone: value,
                        })
                      }
                    }}
                    disabled={rule.archivedAt !== null}
                  >
                    <SelectTrigger className="sm:w-64">
                      {MILESTONE_LABEL[rule.milestone]}
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false} className="w-auto min-w-56">
                      {MILESTONE_KEYS.map((milestone) => (
                        <SelectItem key={milestone} value={milestone}>
                          {MILESTONE_LABEL[milestone]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!rule.archivedAt && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        updateMutation.mutate({
                          id: rule.id,
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
  milestone: AutomaticSendMilestone
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
  const [milestone, setMilestone] =
    useState<AutomaticSendMilestone>('manual_only')

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
        milestone,
        customerId: scope === 'customer' ? id : null,
        commercialAgreementId: scope === 'agreement' ? id : null,
      })
    } else {
      onSubmit({ milestone, serviceCategory: trimmed })
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
          <Label>Gatilho</Label>
          <Select
            value={milestone}
            onValueChange={(value) => {
              if (isMilestone(value)) setMilestone(value)
            }}
          >
            <SelectTrigger>{MILESTONE_LABEL[milestone]}</SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="w-auto min-w-56">
              {MILESTONE_KEYS.map((option) => (
                <SelectItem key={option} value={option}>
                  {MILESTONE_LABEL[option]}
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
