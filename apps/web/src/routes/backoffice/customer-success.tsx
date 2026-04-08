import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { useBackofficeSession } from '@calibra-facil/auth/client'
import { api } from '@/utils/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/backoffice/customer-success')({
  head: () => ({
    meta: [{ title: 'Backoffice | Customer Success | CalibraFácil' }],
  }),
  component: InternalCustomerSuccessPage,
})

type OrganizationSummary = {
  id: string
  name: string
  slug: string
  type: string | null
  onboardingStatus: string | null
  migrationStatus: string | null
  accountOwnerName: string | null
  accountOwnerEmail: string | null
  supportContactEmail: string | null
  goLiveTargetDate: string | null
  goLiveActualDate: string | null
}

type ProfilePayload = {
  organization: {
    id: string
    name: string
    slug: string
  }
  profile: {
    id: number
    accountOwnerUserId: string | null
    accountOwnerName: string | null
    accountOwnerEmail: string | null
    supportContactEmail: string | null
    onboardingStatus:
      | 'NOT_STARTED'
      | 'DISCOVERY'
      | 'CONFIGURATION'
      | 'TRAINING'
      | 'LIVE'
      | 'BLOCKED'
    migrationStatus:
      | 'NOT_REQUIRED'
      | 'PLANNING'
      | 'IN_PROGRESS'
      | 'VALIDATION'
      | 'COMPLETED'
      | 'BLOCKED'
    goLiveTargetDate: string | null
    goLiveActualDate: string | null
    publicStatusNote: string | null
    internalNotes: string | null
  }
  supportPolicy: {
    supportMode: string
    hasPrioritySupport: boolean
    targetFirstResponseBusinessHours: number
    targetResolutionLabel: string
    includesAssistedOnboarding: boolean
    includesAssistedMigration: boolean
  }
  plan: {
    id: string
    name: string
    status: string
  }
}

type SupportRequest = {
  id: number
  category: string
  priority: string
  status: string
  subject: string
  description: string
  publicResponse: string | null
  createdAt: string
  requestedByUser: { name: string; email: string } | null
  assignedToUser: { id: string; name: string; email: string } | null
  events: Array<{
    kind: string
    message: string
    publicVisible: boolean
    createdAt: string
    actorUser: { name: string; email: string } | null
  }>
}

type RequestsPayload = {
  organization: {
    id: string
    name: string
    slug: string
  }
  data: SupportRequest[]
}

async function parseApiError(res: Response, fallback: string) {
  const data = await res.json().catch(() => null)

  if (data && typeof data === 'object') {
    if ('error' in data && typeof data.error === 'string') return data.error
    if ('message' in data && typeof data.message === 'string') {
      return data.message
    }
  }

  return fallback
}

function toDateInputValue(value: string | null) {
  if (!value) return ''
  return new Date(value).toISOString().slice(0, 10)
}

