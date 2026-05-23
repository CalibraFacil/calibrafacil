import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  authClient,
  organization,
  useActiveOrganization,
  useListOrganizations,
} from '@calibra-facil/auth/client'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
import { translateAuthErrorMessage } from '@calibra-facil/auth/error-messages'
import { BrandLockup } from '@/components/brand'
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
import { MaskedInput } from '@/components/ui/masked-input'
import { setStoredDashboardOrganizationId } from '@/features/dashboard/dashboard-scope-storage'
import { brazilPhoneMask, cnpjMask } from '@/lib/input-masks'

type OnboardingSearch = {
  redirect?: string
}

export const Route = createFileRoute('/onboarding/organization')({
  validateSearch: (search: Record<string, unknown>): OnboardingSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: async () => {
    const { data: session } = await authClient.getSession()

    if (!session) {
      throw redirect({ to: '/sign-in' })
    }

    if (
      canAccessBackoffice(session.user.role) &&
      !session.session.impersonatedBy
    ) {
      throw redirect({ to: '/backoffice' })
    }
  },
  component: OrganizationOnboardingPage,
})

function OrganizationOnboardingPage() {
  const navigate = useNavigate()
  const { redirect: redirectTo } = Route.useSearch()
  const { data: organizations, isPending: isLoadingOrganizations } =
    useListOrganizations()
  const { data: activeOrganization, isPending: isLoadingActiveOrganization } =
    useActiveOrganization()

  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const labOrganizations = useMemo(
    () => (organizations ?? []).filter((org) => org.type !== 'CLIENT'),
    [organizations],
  )
  const activeLabOrganization =
    activeOrganization && activeOrganization.type !== 'CLIENT'
      ? activeOrganization
      : null
  const labOrganization =
    activeLabOrganization ??
    (labOrganizations.length === 1 ? labOrganizations[0] : null)
  const isPending = isLoadingOrganizations || isLoadingActiveOrganization

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!labOrganization) return

    const formData = new FormData(event.currentTarget)
    setError(null)
    setIsSubmitting(true)

    try {
      const activeResult = await organization.setActive({
        organizationId: labOrganization.id,
      })

      if (activeResult.error) {
        setError(
          translateAuthErrorMessage(
            activeResult.error.message,
            'Falha ao ativar laboratório',
          ),
        )
        return
      }

      const result = await authClient.organization.update({
        data: {
          cnpj: optionalFormText(formData.get('cnpj')),
          phone: optionalFormText(formData.get('phone')),
          email: optionalFormText(formData.get('email')),
        },
      })

      if (result.error) {
        setError(
          translateAuthErrorMessage(
            result.error.message,
            'Falha ao atualizar laboratório',
          ),
        )
        return
      }

      setStoredDashboardOrganizationId(labOrganization.id)
      navigate({ to: redirectTo || '/dashboard' })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Falha ao concluir onboarding',
      )
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="min-h-svh bg-muted/30 px-6 py-10">
      <div className="mx-auto flex max-w-5xl flex-col gap-8">
        <div className="flex items-center gap-3">
          <BrandLockup markClassName="size-8" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Complete o laboratório</CardTitle>
              <CardDescription>
                Revise os dados iniciais da organização provisionada pela equipe
                CalibraFácil.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
                  Carregando laboratório...
                </div>
              ) : !labOrganization ? (
                <div className="space-y-4">
                  <div className="rounded-md border p-4 text-sm text-muted-foreground">
                    Sua conta ainda não está vinculada a um laboratório LAB.
                    Peça ao responsável pelo provisionamento para concluir a
                    criação da organização e enviar o link de setup.
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => navigate({ to: '/sign-in' })}
                  >
                    Voltar para login
                  </Button>
                </div>
              ) : (
                <form className="space-y-6" onSubmit={handleSubmit}>
                  <FieldGroup>
                    {error ? (
                      <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                        {error}
                      </div>
                    ) : null}

                    <div className="rounded-md border p-4 text-sm">
                      <p className="font-medium">{labOrganization.name}</p>
                      <p className="text-muted-foreground">
                        {labOrganization.slug}
                      </p>
                    </div>

                    <Field>
                      <FieldLabel htmlFor="org-email">
                        Email do laboratório
                      </FieldLabel>
                      <Input
                        id="org-email"
                        name="email"
                        type="email"
                        defaultValue={labOrganization.email ?? ''}
                        placeholder="contato@laboratorio.com"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="org-phone">Telefone</FieldLabel>
                      <MaskedInput
                        id="org-phone"
                        name="phone"
                        type="tel"
                        inputMode="tel"
                        maskOptions={brazilPhoneMask}
                        defaultValue={labOrganization.phone ?? ''}
                        placeholder="(11) 99999-9999"
                      />
                    </Field>

                    <Field>
                      <FieldLabel htmlFor="org-cnpj">CNPJ</FieldLabel>
                      <MaskedInput
                        id="org-cnpj"
                        name="cnpj"
                        maskOptions={cnpjMask}
                        defaultValue={labOrganization.cnpj ?? ''}
                        placeholder="00.000.000/0001-00"
                      />
                      <FieldDescription>
                        Dados de acreditação, endereço completo e responsável
                        técnico continuam editáveis nas configurações.
                      </FieldDescription>
                    </Field>

                    <Field>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting
                          ? 'Salvando laboratório...'
                          : 'Concluir onboarding'}
                      </Button>
                    </Field>
                  </FieldGroup>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle>O que acontece depois</CardTitle>
              <CardDescription>
                O laboratório já foi criado e vinculado ao seu usuário.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Este fluxo atualiza a organização existente.</p>
              <p>Você poderá acessar o dashboard e convidar a equipe.</p>
              <p>
                Novas contas LAB continuam sendo criadas pelo backoffice ou por
                convites de administradores.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function optionalFormText(value: FormDataEntryValue | null) {
  return typeof value === 'string' ? value.trim() || undefined : undefined
}
