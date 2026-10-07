import { runtimeEnv } from '@/app/config/runtime-env'

export const LEGAL_LAST_UPDATED = '01/10/2026'
export const LEGAL_VERSION = '2.0'

/**
 * Identity of whoever operates THIS deployment.
 *
 * Calibra Fácil is open-source software (MIT): there is no central provider —
 * each deployment is run by its own operator, who is the data controller under
 * the LGPD and sets the terms of service for its users. Operators configure
 * these values (VITE_OPERATOR_*: at build time, or when the Docker image
 * starts) and should have the legal pages reviewed before going live.
 */
function configured(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : fallback
}

const operator = {
  legalName: runtimeEnv(
    'VITE_OPERATOR_LEGAL_NAME',
    import.meta.env.VITE_OPERATOR_LEGAL_NAME,
  ),
  cnpj: runtimeEnv('VITE_OPERATOR_CNPJ', import.meta.env.VITE_OPERATOR_CNPJ),
  address: runtimeEnv(
    'VITE_OPERATOR_ADDRESS',
    import.meta.env.VITE_OPERATOR_ADDRESS,
  ),
  email: runtimeEnv('VITE_OPERATOR_EMAIL', import.meta.env.VITE_OPERATOR_EMAIL),
  dpoName: runtimeEnv(
    'VITE_OPERATOR_DPO_NAME',
    import.meta.env.VITE_OPERATOR_DPO_NAME,
  ),
  dpoEmail: runtimeEnv(
    'VITE_OPERATOR_DPO_EMAIL',
    import.meta.env.VITE_OPERATOR_DPO_EMAIL,
  ),
}

export const LEGAL_ENTITY = {
  legalName: configured(operator.legalName, 'Operador desta instância'),
  cnpj: configured(operator.cnpj, 'não informado'),
  address: configured(operator.address, 'não informado'),
  email: configured(operator.email, 'não informado'),
  dpoName: configured(operator.dpoName, 'Encarregado designado pelo operador'),
  dpoEmail: configured(operator.dpoEmail ?? operator.email, 'não informado'),
}

/** True when the operator has not filled in its identity yet. */
export const LEGAL_ENTITY_IS_PLACEHOLDER = !operator.legalName?.trim()

export const PROJECT_REPOSITORY_URL =
  'https://github.com/CalibraFacil/calibrafacil'
