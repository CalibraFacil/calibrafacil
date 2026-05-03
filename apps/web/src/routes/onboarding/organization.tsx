import {
  Navigate,
  createFileRoute,
  redirect,
  useNavigate,
} from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import {
  authClient,
  organization,
  useListOrganizations,
} from '@calibra-facil/auth/client'
import { canAccessBackoffice } from '@calibra-facil/auth/access'
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
import { brazilPhoneMask, cnpjMask } from '@/lib/input-masks'

type OnboardingSearch = {
  redirect?: string
}

function generateSlug(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
  const { data: organizations, isPending } = useListOrganizations()

  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasLabOrganization = useMemo(
    () => (organizations ?? []).some((org) => org.type !== 'CLIENT'),
    [organizations],
  )

  if (!isPending && hasLabOrganization) {
    return <Navigate to={redirectTo || '/dashboard'} />
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    setIsSubmitting(true)

    const trimmedName = name.trim()
    const resolvedSlug =
      generateSlug(slug.trim() || trimmedName) || 'laboratorio'

    try {
      const { data, error: createError } = await organization.create({
        name: trimmedName,
        slug: resolvedSlug,
        type: 'LAB',
        cnpj: cnpj.trim(),
        accreditationNumber: '',
        accreditationBody: '',
        street: '',
        number: '',
        complement: '',
        neighbourhood: '',
        city: '',
        state: '',
        cep: '',
        phone: phone.trim(),
        email: email.trim(),
        website: '',
        technicalManagerName: '',
        technicalManagerTitle: '',
      })

      if (createError) {
        setError(createError.message ?? 'Falha ao criar laboratório')
        return
      }

      if (data?.id) {
        await organization.setActive({ organizationId: data.id })
        localStorage.setItem('dashboard-active-org', data.id)
      }

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
              <CardTitle>Crie seu laboratório</CardTitle>
              <CardDescription>
                Complete o onboarding com os dados mínimos da sua organização
                para acessar o dashboard.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-6" onSubmit={handleSubmit}>
                <FieldGroup>
                  {error ? (
                    <div className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
                      {error}
                    </div>
                  ) : null}

                  <Field>
                    <FieldLabel htmlFor="org-name">
                      Nome do laboratório
                    </FieldLabel>
                    <Input
                      id="org-name"
                      value={name}
                      onChange={(event) => {
                        const nextName = event.target.value
                        setName(nextName)
                        setSlug(generateSlug(nextName))
                      }}
                      placeholder="Ex.: Laboratório Exemplo"
                      required
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
                    <Input
                      id="org-slug"
                      value={slug}
                      onChange={(event) =>
                        setSlug(generateSlug(event.target.value))
                      }
                      placeholder="laboratorio-exemplo"
                      required
                    />
                    <FieldDescription>
                      Esse identificador será usado nas URLs internas.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="org-email">
                      Email do laboratório
                    </FieldLabel>
                    <Input
                      id="org-email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="contato@laboratorio.com"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="org-phone">Telefone</FieldLabel>
                    <MaskedInput
                      id="org-phone"
                      type="tel"
                      inputMode="tel"
                      maskOptions={brazilPhoneMask}
                      value={phone}
                      onInput={(event) => setPhone(event.currentTarget.value)}
                      placeholder="(11) 99999-9999"
                    />
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="org-cnpj">CNPJ</FieldLabel>
                    <MaskedInput
                      id="org-cnpj"
                      maskOptions={cnpjMask}
                      value={cnpj}
                      onInput={(event) => setCnpj(event.currentTarget.value)}
                      placeholder="00.000.000/0001-00"
                    />
                    <FieldDescription>
                      Pode ser preenchido depois nas configurações da
                      organização.
                    </FieldDescription>
                  </Field>

                  <Field>
                    <Button
                      type="submit"
                      disabled={isSubmitting || !name.trim()}
                    >
                      {isSubmitting
                        ? 'Criando laboratório...'
                        : 'Concluir onboarding'}
                    </Button>
                  </Field>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>

          <Card className="bg-background/80">
            <CardHeader>
              <CardTitle>O que acontece depois</CardTitle>
              <CardDescription>
                O restante dos dados institucionais continua editável no painel.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Seu primeiro laboratório LAB será criado e ativado.</p>
              <p>Você poderá acessar o dashboard imediatamente.</p>
              <p>
                Este fluxo é exclusivo para contas do laboratório. Contas
                internas da plataforma devem usar o backoffice.
              </p>
              <p>
                Campos de ISO 17025, acreditação e endereço completo podem ser
                preenchidos depois em Configurações &gt; Organização.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
