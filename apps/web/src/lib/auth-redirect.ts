type RedirectOptions = {
  fallback: string
  allowedPrefixes: string[]
  blockedPrefixes?: string[]
}

function pathMatchesPrefix(path: string, prefix: string): boolean {
  return (
    path === prefix ||
    path.startsWith(`${prefix}/`) ||
    path.startsWith(`${prefix}?`) ||
    path.startsWith(`${prefix}#`)
  )
}

export function sanitizeInternalRedirect(
  value: string | undefined,
  options: RedirectOptions,
): string {
  if (!value || value.startsWith('//')) return options.fallback

  const baseOrigin =
    typeof window === 'undefined'
      ? 'https://calibra.local'
      : window.location.origin

  try {
    const url = new URL(value, baseOrigin)

    if (url.origin !== baseOrigin) return options.fallback

    const path = `${url.pathname}${url.search}${url.hash}`
    const isAllowed = options.allowedPrefixes.some((prefix) =>
      pathMatchesPrefix(path, prefix),
    )
    const isBlocked = (options.blockedPrefixes ?? []).some((prefix) =>
      pathMatchesPrefix(path, prefix),
    )

    return isAllowed && !isBlocked ? path : options.fallback
  } catch {
    return options.fallback
  }
}

export function sanitizeLabRedirect(value: string | undefined): string {
  return sanitizeInternalRedirect(value, {
    fallback: '/dashboard',
    allowedPrefixes: ['/dashboard'],
  })
}
