import { createFileRoute } from '@tanstack/react-router'
import { MagicLinkConfirmPage } from '@/features/auth/magic-link-confirm-page'

type MagicLinkSearch = {
  token?: string
  callbackURL?: string
}

export const Route = createFileRoute('/magic-link')({
  validateSearch: (search: Record<string, unknown>): MagicLinkSearch => ({
    token: typeof search.token === 'string' ? search.token : undefined,
    callbackURL:
      typeof search.callbackURL === 'string' ? search.callbackURL : undefined,
  }),
  head: () => ({
    meta: [{ title: 'Entrar | CalibraFácil' }],
  }),
  component: MagicLinkRoute,
})

function MagicLinkRoute() {
  const { token, callbackURL } = Route.useSearch()
  return <MagicLinkConfirmPage token={token} callbackURL={callbackURL} />
}
