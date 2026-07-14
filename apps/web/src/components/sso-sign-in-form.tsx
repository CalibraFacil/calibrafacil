import { useState } from 'react'
import { ArrowLeft01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { calibraApi } from '@/utils/api'
import { clearDesktopSignedOut } from '@/runtime/desktop-auth'
import { cn } from '@/lib/utils'
import { sanitizeLabRedirect } from '@/lib/auth-redirect'
import {
  AuthStatusMessage,
  type AuthStatus,
} from '@/components/auth-status-message'
import { BrandMark } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface SsoSignInFormProps extends React.ComponentProps<'form'> {
  redirect?: string
  onBack?: () => void
}

export function SsoSignInForm({
  className,
  redirect,
  onBack,
  ...props
}: SsoSignInFormProps) {
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [ssoEmail, setSsoEmail] = useState('')
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null)
  const [isSsoLoading, setIsSsoLoading] = useState(false)

  async function handleSsoSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    setAuthStatus(null)
    setIsSsoLoading(true)

    try {
      const data = await calibraApi.sso.start({
        organizationSlug,
        ...(ssoEmail ? { email: ssoEmail } : {}),
        redirectPath: sanitizeLabRedirect(redirect),
      })
      if (!data.url) {
        setAuthStatus({
          tone: 'error',
          title: 'Falha ao iniciar login via SSO',
        })
        return
      }

      clearDesktopSignedOut()
      window.location.assign(data.url)
    } catch {
      setAuthStatus({
        tone: 'error',
        title: 'Falha ao iniciar login via SSO',
      })
    } finally {
      setIsSsoLoading(false)
    }
  }

  return (
    <form
      className={cn('flex flex-col gap-6', className)}
      onSubmit={handleSsoSubmit}
      {...props}
    >
      <FieldGroup>
        <div className="flex flex-col items-center gap-3 text-center">
          <BrandMark className="size-12" />
          <h1 className="text-2xl font-bold text-balance">SSO corporativo</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Entre com o provedor de identidade da sua organização
          </p>
        </div>
        {authStatus ? <AuthStatusMessage status={authStatus} /> : null}
        <Field>
          <FieldLabel htmlFor="organizationSlug">
            Slug da organização
          </FieldLabel>
          <Input
            id="organizationSlug"
            value={organizationSlug}
            onChange={(e) => setOrganizationSlug(e.target.value)}
            placeholder="laboratorio-acreditado"
            required
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="ssoEmail">
            Email corporativo{' '}
            <span className="text-muted-foreground font-normal">
              (opcional)
            </span>
          </FieldLabel>
          <Input
            id="ssoEmail"
            type="email"
            value={ssoEmail}
            onChange={(e) => setSsoEmail(e.target.value)}
            placeholder="voce@empresa.com.br"
            required={false}
          />
        </Field>
        <Field>
          <Button
            type="submit"
            disabled={isSsoLoading || !organizationSlug.trim()}
          >
            {isSsoLoading ? (
              <>
                <Spinner className="mr-2" />
                Redirecionando...
              </>
            ) : (
              'Entrar com SSO'
            )}
          </Button>
        </Field>
        {onBack ? (
          <Field>
            <Button type="button" variant="ghost" onClick={onBack}>
              <HugeiconsIcon icon={ArrowLeft01Icon} className="size-4" />
              Voltar para passkey ou email
            </Button>
          </Field>
        ) : null}
      </FieldGroup>
    </form>
  )
}
