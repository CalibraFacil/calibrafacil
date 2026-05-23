import { Link } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'

import { useBackofficeOrganizationsData } from '@/features/backoffice/queries'
import { calibraApi } from '@/utils/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Skeleton } from '@/components/ui/skeleton'

const organizationSkeletonKeys = ['first', 'second', 'third', 'fourth']

export function BackofficeOrganizationsPage() {
  const queryClient = useQueryClient()
  const organizationsQuery = useBackofficeOrganizationsData('list')
  const [labName, setLabName] = useState('')
  const [labSlug, setLabSlug] = useState('')
  const [labCnpj, setLabCnpj] = useState('')
  const [labEmail, setLabEmail] = useState('')
  const [labPhone, setLabPhone] = useState('')
  const [ownerName, setOwnerName] = useState('')
  const [ownerEmail, setOwnerEmail] = useState('')
  const [planId, setPlanId] = useState('FREE')

  const provisionLabMutation = useMutation({
    mutationFn: () =>
      calibraApi.backoffice.provisionLab<{
        organization: { id: string; name: string; slug: string }
        passwordSetupRequested: boolean
        passwordSetupMessage: string
      }>({
        lab: {
          name: labName,
          slug: labSlug,
          cnpj: labCnpj,
          email: labEmail,
          phone: labPhone,
          planId,
        },
        owner: {
          name: ownerName,
          email: ownerEmail,
        },
        onboarding: {
          sendSetupEmail: true,
        },
      }),
    onSuccess: async (result) => {
      toast.success(
        result.passwordSetupRequested
          ? 'Laboratório provisionado e setup enviado.'
          : result.passwordSetupMessage,
      )
      setLabName('')
      setLabSlug('')
      setLabCnpj('')
      setLabEmail('')
      setLabPhone('')
      setOwnerName('')
      setOwnerEmail('')
      setPlanId('FREE')
      await queryClient.invalidateQueries({
        queryKey: ['backoffice', 'organizations'],
      })
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Falha ao provisionar laboratório',
      )
    },
  })

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Organizações</h1>
        <p className="text-sm text-muted-foreground">
          Visão consolidada das contas LAB, unidades, integrações e suporte.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Provisionar LAB</CardTitle>
          <CardDescription>
            Cria a organização, vincula o proprietário e envia o link de
            definição de senha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 lg:grid-cols-6"
            onSubmit={(event) => {
              event.preventDefault()
              provisionLabMutation.mutate()
            }}
          >
            <FieldGroup className="lg:col-span-3">
              <Field>
                <FieldLabel htmlFor="lab-name">Laboratório</FieldLabel>
                <Input
                  id="lab-name"
                  value={labName}
                  onChange={(event) => setLabName(event.target.value)}
                  placeholder="Laboratório Exemplo"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="lab-slug">Slug</FieldLabel>
                <Input
                  id="lab-slug"
                  value={labSlug}
                  onChange={(event) => setLabSlug(event.target.value)}
                  placeholder="laboratorio-exemplo"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="lab-cnpj">CNPJ</FieldLabel>
                <Input
                  id="lab-cnpj"
                  value={labCnpj}
                  onChange={(event) => setLabCnpj(event.target.value)}
                  placeholder="00.000.000/0001-00"
                />
              </Field>
            </FieldGroup>

            <FieldGroup className="lg:col-span-3">
              <Field>
                <FieldLabel htmlFor="owner-name">Proprietário</FieldLabel>
                <Input
                  id="owner-name"
                  value={ownerName}
                  onChange={(event) => setOwnerName(event.target.value)}
                  placeholder="Nome do responsável"
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="owner-email">
                  Email do proprietário
                </FieldLabel>
                <Input
                  id="owner-email"
                  type="email"
                  value={ownerEmail}
                  onChange={(event) => setOwnerEmail(event.target.value)}
                  placeholder="responsavel@laboratorio.com"
                  required
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="lab-email">Email LAB</FieldLabel>
                  <Input
                    id="lab-email"
                    type="email"
                    value={labEmail}
                    onChange={(event) => setLabEmail(event.target.value)}
                    placeholder="contato@laboratorio.com"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lab-phone">Telefone</FieldLabel>
                  <Input
                    id="lab-phone"
                    value={labPhone}
                    onChange={(event) => setLabPhone(event.target.value)}
                    placeholder="(11) 99999-9999"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="lab-plan">Plano</FieldLabel>
                  <NativeSelect
                    id="lab-plan"
                    className="w-full"
                    value={planId}
                    onChange={(event) => setPlanId(event.target.value)}
                  >
                    <NativeSelectOption value="FREE">Free</NativeSelectOption>
                    <NativeSelectOption value="STANDARD">
                      Standard
                    </NativeSelectOption>
                    <NativeSelectOption value="PROFESSIONAL">
                      Professional
                    </NativeSelectOption>
                    <NativeSelectOption value="ENTERPRISE">
                      Enterprise
                    </NativeSelectOption>
                  </NativeSelect>
                </Field>
              </div>
            </FieldGroup>

            <div className="lg:col-span-6">
              <Button type="submit" disabled={provisionLabMutation.isPending}>
                {provisionLabMutation.isPending
                  ? 'Provisionando...'
                  : 'Provisionar laboratório'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contas LAB</CardTitle>
          <CardDescription>
            Use esta área para inspecionar o estado operacional de cada conta.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {organizationsQuery.isPending
            ? organizationSkeletonKeys.map((key) => (
                <Skeleton key={key} className="h-20 w-full" />
              ))
            : organizationsQuery.data?.data.map((org) => (
                <div
                  key={org.id}
                  className="rounded-lg border p-4 transition-colors hover:bg-muted/40"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{org.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {org.slug}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Onboarding: {org.onboardingStatus ?? 'Não iniciado'} ·
                        Migração: {org.migrationStatus ?? 'Não necessário'}
                      </p>
                    </div>
                    <div className="text-sm text-muted-foreground md:text-right">
                      <p>{org.unitsCount} unidades</p>
                      <p>{org.integrationsCount} integrações</p>
                      <p>{org.openRequestsCount} solicitações abertas</p>
                    </div>
                  </div>
                  <div className="mt-3">
                    <Link
                      to="/backoffice/organizations/$id"
                      params={{ id: org.id }}
                      className="text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Abrir organização
                    </Link>
                  </div>
                </div>
              ))}
        </CardContent>
      </Card>
    </div>
  )
}