function InternalCustomerSuccessPage() {
  const queryClient = useQueryClient()
  const { data: session } = useBackofficeSession()
  const [selectedOrganizationId, setSelectedOrganizationId] = useState('')
  const [profileDraft, setProfileDraft] = useState({
    accountOwnerName: '',
    accountOwnerEmail: '',
    supportContactEmail: '',
    onboardingStatus: 'NOT_STARTED',
    migrationStatus: 'NOT_REQUIRED',
    goLiveTargetDate: '',
    goLiveActualDate: '',
    publicStatusNote: '',
    internalNotes: '',
  })
  const [responseDrafts, setResponseDrafts] = useState<Record<number, string>>({})

  const accessQuery = useQuery({
    queryKey: ['backoffice', 'access'],
    queryFn: async () => {
      const res = await api.api.backoffice.access.$get()
      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Acesso ao backoffice negado'))
      }

      return res.json() as Promise<{ allowed: boolean }>
    },
    retry: false,
  })

  const organizationsQuery = useQuery({
    queryKey: ['backoffice', 'customer-success', 'organizations'],
    queryFn: async () => {
      const res = await api.api.backoffice['customer-success'].organizations.$get()

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao carregar organizações'),
        )
      }

      return res.json() as Promise<{ data: OrganizationSummary[] }>
    },
    enabled: accessQuery.isSuccess,
  })

  useEffect(() => {
    if (!selectedOrganizationId && organizationsQuery.data?.data.length) {
      setSelectedOrganizationId(organizationsQuery.data.data[0].id)
    }
  }, [organizationsQuery.data, selectedOrganizationId])

  const profileQuery = useQuery({
    queryKey: ['backoffice', 'customer-success', 'profile', selectedOrganizationId],
    queryFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].profile.$get(
          {
            param: { id: selectedOrganizationId },
          },
        )

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao carregar perfil'))
      }

      return res.json() as Promise<ProfilePayload>
    },
    enabled: Boolean(selectedOrganizationId) && accessQuery.isSuccess,
  })

  const requestsQuery = useQuery({
    queryKey: ['backoffice', 'customer-success', 'requests', selectedOrganizationId],
    queryFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].requests.$get(
          {
            param: { id: selectedOrganizationId },
          },
        )

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao carregar solicitações'),
        )
      }

      return res.json() as Promise<RequestsPayload>
    },
    enabled: Boolean(selectedOrganizationId) && accessQuery.isSuccess,
  })

  const selectedOrganization =
    organizationsQuery.data?.data.find(
      (organization) => organization.id === selectedOrganizationId,
    ) ?? null

  useEffect(() => {
    if (!profileQuery.data) return

    setProfileDraft({
      accountOwnerName: profileQuery.data.profile.accountOwnerName ?? '',
      accountOwnerEmail: profileQuery.data.profile.accountOwnerEmail ?? '',
      supportContactEmail: profileQuery.data.profile.supportContactEmail ?? '',
      onboardingStatus: profileQuery.data.profile.onboardingStatus,
      migrationStatus: profileQuery.data.profile.migrationStatus,
      goLiveTargetDate: toDateInputValue(profileQuery.data.profile.goLiveTargetDate),
      goLiveActualDate: toDateInputValue(profileQuery.data.profile.goLiveActualDate),
      publicStatusNote: profileQuery.data.profile.publicStatusNote ?? '',
      internalNotes: profileQuery.data.profile.internalNotes ?? '',
    })
  }, [profileQuery.data])

  const refreshCurrentOrganization = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'customer-success', 'organizations'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'customer-success', 'profile', selectedOrganizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['backoffice', 'customer-success', 'requests', selectedOrganizationId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['customer-success', 'profile'],
      }),
      queryClient.invalidateQueries({
        queryKey: ['customer-success', 'requests'],
      }),
    ])
  }

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const res =
        await api.api.backoffice['customer-success'].organizations[':id'].profile.$put(
          {
            param: { id: selectedOrganizationId },
            json: {
              accountOwnerName: profileDraft.accountOwnerName,
              accountOwnerEmail: profileDraft.accountOwnerEmail || null,
              supportContactEmail: profileDraft.supportContactEmail || null,
              onboardingStatus: profileDraft.onboardingStatus as ProfilePayload['profile']['onboardingStatus'],
              migrationStatus: profileDraft.migrationStatus as ProfilePayload['profile']['migrationStatus'],
              goLiveTargetDate: profileDraft.goLiveTargetDate
                ? new Date(profileDraft.goLiveTargetDate).toISOString()
                : null,
              goLiveActualDate: profileDraft.goLiveActualDate
                ? new Date(profileDraft.goLiveActualDate).toISOString()
                : null,
              publicStatusNote: profileDraft.publicStatusNote || null,
              internalNotes: profileDraft.internalNotes || null,
            },
          },
        )

      if (!res.ok) {
        throw new Error(
          await parseApiError(res, 'Falha ao atualizar perfil operacional'),
        )
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Perfil operacional atualizado')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao atualizar perfil operacional',
      )
    },
  })

  const respondMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const message = responseDrafts[requestId]?.trim()
      if (!message) {
        throw new Error('Informe uma resposta antes de enviar')
      }

      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].respond.$post({
        param: { id: String(requestId) },
        json: {
          message,
          publicVisible: true,
        },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao responder'))
      }

      return res.json()
    },
    onSuccess: async (_, requestId) => {
      toast.success(`Resposta enviada para a solicitação #${requestId}`)
      setResponseDrafts((current) => ({ ...current, [requestId]: '' }))
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao responder solicitação',
      )
    },
  })

  const assignMutation = useMutation({
    mutationFn: async (requestId: number) => {
      const userId = session?.user?.id
      if (!userId) {
        throw new Error('Sessão inválida para assumir a solicitação')
      }

      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].assign.$post({
        param: { id: String(requestId) },
        json: { assignedToUserId: userId },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao assumir solicitação'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Solicitação atribuída ao operador atual')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao assumir solicitação',
      )
    },
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({
      requestId,
      status,
    }: {
      requestId: number
      status: SupportRequest['status']
    }) => {
      const res = await api.api.backoffice['customer-success'].requests[
        ':id'
      ].status.$post({
        param: { id: String(requestId) },
        json: { status },
      })

      if (!res.ok) {
        throw new Error(await parseApiError(res, 'Falha ao atualizar status'))
      }

      return res.json()
    },
    onSuccess: async () => {
      toast.success('Status atualizado')
      await refreshCurrentOrganization()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar status',
      )
    },
  })

  if (accessQuery.isLoading || organizationsQuery.isLoading) {
    return <InternalCustomerSuccessSkeleton />
  }

  if (accessQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backoffice</CardTitle>
          <CardDescription>
            {accessQuery.error instanceof Error
              ? accessQuery.error.message
              : 'Acesso ao backoffice negado'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (organizationsQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backoffice</CardTitle>
          <CardDescription>
            {organizationsQuery.error instanceof Error
              ? organizationsQuery.error.message
              : 'Falha ao carregar organizações'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (!selectedOrganizationId || profileQuery.isLoading || requestsQuery.isLoading) {
    return <InternalCustomerSuccessSkeleton />
  }

  if (profileQuery.isError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Backoffice</CardTitle>
          <CardDescription>
            {profileQuery.error instanceof Error
              ? profileQuery.error.message
              : 'Falha ao carregar perfil da organização'}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const requestList = requestsQuery.data?.data ?? []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Backoffice de Customer Success
        </h1>
        <p className="text-muted-foreground">
          Superfície mínima para onboarding assistido, migração e resposta às
          solicitações operacionais.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organização Atendida</CardTitle>
          <CardDescription>
            Escolha a organização para atualizar o pipeline operacional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field>
            <FieldLabel>Organização</FieldLabel>
            <NativeSelect
              value={selectedOrganizationId}
              onChange={(event) => setSelectedOrganizationId(event.target.value)}
              className="w-full"
            >
              {organizationsQuery.data.data.map((organization) => (
                <NativeSelectOption key={organization.id} value={organization.id}>
                  {organization.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {selectedOrganization ? (
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{selectedOrganization.slug}</Badge>
              {selectedOrganization.onboardingStatus ? (
                <Badge variant="outline">
                  Onboarding: {selectedOrganization.onboardingStatus}
                </Badge>
              ) : null}
              {selectedOrganization.migrationStatus ? (
                <Badge variant="outline">
                  Migração: {selectedOrganization.migrationStatus}
                </Badge>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle>Perfil Operacional</CardTitle>
            <CardDescription>
              Status público, owner da conta, contato de suporte e go-live.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault()
                updateProfileMutation.mutate()
              }}
            >
              <FieldGroup>
                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Plano</FieldLabel>
                    <Input
                      value={profileQuery.data.plan.name}
                      disabled
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Modo de suporte</FieldLabel>
                    <Input
                      value={profileQuery.data.supportPolicy.supportMode}
                      disabled
                    />
                    <FieldDescription>
                      SLA derivado automaticamente do plano.
                    </FieldDescription>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Account owner</FieldLabel>
                    <Input
                      value={profileDraft.accountOwnerName}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          accountOwnerName: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Email do owner</FieldLabel>
                    <Input
                      type="email"
                      value={profileDraft.accountOwnerEmail}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          accountOwnerEmail: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel>Email de suporte</FieldLabel>
                  <Input
                    type="email"
                    value={profileDraft.supportContactEmail}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        supportContactEmail: event.target.value,
                      }))
                    }
                  />
                </Field>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Onboarding</FieldLabel>
                    <NativeSelect
                      value={profileDraft.onboardingStatus}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          onboardingStatus: event.target.value,
                        }))
                      }
                    >
                      {[
                        'NOT_STARTED',
                        'DISCOVERY',
                        'CONFIGURATION',
                        'TRAINING',
                        'LIVE',
                        'BLOCKED',
                      ].map((status) => (
                        <NativeSelectOption key={status} value={status}>
                          {status}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Field>
                    <FieldLabel>Migração</FieldLabel>
                    <NativeSelect
                      value={profileDraft.migrationStatus}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          migrationStatus: event.target.value,
                        }))
                      }
                    >
                      {[
                        'NOT_REQUIRED',
                        'PLANNING',
                        'IN_PROGRESS',
                        'VALIDATION',
                        'COMPLETED',
                        'BLOCKED',
                      ].map((status) => (
                        <NativeSelectOption key={status} value={status}>
                          {status}
                        </NativeSelectOption>
                      ))}
                    </NativeSelect>
                  </Field>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <Field>
                    <FieldLabel>Meta de go-live</FieldLabel>
                    <Input
                      type="date"
                      value={profileDraft.goLiveTargetDate}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          goLiveTargetDate: event.target.value,
                        }))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel>Go-live real</FieldLabel>
                    <Input
                      type="date"
                      value={profileDraft.goLiveActualDate}
                      onChange={(event) =>
                        setProfileDraft((current) => ({
                          ...current,
                          goLiveActualDate: event.target.value,
                        }))
                      }
                    />
                  </Field>
                </div>

                <Field>
                  <FieldLabel>Status público</FieldLabel>
                  <Textarea
                    rows={4}
                    value={profileDraft.publicStatusNote}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        publicStatusNote: event.target.value,
                      }))
                    }
                  />
                </Field>

                <Field>
                  <FieldLabel>Notas internas</FieldLabel>
                  <Textarea
                    rows={6}
                    value={profileDraft.internalNotes}
                    onChange={(event) =>
                      setProfileDraft((current) => ({
                        ...current,
                        internalNotes: event.target.value,
                      }))
                    }
                  />
                </Field>
              </FieldGroup>

              <Button type="submit" disabled={updateProfileMutation.isPending}>
                {updateProfileMutation.isPending
                  ? 'Salvando...'
                  : 'Salvar perfil operacional'}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Solicitações da Organização</CardTitle>
            <CardDescription>
              Timeline simples para atribuição, resposta e mudança de status.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {requestList.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nenhuma solicitação registrada para esta organização.
              </p>
            ) : (
              requestList.map((request) => (
                <div
                  key={request.id}
                  className="space-y-4 rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">{request.subject}</p>
                      <p className="text-xs text-muted-foreground">
                        #{request.id} • {request.category} • {request.priority}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{request.status}</Badge>
                      <NativeSelect
                        size="sm"
                        value={request.status}
                        onChange={(event) =>
                          updateStatusMutation.mutate({
                            requestId: request.id,
                            status: event.target.value as SupportRequest['status'],
                          })
                        }
                      >
                        {[
                          'OPEN',
                          'IN_PROGRESS',
                          'WAITING_ON_CUSTOMER',
                          'RESOLVED',
                          'CLOSED',
                        ].map((status) => (
                          <NativeSelectOption key={status} value={status}>
                            {status}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>

                  <p className="text-sm text-muted-foreground">
                    {request.description}
                  </p>

                  <div className="text-xs text-muted-foreground">
                    Solicitante: {request.requestedByUser?.name ?? 'N/A'}
                    {request.assignedToUser
                      ? ` • Responsável: ${request.assignedToUser.name}`
                      : ' • Sem responsável'}
                  </div>

                  <Field>
                    <FieldLabel>Resposta pública</FieldLabel>
                    <Textarea
                      rows={3}
                      value={responseDrafts[request.id] ?? ''}
                      onChange={(event) =>
                        setResponseDrafts((current) => ({
                          ...current,
                          [request.id]: event.target.value,
                        }))
                      }
                      placeholder="Resposta operacional visível para o laboratório."
                    />
                  </Field>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => assignMutation.mutate(request.id)}
                      disabled={assignMutation.isPending}
                    >
                      Assumir
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => respondMutation.mutate(request.id)}
                      disabled={respondMutation.isPending}
                    >
                      Responder
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatusMutation.mutate({
                          requestId: request.id,
                          status: 'WAITING_ON_CUSTOMER',
                        })
                      }
                    >
                      Aguardar laboratório
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        updateStatusMutation.mutate({
                          requestId: request.id,
                          status: 'RESOLVED',
                        })
                      }
                    >
                      Marcar como resolvido
                    </Button>
                  </div>

                  {request.events.length > 0 ? (
                    <div className="space-y-2 border-t pt-3">
                      {request.events.map((event, index) => (
                        <div
                          key={`${request.id}-${index}-${event.createdAt}`}
                          className="text-sm"
                        >
                          <p>{event.message}</p>
                          <p className="text-xs text-muted-foreground">
                            {event.actorUser?.name ?? 'Sistema'} •{' '}
                            {new Intl.DateTimeFormat('pt-BR', {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            }).format(new Date(event.createdAt))}
                            {event.publicVisible ? ' • Público' : ' • Interno'}
                          </p>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function InternalCustomerSuccessSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-80" />
      <Skeleton className="h-36 rounded-xl" />
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Skeleton className="h-[720px] rounded-xl" />
        <Skeleton className="h-[720px] rounded-xl" />
      </div>
    </div>
  )
}
