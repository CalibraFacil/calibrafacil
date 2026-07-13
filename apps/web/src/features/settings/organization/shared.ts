import type { useActiveOrganization } from '@calibra-facil/auth/client'

/**
 * The active organization as the settings sections read it: the Better Auth
 * organization plus the ISO 17025 / RBC columns the API persists on it.
 */
export type ActiveOrganization = NonNullable<
  ReturnType<typeof useActiveOrganization>['data']
> & {
  cnpj?: string | null
  accreditationNumber?: string | null
  accreditationBody?: string | null
  accreditationActive?: boolean | null
  permissionariaAuthorizationNumber?: string | null
  permissionariaAuthorizationState?: string | null
  street?: string | null
  number?: string | null
  complement?: string | null
  neighbourhood?: string | null
  city?: string | null
  state?: string | null
  cep?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  logo?: string | null
  technicalManagerName?: string | null
  technicalManagerTitle?: string | null
}
