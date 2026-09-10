/**
 * What to tell someone signing out of the desktop with unsent work.
 *
 * Their queued calibrations stay in *their* local database and are never
 * deleted, transferred, or uploaded under whoever signs in next — but the
 * person walking away from a shared bench PC cannot see that, and "did my
 * field work just vanish?" is not a question to leave open.
 *
 * A warning, not a block: sign-out is how you hand the machine over, and a lab
 * that cannot sign out because sync is behind is worse than one that warns.
 */

export type SignOutWarning = {
  title: string
  description: string
  confirmLabel: string
}

export function resolveSignOutWarning({
  isDesktop,
  pendingOutboxCount,
}: {
  isDesktop: boolean
  pendingOutboxCount: number
}): SignOutWarning | null {
  // The browser queues nothing locally; there is nothing to leave behind.
  if (!isDesktop) return null
  if (!Number.isFinite(pendingOutboxCount) || pendingOutboxCount <= 0) {
    return null
  }

  const count = Math.trunc(pendingOutboxCount)

  return {
    // Written out rather than composed: the whole clause inflects, not just a
    // noun, and stitching it from fragments is how "alteraçãoes" happened.
    title:
      count === 1
        ? '1 alteração ainda não foi enviada'
        : `${count} alterações ainda não foram enviadas`,
    description:
      'Elas ficam salvas neste computador, na sua conta, e serão enviadas quando você entrar novamente com conexão. Nenhum outro usuário deste computador terá acesso a elas.',
    confirmLabel: 'Sair mesmo assim',
  }
}
