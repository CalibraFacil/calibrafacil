import { Link, createFileRoute } from '@tanstack/react-router'
import { BrandLockup } from '@/components/brand'
import { SignInForm } from '@/components/sign-in-form'

type SignInSearch = {
  redirect?: string
}

export const Route = createFileRoute('/sign-in/')({
  validateSearch: (search: Record<string, unknown>): SignInSearch => ({
    redirect: typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  head: () => ({
    meta: [
      {
        title: 'Entrar | CalibraFácil',
        name: 'description',
        content: 'Entrar em sua conta CalibraFácil',
      },
    ],
  }),
  component: SignInPage,
})

function SignInPage() {
  const { redirect } = Route.useSearch()
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
            <SignInForm redirect={redirect} />
          </div>
        </div>
      </div>

      <div className="relative hidden lg:flex flex-col items-center justify-center overflow-hidden bg-muted p-10">
        <div className="absolute inset-0 bg-linear-to-br from-primary/10 via-muted to-chart-1/10" />

        <div className="absolute -top-1/2 -left-1/2 h-full w-full rounded-full bg-chart-1/20 blur-[100px]" />
        <div className="absolute -bottom-1/2 -right-1/2 h-full w-full rounded-full bg-primary/20 blur-[100px]" />

        <div className="relative z-10 mt-auto">
          <blockquote className="space-y-2">
            <p className="text-lg">
              &ldquo;O CalibraFácil é a solução perfeita para a gestão
              metrológica de laboratórios. Simplifica nossos processos e nos
              ajuda a atender melhor nossos clientes.&rdquo;
            </p>
            <footer className="text-sm">João Santos</footer>
          </blockquote>
        </div>
      </div>
    </div>
  )
}
