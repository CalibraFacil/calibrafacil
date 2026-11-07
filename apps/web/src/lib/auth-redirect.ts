import { sanitizeInternalRedirect } from '@calibra-facil/shared/internal-redirect'

export function sanitizeLabRedirect(value: string | undefined): string {
  return sanitizeInternalRedirect(value, {
    fallback: '/dashboard',
    allowedPrefixes: ['/dashboard'],
  })
}
