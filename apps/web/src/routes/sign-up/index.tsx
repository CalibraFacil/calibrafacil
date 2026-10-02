import { createFileRoute } from '@tanstack/react-router'
import { SignUpPage } from '@/features/auth/sign-up-page'

export const Route = createFileRoute('/sign-up/')({
  head: () => ({
    meta: [
      {
        title: 'Criar conta | CalibraFácil',
        name: 'description',
        content: 'Abrir a conta do seu laboratório no CalibraFácil',
      },
    ],
  }),
  component: SignUpRoute,
})

function SignUpRoute() {
  return <SignUpPage />
}
