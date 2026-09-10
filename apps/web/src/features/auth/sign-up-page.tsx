import { useState, type FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { motion } from 'motion/react'
import { formatPrice, PLAN_PRICES, PLANS } from '@calibra-facil/shared'
import {
  AuthStatusMessage,
  type AuthStatus,
} from '@/components/auth-status-message'
import { BrandLockup, BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { MaskedInput } from '@/components/ui/masked-input'
import { Spinner } from '@/components/ui/spinner'
import { AuthShaderPanel } from '@/features/auth/components/auth-shader-panel'
import { brazilPhoneMask, cnpjMask } from '@/lib/input-masks'
import { calibraApi } from '@/utils/api'
import {
  emptySignUpForm,
  parseSignUpForm,
  type SignUpFormData,
  type SignUpFormField,
} from './sign-up-forms'

type SelfServePlanId = 'STANDARD' | 'PROFESSIONAL' | 'ADVANCED'

type SignUpPageProps = {
  planId: SelfServePlanId
  billingCycle: 'MONTHLY' | 'YEARLY'
}

// Matches the sign-in scene spring, so moving between the two pages feels like
// one surface rather than two screens.
const revealSpring = { type: 'spring', duration: 0.5, bounce: 0 } as const

/**
 * Self-serve account opening, on the same split canvas as sign-in.
 *
 * The account is created on the free tier and the chosen plan travels with the
 * access link, so nobody is asked for money before they have seen the product
 * — which is also why the price appears here as a reminder, not as a checkout.
 */
export function SignUpPage({ planId, billingCycle }: SignUpPageProps) {
  const [form, setForm] = useState<SignUpFormData>(emptySignUpForm)
  const [errors, setErrors] = useState<
    Partial<Record<SignUpFormField, string>>
  >({})
  const [status, setStatus] = useState<AuthStatus | null>(null)
  const [pending, setPending] = useState(false)
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [deliveryFailure, setDeliveryFailure] = useState<string | null>(null)
  // Honeypot: hidden from people, filled by bots.
  const [website, setWebsite] = useState('')

  const plan = PLANS[planId]
  const prices = PLAN_PRICES[planId]
  const monthlyEquivalent =
    billingCycle === 'YEARLY' ? prices.yearly / 12 : prices.monthly

  function updateField(field: SignUpFormField, value: string) {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setStatus(null)
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrors({})
    setStatus(null)

    const parsed = parseSignUpForm(form, { planId, billingCycle, website })
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.fieldErrors.map((item) => [item.field, item.message]),
        ),
      )
      setStatus({ tone: 'error', title: 'Confira os campos destacados.' })
      return
    }

    setPending(true)
    try {
      const result = await calibraApi.publicSignup.start(parsed.data)
      // The API answers 202 when the account exists but the setup e-mail could
      // not be sent. Claiming "confira o seu e-mail" there strands someone
      // waiting for a message that never comes, and retrying finds the account
      // and refuses it.
      setSentTo(parsed.data.email)
      setDeliveryFailure(
        result.emailDelivered === false
          ? (result.error ??
              'A conta foi criada, mas não conseguimos enviar o e-mail de acesso agora. Nossa equipe reenvia o link para você.')
          : null,
      )
    } catch (error) {
      setStatus({
        tone: 'error',
        title: 'Não foi possível criar a conta',
        description:
          error instanceof Error
            ? error.message
            : 'Tente novamente em alguns instantes.',
      })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col gap-4 p-6 md:p-10">
        <div className="flex justify-center gap-2 md:justify-start">
          <Link to="/" className="flex items-center gap-2 font-medium">
            <BrandLockup markClassName="size-7" />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-sm">
            {sentTo ? (
              <SentPanel email={sentTo} deliveryFailure={deliveryFailure} />
            ) : (
              <motion.form
                onSubmit={handleSubmit}
                noValidate
                className="flex flex-col gap-6"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={revealSpring}
              >
                <FieldGroup>
                  <div className="flex flex-col items-center gap-3 text-center">
                    <BrandMark className="size-12" />
                    <h1 className="text-2xl font-bold">
                      Criar a conta do laboratório
                    </h1>
                    <p className="text-muted-foreground text-sm text-balance">
                      Plano {plan.name} ·{' '}
                      {formatPrice(Math.round(monthlyEquivalent))}/mês{' '}
                      {billingCycle === 'YEARLY' ? 'no anual' : 'no mensal'}. O
                      pagamento é feito depois de entrar.
                    </p>
                  </div>

                  {status ? <AuthStatusMessage status={status} /> : null}

                  <Field>
                    <FieldLabel htmlFor="signup-lab">Laboratório</FieldLabel>
                    <Input
                      id="signup-lab"
                      value={form.labName}
                      onChange={(event) =>
                        updateField('labName', event.target.value)
                      }
                      placeholder="Metrologia Exemplo Ltda."
                      autoComplete="organization"
                      aria-invalid={Boolean(errors.labName)}
                    />
                    {errors.labName ? (
                      <FieldDescription className="text-destructive">
                        {errors.labName}
                      </FieldDescription>
                    ) : null}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="signup-cnpj">CNPJ</FieldLabel>
                    <MaskedInput
                      id="signup-cnpj"
                      name="cnpj"
                      inputMode="numeric"
                      maskOptions={cnpjMask}
                      value={form.cnpj}
                      onChange={(event) =>
                        updateField('cnpj', event.target.value)
                      }
                      placeholder="00.000.000/0000-00"
                      aria-invalid={Boolean(errors.cnpj)}
                    />
                    <FieldDescription
                      className={errors.cnpj ? 'text-destructive' : undefined}
                    >
                      {errors.cnpj ?? 'Usado no cadastro e na cobrança.'}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="signup-name">Seu nome</FieldLabel>
                    <Input
                      id="signup-name"
                      value={form.name}
                      onChange={(event) =>
                        updateField('name', event.target.value)
                      }
                      placeholder="Nome e sobrenome"
                      autoComplete="name"
                      aria-invalid={Boolean(errors.name)}
                    />
                    {errors.name ? (
                      <FieldDescription className="text-destructive">
                        {errors.name}
                      </FieldDescription>
                    ) : null}
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="signup-email">
                      E-mail do laboratório
                    </FieldLabel>
                    <Input
                      id="signup-email"
                      type="email"
                      value={form.email}
                      onChange={(event) =>
                        updateField('email', event.target.value)
                      }
                      placeholder="voce@seulaboratorio.com.br"
                      autoComplete="email"
                      aria-invalid={Boolean(errors.email)}
                    />
                    <FieldDescription
                      className={errors.email ? 'text-destructive' : undefined}
                    >
                      {errors.email ??
                        'Use o e-mail do domínio do laboratório. Endereços pessoais não são aceitos.'}
                    </FieldDescription>
                  </Field>

                  <Field>
                    <FieldLabel htmlFor="signup-phone">
                      Telefone{' '}
                      <span className="text-muted-foreground font-normal">
                        (opcional)
                      </span>
                    </FieldLabel>
                    <MaskedInput
                      id="signup-phone"
                      name="phone"
                      type="tel"
                      inputMode="tel"
                      maskOptions={brazilPhoneMask}
                      value={form.phone}
                      onChange={(event) =>
                        updateField('phone', event.target.value)
                      }
                      placeholder="(51) 99999-9999"
                    />
                  </Field>

                  {/* Honeypot — hidden from users, catches bots. */}
                  <div aria-hidden className="hidden">
                    <label htmlFor="signup-website">
                      Não preencha este campo
                    </label>
                    <input
                      id="signup-website"
                      tabIndex={-1}
                      autoComplete="off"
                      value={website}
                      onChange={(event) => setWebsite(event.target.value)}
                    />
                  </div>

                  <Field>
                    <Button type="submit" disabled={pending}>
                      {pending ? (
                        <>
                          <Spinner className="mr-2" />
                          Criando conta...
                        </>
                      ) : (
                        'Criar conta'
                      )}
                    </Button>
                    <FieldDescription className="text-center">
                      Ao criar a conta você concorda com os{' '}
                      <Link
                        to="/termos-de-uso"
                        className="underline underline-offset-4"
                      >
                        Termos de uso
                      </Link>{' '}
                      e a{' '}
                      <Link
                        to="/privacidade"
                        className="underline underline-offset-4"
                      >
                        Política de privacidade
                      </Link>
                      .
                    </FieldDescription>
                  </Field>
                </FieldGroup>
              </motion.form>
            )}

            <p className="text-muted-foreground mt-6 text-center text-sm">
              Já tem acesso?{' '}
              <Link to="/sign-in" className="underline underline-offset-4">
                Entrar
              </Link>
            </p>
          </div>
        </div>
      </div>

      <div className="hidden p-3 lg:block">
        <AuthShaderPanel
          title="Seu laboratório, funcionando hoje."
          description="Cálculo de incerteza, certificado assinado em ICP-Brasil, revisão com papéis distintos e trilha de auditoria já no primeiro plano. A norma não fica em plano caro."
        />
      </div>
    </div>
  )
}

