import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { BrandLockup } from '@/components/brand'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { getApiBaseURL } from '@/utils/api'

const previewSchema = z.discriminatedUnion('found', [
  z.object({ found: z.literal(false) }),
  z.object({
    found: z.literal(true),
    name: z.string(),
    email: z.string(),
    image: z.string().nullable(),
    organizationName: z.string().nullable(),
    organizationLogo: z.string().nullable(),
  }),
])

type MagicLinkPreview = z.infer<typeof previewSchema>

async function fetchMagicLinkPreview(token: string): Promise<MagicLinkPreview> {
  const url = new URL('/api/magic-link/preview', getApiBaseURL())
  url.searchParams.set('token', token)
  const response = await fetch(url.toString(), { credentials: 'include' })
  if (!response.ok) return { found: false }
  const parsed = previewSchema.safeParse(await response.json())
  return parsed.success ? parsed.data : { found: false }
}

function isFoundPreview(
  value: MagicLinkPreview | undefined,
): value is Extract<MagicLinkPreview, { found: true }> {
  return value?.found === true
}

function getInitials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1] ?? '') : ''
  const initials = (first.charAt(0) + last.charAt(0)).trim()
  return (initials || first.slice(0, 2)).toUpperCase()
}

type MagicLinkConfirmPageProps = {
  token?: string
  callbackURL?: string
}

export function MagicLinkConfirmPage({
  token,
  callbackURL,
}: MagicLinkConfirmPageProps) {
  const [entering, setEntering] = useState(false)

  const previewQuery = useQuery({
    queryKey: ['magic-link-preview', token],
    queryFn: () => fetchMagicLinkPreview(token ?? ''),
    enabled: !!token,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  })

  function handleEnter() {
    if (!token) return
    setEntering(true)
    const verifyUrl = new URL(
      '/api/auth/lab/magic-link/verify',
      getApiBaseURL(),
    )
    verifyUrl.searchParams.set('token', token)
    if (callbackURL) verifyUrl.searchParams.set('callbackURL', callbackURL)
    window.location.href = verifyUrl.toString()
  }

  if (!token) {
    return (
      <Shell>
        <Card className="w-full max-w-sm">
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <h1 className="text-lg font-semibold">Link inválido</h1>
            <p className="text-sm text-muted-foreground">
              Este link de acesso está incompleto. Solicite um novo link na tela
              de entrada.
            </p>
          </CardContent>
        </Card>
      </Shell>
    )
  }

  const preview = isFoundPreview(previewQuery.data) ? previewQuery.data : null
  const loading = previewQuery.isLoading

  return (
    <Shell>
      <Card className="w-full max-w-sm overflow-hidden border-border/60 shadow-xl">
        <div className="flex flex-col items-center gap-4 border-b border-border/60 bg-muted/30 px-6 pt-8 pb-6 text-center">
          <Avatar className="size-20 border-4 border-background shadow-sm">
            {preview?.image ? (
              <AvatarImage src={preview.image} alt={preview.name} />
            ) : null}
            <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">
              {preview ? (
                getInitials(preview.name)
              ) : (
                <Spinner className="size-5" />
              )}
            </AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Bem-vindo de volta
            </p>
            <h1 className="text-xl font-semibold leading-tight">
              {loading
                ? 'Preparando seu acesso…'
                : (preview?.name ?? 'Entrar no CalibraFácil')}
            </h1>
            {preview ? (
              <p className="text-sm text-muted-foreground">{preview.email}</p>
            ) : null}
          </div>
        </div>

        <CardContent className="space-y-5 px-6 py-6">
          {preview?.organizationName ? (
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background px-3 py-2.5">
              {preview.organizationLogo ? (
                <img
                  src={preview.organizationLogo}
                  alt=""
                  className="size-9 shrink-0 rounded-md object-contain"
                />
              ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-sm font-semibold text-primary">
                  {getInitials(preview.organizationName)}
                </div>
              )}
              <div className="min-w-0 text-left">
                <p className="text-xs text-muted-foreground">Laboratório</p>
                <p className="truncate text-sm font-medium">
                  {preview.organizationName}
                </p>
              </div>
            </div>
          ) : null}

          <Button
            className="w-full"
            size="lg"
            onClick={handleEnter}
            disabled={entering}
          >
            {entering ? (
              <>
                <Spinner className="size-4" />
                Entrando…
              </>
            ) : (
              'Entrar no CalibraFácil'
            )}
          </Button>
        </CardContent>

        <CardFooter className="justify-center border-t border-border/60 bg-muted/20 px-6 py-4">
          <p className="text-center text-xs text-muted-foreground">
            Confirme que foi você para concluir o acesso. Este link é de uso
            único e expira em alguns minutos.
          </p>
        </CardFooter>
      </Card>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-gradient-to-b from-background to-muted/40 px-4 py-12">
      <BrandLockup />
      {children}
    </main>
  )
}
