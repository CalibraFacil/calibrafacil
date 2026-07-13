import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Building06Icon, Delete02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

import { authClient } from '@calibra-facil/auth/client'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import {
  ACCREDITATION_NUMBER_PREFIX,
  getAccreditationStatus,
  normalizeAccreditationNumber,
} from '@calibra-facil/shared'
import { isValidCnpj, normalizeCnpj } from '@calibra-facil/shared/cnpj'
import { calibraApi } from '@/utils/api'
import { useDashboardUnitsData } from '@/features/settings/queries'
import type { GovernanceViewer } from '@/features/settings/types'
import {
  buildOrganizationIdentityPayload,
  buildOrganizationIsoPayload,
  createOrganizationIdentityDraft,
  createOrganizationIsoDraft,
} from '@/features/settings/organization-model'
import type { ActiveOrganization } from '@/features/settings/organization/shared'
import { AccreditationSealPreview } from '@/features/settings/accreditation-seal-preview'
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
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from '@/components/ui/input-group'
import { MaskedInput } from '@/components/ui/masked-input'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { brazilPhoneMask, cepMask, cnpjMask } from '@/lib/input-masks'

export function OrganizationProfileSection({
  activeOrg,
  canManageOrganizationSettings,
  hasMultiUnit,
  governanceViewer,
}: {
  activeOrg: ActiveOrganization
  canManageOrganizationSettings: boolean
  hasMultiUnit: boolean
  governanceViewer: GovernanceViewer | null
}) {
  const identityDraft = createOrganizationIdentityDraft(activeOrg)
  const isoDraft = createOrganizationIsoDraft(activeOrg)
  const [name, setName] = useState(identityDraft.name)
  const [slug, setSlug] = useState(identityDraft.slug)
  const [isUpdating, setIsUpdating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const logoInputRef = useRef<HTMLInputElement>(null)
  const [organizationLogo, setOrganizationLogo] = useState(
    activeOrg.logo ?? null,
  )

  // ISO 17025 / RBC compliance fields
  const [cnpj, setCnpj] = useState(isoDraft.cnpj)
  const [accreditationNumber, setAccreditationNumber] = useState(
    isoDraft.accreditationNumber,
  )
  const [accreditationBody, setAccreditationBody] = useState(
    isoDraft.accreditationBody,
  )
  const [accreditationActive, setAccreditationActive] = useState(
    isoDraft.accreditationActive,
  )
  const [accreditationValidFrom, setAccreditationValidFrom] = useState(
    isoDraft.accreditationValidFrom,
  )
  const [accreditationValidUntil, setAccreditationValidUntil] = useState(
    isoDraft.accreditationValidUntil,
  )
  const [
    permissionariaAuthorizationNumber,
    setPermissionariaAuthorizationNumber,
  ] = useState(isoDraft.permissionariaAuthorizationNumber)
  const [
    permissionariaAuthorizationState,
    setPermissionariaAuthorizationState,
  ] = useState(isoDraft.permissionariaAuthorizationState)
  const [street, setStreet] = useState(isoDraft.street)
  const [number, setNumber] = useState(isoDraft.number)
  const [complement, setComplement] = useState(isoDraft.complement)
  const [neighbourhood, setNeighbourhood] = useState(isoDraft.neighbourhood)
  const [city, setCity] = useState(isoDraft.city)
  const [state, setState] = useState(isoDraft.state)
  const [cep, setCep] = useState(isoDraft.cep)
  const [phone, setPhone] = useState(isoDraft.phone)
  const [email, setEmail] = useState(isoDraft.email)
  const [website, setWebsite] = useState(isoDraft.website)
  const [technicalManagerName, setTechnicalManagerName] = useState(
    isoDraft.technicalManagerName,
  )
  const [technicalManagerTitle, setTechnicalManagerTitle] = useState(
    isoDraft.technicalManagerTitle,
  )
  const [isUpdatingIso, setIsUpdatingIso] = useState(false)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deleteConfirmName, setDeleteConfirmName] = useState('')
  const [isDeleting, setIsDeleting] = useState(false)

  const queryClient = useQueryClient()
  const unitContextQuery = useDashboardUnitsData({
    organizationId: activeOrg.id,
    enabled: hasMultiUnit,
  })

  const logoUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      return calibraApi.organizationMedia.uploadLogo(file, {
        fileName: file.name,
      })
    },
    onSuccess: async (data) => {
      setOrganizationLogo(data.logoUrl)
      toast.success('Logo da organização atualizado')
      await queryClient.invalidateQueries()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao enviar logo',
      )
    },
  })

  const logoDeleteMutation = useMutation({
    mutationFn: () => calibraApi.organizationMedia.deleteLogo(),
    onSuccess: async () => {
      setOrganizationLogo(null)
      toast.success('Logo da organização removido')
      await queryClient.invalidateQueries()
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao remover logo',
      )
    },
  })

  const handleUpdateOrganization = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    if (!name.trim()) {
      setFormError('Nome é obrigatório')
      return
    }

    setIsUpdating(true)
    try {
      const result = await authClient.organization.update({
        data: buildOrganizationIdentityPayload({ name, slug }),
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao atualizar organização',
          ),
        )
      }
      toast.success('Organização atualizada com sucesso!')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao atualizar organização'
      setFormError(message)
      toast.error(message)
    } finally {
      setIsUpdating(false)
    }
  }

  const handleUpdateIso17025 = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsUpdatingIso(true)
    try {
      const result = await authClient.organization.update({
        data: buildOrganizationIsoPayload({
          cnpj,
          accreditationNumber,
          accreditationBody,
          accreditationActive,
          accreditationValidFrom,
          accreditationValidUntil,
          permissionariaAuthorizationNumber,
          permissionariaAuthorizationState,
          street,
          number,
          complement,
          neighbourhood,
          city,
          state,
          cep,
          phone,
          email,
          website,
          technicalManagerName,
          technicalManagerTitle,
        }),
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao atualizar informações',
          ),
        )
      }
      toast.success('Informações ISO 17025 atualizadas com sucesso!')
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao atualizar informações'
      toast.error(message)
    } finally {
      setIsUpdatingIso(false)
    }
  }

  const handleLogoFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    logoUploadMutation.mutate(file)
  }

  const handleDeleteOrganization = async () => {
    if (deleteConfirmName !== activeOrg.name) {
      toast.error('O nome da organização não confere')
      return
    }

    setIsDeleting(true)
    try {
      const result = await authClient.organization.delete({
        organizationId: activeOrg.id,
      })
      if (result.error) {
        throw new Error(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao excluir organização',
          ),
        )
      }
      toast.success('Organização excluída com sucesso')
      // Redirect to dashboard after deletion
      window.location.href = '/dashboard'
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Falha ao excluir organização'
      toast.error(message)
      setIsDeleting(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Postura Multiunidade</CardTitle>
            <CardDescription>
              Torne explícito o escopo operacional ativo, quem você consegue
              governar e quando a visão consolidada está em uso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!hasMultiUnit ? (
              <div className="rounded-xl border bg-muted/30 p-4">
                <Badge variant="secondary">Unidade única</Badge>
                <p className="mt-3 text-sm text-muted-foreground">
                  Sua organização opera em uma única unidade — toda a operação
                  usa o mesmo escopo. A governança multiunidade (escopos por
                  unidade e visão consolidada) fica disponível no plano
                  Enterprise.
                </p>
              </div>
            ) : unitContextQuery.isPending ? (
              <div className="grid gap-4 md:grid-cols-3">
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
                <div className="rounded-xl border p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">
                      {unitContextQuery.data?.scopeSummary.label ??
                        'Escopo ativo'}
                    </Badge>
                    <Badge variant="outline">
                      {unitContextQuery.data?.scopeSummary.effectiveRoleLabel ??
                        'Sem papel operacional'}
                    </Badge>
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">
                    {unitContextQuery.data?.scopeSummary.description ??
                      'O escopo operacional aparece aqui conforme a unidade selecionada.'}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Badge variant="outline">
                      {unitContextQuery.data?.scopeSummary
                        .accessibleUnitsCount ?? 0}{' '}
                      unidade(s) acessível(eis)
                    </Badge>
                    {governanceViewer?.canAccessConsolidatedView ? (
                      <Badge variant="outline">
                        Pode abrir consolidado global
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <p className="text-sm font-medium">Governança efetiva</p>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>
                      {governanceViewer?.isGlobalManager
                        ? 'Você opera como administrador global da organização.'
                        : governanceViewer?.canManageAssignments
                          ? 'Você governa apenas as unidades sob sua responsabilidade.'
                          : 'Você está em um escopo operacional sem poderes de governança.'}
                    </p>
                    <p>
                      {governanceViewer?.managedUnitIds.length ?? 0} unidade(s)
                      sob gestão
                    </p>
                  </div>
                </div>

                <div className="rounded-xl border p-4">
                  <p className="text-sm font-medium">Fila e visibilidade</p>
                  <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                    <p>
                      {unitContextQuery.data?.selectedUnitScope === 'all'
                        ? 'Listas e métricas operacionais estão em visão consolidada.'
                        : 'Listas e aprovações devem respeitar apenas a unidade ativa.'}
                    </p>
                    <p>
                      {governanceViewer?.canAccessConsolidatedView
                        ? 'Relatórios consolidados ficam disponíveis neste contexto.'
                        : 'Relatórios consolidados ficam reservados aos administradores globais.'}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {canManageOrganizationSettings && (
          <>
            {/* Organization Details Card */}
            <Card>
              <CardHeader>
                <CardTitle>Detalhes da Organização</CardTitle>
                <CardDescription>
                  Atualize as informações da sua organização.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpdateOrganization}>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="org-name">Nome</FieldLabel>
                      <Input
                        id="org-name"
                        value={name}
                        onChange={(e) => {
                          setName(e.target.value)
                          setFormError(null)
                        }}
                        disabled={isUpdating}
                        placeholder="Nome da organização"
                      />
                      {formError && <FieldError>{formError}</FieldError>}
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
                      <Input
                        id="org-slug"
                        value={slug}
                        onChange={(e) => setSlug(e.target.value)}
                        disabled={isUpdating}
                        placeholder="slug-da-organizacao"
                      />
                      <FieldDescription>
                        URL amigável para identificar sua organização.
                      </FieldDescription>
                    </Field>

                    <div className="flex justify-end">
                      <Button type="submit" disabled={isUpdating}>
                        {isUpdating ? 'Salvando...' : 'Salvar alterações'}
                      </Button>
                    </div>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Logotipo da Organização</CardTitle>
                <CardDescription>
                  Usado na identificação do laboratório, portal e certificados.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <div className="flex h-20 w-32 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/30">
                      {organizationLogo ? (
                        <img
                          src={organizationLogo}
                          alt={`Logo de ${activeOrg.name}`}
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <HugeiconsIcon
                          icon={Building06Icon}
                          className="size-8 text-muted-foreground"
                        />
                      )}
                    </div>
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium">
                        {organizationLogo ? 'Logo configurado' : 'Sem logo'}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        PNG, JPG, WebP ou SVG até 2MB.
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/svg+xml"
                      className="hidden"
                      onChange={handleLogoFileChange}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        logoUploadMutation.isPending ||
                        logoDeleteMutation.isPending
                      }
                      onClick={() => logoInputRef.current?.click()}
                    >
                      {logoUploadMutation.isPending ? 'Enviando...' : 'Enviar'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={
                        !organizationLogo ||
                        logoUploadMutation.isPending ||
                        logoDeleteMutation.isPending
                      }
                      onClick={() => logoDeleteMutation.mutate()}
                    >
                      {logoDeleteMutation.isPending
                        ? 'Removendo...'
                        : 'Remover'}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* ISO 17025 / RBC Compliance Card */}
            <Card>
              <CardHeader>
                <CardTitle>Informações ISO 17025</CardTitle>
                <CardDescription>
                  Dados do laboratório para certificados de calibração conforme
                  ISO/IEC 17025 e RBC/Inmetro.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleUpdateIso17025}>
                  <FieldGroup>
                    {/* Identification */}
                    <Field>
                      <FieldLabel htmlFor="org-cnpj">CNPJ</FieldLabel>
                      <MaskedInput
                        id="org-cnpj"
                        maskOptions={cnpjMask}
                        value={cnpj}
                        onInput={(e) => setCnpj(e.currentTarget.value)}
                        disabled={isUpdatingIso}
                        placeholder="00.000.000/0000-00"
                      />
                      {normalizeCnpj(cnpj).length === 14 &&
                        !isValidCnpj(cnpj) && (
                          <FieldDescription className="text-amber-700 dark:text-amber-400">
                            CNPJ inválido — verifique os dígitos. Você ainda
                            pode salvar.
                          </FieldDescription>
                        )}
                    </Field>

                    {/* Accreditation */}
                    <div className="grid gap-6 sm:grid-cols-[1fr_auto]">
                      <FieldGroup>
                        <Field orientation="horizontal">
                          <Switch
                            id="org-accreditation-active"
                            checked={accreditationActive}
                            onCheckedChange={setAccreditationActive}
                            disabled={isUpdatingIso}
                          />
                          <FieldLabel htmlFor="org-accreditation-active">
                            Acreditação ativa
                          </FieldLabel>
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field>
                            <FieldLabel htmlFor="org-accreditation-number">
                              Número de Acreditação
                            </FieldLabel>
                            <InputGroup>
                              <InputGroupAddon>
                                <InputGroupText className="font-semibold">
                                  {ACCREDITATION_NUMBER_PREFIX}
                                </InputGroupText>
                              </InputGroupAddon>
                              <InputGroupInput
                                id="org-accreditation-number"
                                inputMode="numeric"
                                value={accreditationNumber}
                                onChange={(e) =>
                                  setAccreditationNumber(
                                    normalizeAccreditationNumber(
                                      e.target.value,
                                    ),
                                  )
                                }
                                disabled={isUpdatingIso}
                                placeholder="0123"
                              />
                            </InputGroup>
                            <FieldDescription>
                              Apenas o número. O prefixo CAL é fixo no selo.
                            </FieldDescription>
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="org-accreditation-body">
                              Órgão Acreditador
                            </FieldLabel>
                            <Input
                              id="org-accreditation-body"
                              value={accreditationBody}
                              onChange={(e) =>
                                setAccreditationBody(e.target.value)
                              }
                              disabled={isUpdatingIso}
                              placeholder="CGCRE/Inmetro"
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="org-accreditation-valid-from">
                              Início da vigência
                            </FieldLabel>
                            <Input
                              id="org-accreditation-valid-from"
                              type="date"
                              value={accreditationValidFrom}
                              onChange={(e) =>
                                setAccreditationValidFrom(e.target.value)
                              }
                              disabled={isUpdatingIso}
                            />
                          </Field>
                          <Field>
                            <FieldLabel htmlFor="org-accreditation-valid-until">
                              Fim da vigência
                            </FieldLabel>
                            <Input
                              id="org-accreditation-valid-until"
                              type="date"
                              value={accreditationValidUntil}
                              onChange={(e) =>
                                setAccreditationValidUntil(e.target.value)
                              }
                              disabled={isUpdatingIso}
                            />
                            <FieldDescription>
                              Fora da vigência os certificados saem sem o selo.
                              Vazio = sem controle de vigência.
                            </FieldDescription>
                          </Field>
                        </div>
                      </FieldGroup>
                      <AccreditationSealPreview
                        status={getAccreditationStatus({
                          accreditationActive,
                          accreditationNumber,
                          accreditationValidFrom: accreditationValidFrom
                            ? `${accreditationValidFrom}T00:00:00.000Z`
                            : null,
                          accreditationValidUntil: accreditationValidUntil
                            ? `${accreditationValidUntil}T23:59:59.999Z`
                            : null,
                        })}
                        accreditationNumber={accreditationNumber}
                      />
                    </div>

                    <Separator />

                    {/* Legal-metrology repair authorization (RBMLQ-I) */}
                    <FieldGroup>
                      <Field>
                        <FieldLabel>
                          Autorização de reparo (metrologia legal)
                        </FieldLabel>
                        <FieldDescription>
                          Oficina permissionária do RBMLQ-I (Port. Inmetro
                          65/2015). Distinta da acreditação RBC acima; aparece
                          nos documentos de reparo de instrumentos sujeitos à
                          metrologia legal.
                        </FieldDescription>
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
                        <Field>
                          <FieldLabel htmlFor="org-permissionaria-number">
                            Nº de autorização
                          </FieldLabel>
                          <Input
                            id="org-permissionaria-number"
                            value={permissionariaAuthorizationNumber}
                            onChange={(e) =>
                              setPermissionariaAuthorizationNumber(
                                e.target.value,
                              )
                            }
                            disabled={isUpdatingIso}
                            placeholder="0123"
                          />
                        </Field>
                        <Field>
                          <FieldLabel htmlFor="org-permissionaria-uf">
                            UF
                          </FieldLabel>
                          <Input
                            id="org-permissionaria-uf"
                            className="w-20"
                            maxLength={2}
                            value={permissionariaAuthorizationState}
                            onChange={(e) =>
                              setPermissionariaAuthorizationState(
                                e.target.value
                                  .toUpperCase()
                                  .replace(/[^A-Z]/g, '')
                                  .slice(0, 2),
                              )
                            }
                            disabled={isUpdatingIso}
                            placeholder="RS"
                          />
                        </Field>
                      </div>
                    </FieldGroup>

                    <Separator />

                    {/* Address */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field className="sm:col-span-2">
                        <FieldLabel htmlFor="org-street">Rua</FieldLabel>
                        <Input
                          id="org-street"
                          value={street}
                          onChange={(e) => setStreet(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="Rua das Calibrações"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-number">Número</FieldLabel>
                        <Input
                          id="org-number"
                          value={number}
                          onChange={(e) => setNumber(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="123"
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="org-complement">
                          Complemento
                        </FieldLabel>
                        <Input
                          id="org-complement"
                          value={complement}
                          onChange={(e) => setComplement(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="Sala 101"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-neighbourhood">
                          Bairro
                        </FieldLabel>
                        <Input
                          id="org-neighbourhood"
                          value={neighbourhood}
                          onChange={(e) => setNeighbourhood(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="Centro"
                        />
                      </Field>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="org-city">Cidade</FieldLabel>
                        <Input
                          id="org-city"
                          value={city}
                          onChange={(e) => setCity(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="São Paulo"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-state">Estado</FieldLabel>
                        <Input
                          id="org-state"
                          value={state}
                          onChange={(e) => setState(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="SP"
                          maxLength={2}
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-cep">CEP</FieldLabel>
                        <MaskedInput
                          id="org-cep"
                          maskOptions={cepMask}
                          value={cep}
                          onInput={(e) => setCep(e.currentTarget.value)}
                          disabled={isUpdatingIso}
                          placeholder="00000-000"
                        />
                      </Field>
                    </div>

                    <Separator />

                    {/* Contact */}
                    <div className="grid gap-4 sm:grid-cols-3">
                      <Field>
                        <FieldLabel htmlFor="org-phone">Telefone</FieldLabel>
                        <MaskedInput
                          id="org-phone"
                          type="tel"
                          inputMode="tel"
                          maskOptions={brazilPhoneMask}
                          value={phone}
                          onInput={(e) => setPhone(e.currentTarget.value)}
                          disabled={isUpdatingIso}
                          placeholder="(11) 99999-9999"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-email">Email</FieldLabel>
                        <Input
                          id="org-email"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="contato@lab.com.br"
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-website">Website</FieldLabel>
                        <Input
                          id="org-website"
                          value={website}
                          onChange={(e) => setWebsite(e.target.value)}
                          disabled={isUpdatingIso}
                          placeholder="https://lab.com.br"
                        />
                      </Field>
                    </div>

                    <Separator />

                    {/* Technical Manager */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field>
                        <FieldLabel htmlFor="org-technical-manager-name">
                          Responsável Técnico
                        </FieldLabel>
                        <Input
                          id="org-technical-manager-name"
                          value={technicalManagerName}
                          onChange={(e) =>
                            setTechnicalManagerName(e.target.value)
                          }
                          disabled={isUpdatingIso}
                          placeholder="Dr. João Silva"
                        />
                        <FieldDescription>
                          Nome que aparecerá nos certificados de calibração.
                        </FieldDescription>
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="org-technical-manager-title">
                          Cargo/Título
                        </FieldLabel>
                        <Input
                          id="org-technical-manager-title"
                          value={technicalManagerTitle}
                          onChange={(e) =>
                            setTechnicalManagerTitle(e.target.value)
                          }
                          disabled={isUpdatingIso}
                          placeholder="Responsável Técnico"
                        />
                      </Field>
                    </div>

                    <div className="flex justify-end">
                      <Button type="submit" disabled={isUpdatingIso}>
                        {isUpdatingIso ? 'Salvando...' : 'Salvar informações'}
                      </Button>
                    </div>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {/* Danger Zone — shown within the Organização tab */}
      {canManageOrganizationSettings && (
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="text-destructive">
              Excluir Organização
            </CardTitle>
            <CardDescription>
              Exclua permanentemente esta organização e todos os seus dados.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AlertDialog
              open={deleteDialogOpen}
              onOpenChange={(open) => {
                if (!open) {
                  setDeleteConfirmName('')
                }
                setDeleteDialogOpen(open)
              }}
            >
              <AlertDialogTrigger
                render={
                  <Button variant="destructive">
                    <HugeiconsIcon icon={Delete02Icon} />
                    Excluir organização
                  </Button>
                }
              />
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Excluir organização permanentemente?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Esta ação é irreversível. Todos os dados da organização
                    serão excluídos permanentemente, incluindo membros,
                    calibrações e certificados.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <div className="py-4">
                  <Field>
                    <FieldLabel htmlFor="delete-confirm-name">
                      Digite <strong>{activeOrg.name}</strong> para confirmar
                    </FieldLabel>
                    <Input
                      id="delete-confirm-name"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      placeholder={activeOrg.name}
                      disabled={isDeleting}
                    />
                  </Field>
                </div>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={isDeleting}>
                    Cancelar
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleDeleteOrganization}
                    disabled={
                      isDeleting || deleteConfirmName !== activeOrg.name
                    }
                    variant="destructive"
                  >
                    {isDeleting ? 'Excluindo...' : 'Excluir permanentemente'}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </>
  )
}