/** Replaces the form once the access link is on its way. */
function SentPanel({
  email,
  deliveryFailure,
}: {
  email: string
  /** Set when the account exists but the setup e-mail could not be sent. */
  deliveryFailure: string | null
}) {
  return (
    <motion.div
      className="flex flex-col items-center gap-3 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={revealSpring}
    >
      <BrandMark className="size-12" />
      <h1 className="text-2xl font-bold">
        {deliveryFailure ? 'Conta criada' : 'Confira o seu e-mail'}
      </h1>
      {deliveryFailure ? (
        <>
          <p className="text-muted-foreground text-sm text-balance">
            O laboratório foi cadastrado com <strong>{email}</strong>.
          </p>
          <AuthStatusMessage
            className="mt-2 text-left"
            status={{
              tone: 'error',
              title: 'O e-mail de acesso não saiu',
              description: deliveryFailure,
            }}
          />
        </>
      ) : (
        <>
          <p className="text-muted-foreground text-sm text-balance">
            Enviamos o link de acesso para <strong>{email}</strong>. Não existe
            senha para definir.
          </p>
          <AuthStatusMessage
            className="mt-2 text-left"
            status={{
              tone: 'info',
              title: 'Não chegou em alguns minutos?',
              description:
                'Confira a caixa de spam e se o endereço está no domínio do laboratório.',
            }}
          />
        </>
      )}
    </motion.div>
  )
}
