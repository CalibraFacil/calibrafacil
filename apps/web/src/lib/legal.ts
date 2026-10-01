export const LEGAL_LAST_UPDATED = '01/10/2026'
export const LEGAL_VERSION = '2.0'

/**
 * Identity of whoever operates THIS deployment.
 *
 * Calibra Fácil is open-source software (MIT): there is no central provider —
 * each deployment is run by its own operator, who is the data controller under
 * the LGPD and sets the terms of service for its users. Operators configure
 * these values at build time (VITE_OPERATOR_*) and should have the legal pages
 * reviewed before going live.
 */
function configured(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

export const LEGAL_ENTITY = {
  legalName: configured(
    import.meta.env.VITE_OPERATOR_LEGAL_NAME,
    'Operador desta instância',
  ),
  cnpj: configured(import.meta.env.VITE_OPERATOR_CNPJ, 'não informado'),
  address: configured(import.meta.env.VITE_OPERATOR_ADDRESS, 'não informado'),
  email: configured(import.meta.env.VITE_OPERATOR_EMAIL, 'não informado'),
  dpoName: configured(
    import.meta.env.VITE_OPERATOR_DPO_NAME,
    'Encarregado designado pelo operador',
  ),
  dpoEmail: configured(
    import.meta.env.VITE_OPERATOR_DPO_EMAIL ??
      import.meta.env.VITE_OPERATOR_EMAIL,
    'não informado',
  ),
}

/** True when the operator has not filled in its identity yet. */
export const LEGAL_ENTITY_IS_PLACEHOLDER =
  !import.meta.env.VITE_OPERATOR_LEGAL_NAME?.trim()

export const PROJECT_REPOSITORY_URL =
  'https://github.com/CalibraFacil/calibrafacil'
