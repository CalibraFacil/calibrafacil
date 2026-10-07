import {
  ContaAzulAppCredentialsSchema,
  type ContaAzulAppCredentialsInput,
} from '@calibra-facil/schemas'

import type { ContaAzulAppSaveResponse } from '@/features/settings/types'

/** Where a laboratory creates its Conta Azul application. */
export const CONTA_AZUL_DEVELOPER_PORTAL_URL =
  'https://developers-portal.contaazul.com/'

export type ContaAzulAppDraft = {
  clientId: string
  clientSecret: string
}

export const emptyContaAzulAppDraft: ContaAzulAppDraft = {
  clientId: '',
  clientSecret: '',
}

export type ContaAzulAppDraftErrors = Partial<
  Record<keyof ContaAzulAppDraft, string>
>

export function parseContaAzulAppDraft(
  draft: ContaAzulAppDraft,
):
  | { ok: true; value: ContaAzulAppCredentialsInput }
  | { ok: false; errors: ContaAzulAppDraftErrors } {
  const result = ContaAzulAppCredentialsSchema.safeParse(draft)
  if (result.success) {
    return { ok: true, value: result.data }
  }

  const errors: ContaAzulAppDraftErrors = {}
  for (const issue of result.error.issues) {
    const field = issue.path[0]
    if ((field === 'clientId' || field === 'clientSecret') && !errors[field]) {
      errors[field] = issue.message
    }
  }
  return { ok: false, errors }
}

export function contaAzulAppSavedMessage(
  check: ContaAzulAppSaveResponse['check'],
) {
  return check === 'accepted'
    ? 'Aplicativo salvo e confirmado pelo Conta Azul.'
    : 'Aplicativo salvo. O Conta Azul não respondeu à verificação agora; a conexão vai confirmar as credenciais.'
}

/** The `reason` the OAuth callback adds when it sends the browser back. */
export function contaAzulOAuthErrorMessage(reason: string | null) {
  switch (reason) {
    case 'invalid_state':
      return 'O pedido de conexão expirou ou não é mais válido. Clique em Conectar de novo.'
    case 'exchange_failed':
      return 'O Conta Azul não aceitou a autorização. Confira se a URL de redirecionamento do aplicativo é exatamente a mostrada aqui e conecte de novo.'
    case 'app_missing':
      return 'Nenhum aplicativo Conta Azul configurado. Cadastre o Client ID e o Client Secret abaixo.'
    default:
      return 'Não foi possível conectar o Conta Azul. Tente de novo.'
  }
}
