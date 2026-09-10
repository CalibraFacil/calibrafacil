import { describe, expect, it } from 'vitest'

import { resolveSignOutWarning } from './sign-out-warning'

describe('resolveSignOutWarning', () => {
  it('says nothing in the browser, which queues nothing locally', () => {
    expect(
      resolveSignOutWarning({ isDesktop: false, pendingOutboxCount: 7 }),
    ).toBeNull()
  })

  it('says nothing when everything is synced', () => {
    expect(
      resolveSignOutWarning({ isDesktop: true, pendingOutboxCount: 0 }),
    ).toBeNull()
  })

  it('warns about unsent work, in agreement with the count', () => {
    expect(
      resolveSignOutWarning({ isDesktop: true, pendingOutboxCount: 1 })?.title,
    ).toBe('1 alteração ainda não foi enviada')
    expect(
      resolveSignOutWarning({ isDesktop: true, pendingOutboxCount: 4 })?.title,
    ).toBe('4 alterações ainda não foram enviadas')
  })

  it('promises the work is kept and kept private', () => {
    // Both halves matter: the outgoing user needs to know it survives, and
    // that the next person on this machine cannot read it.
    const warning = resolveSignOutWarning({
      isDesktop: true,
      pendingOutboxCount: 2,
    })

    expect(warning?.description).toMatch(/ficam salvas neste computador/i)
    expect(warning?.description).toMatch(/nenhum outro usuário/i)
  })

  it('offers a way through rather than blocking', () => {
    // Sign-out is how you hand the machine over; a lab that cannot sign out
    // because sync is behind is worse off than one that warns.
    expect(
      resolveSignOutWarning({ isDesktop: true, pendingOutboxCount: 2 })
        ?.confirmLabel,
    ).toBe('Sair mesmo assim')
  })

  it('ignores a nonsensical count instead of rendering it', () => {
    for (const pendingOutboxCount of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(
        resolveSignOutWarning({ isDesktop: true, pendingOutboxCount }),
      ).toBeNull()
    }
  })
})
