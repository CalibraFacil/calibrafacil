// @vitest-environment jsdom

import type React from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SignUpPage } from './sign-up-page'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children?: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))

vi.mock('@/features/auth/components/auth-shader-panel', () => ({
  AuthShaderPanel: () => null,
}))

vi.mock('@/utils/api', () => ({ calibraApi: {} }))

afterEach(cleanup)

describe('sign-up page', () => {
  it('never asks for or sets a password', () => {
    // Lab access is passwordless by policy; sign-up must not be the back door
    // that reintroduces credentials.
    const { container } = render(<SignUpPage />)

    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(0)
    expect(container.querySelector('[autocomplete*="password"]')).toBeNull()
    expect(container.querySelectorAll('input').length).toBeGreaterThan(0)
  })
})
