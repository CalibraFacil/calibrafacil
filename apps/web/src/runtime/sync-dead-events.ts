import type { LocalDeadOutboxEvent } from '@calibra-facil/contracts'

/**
 * How the desktop presents an event the cloud refused for good.
 *
 * The cloud answers with a code (`STANDARD_EXPIRED`) and an English message
 * written for logs. The person looking at the queue is a technician or a quality
 * manager: they get the reason in their words, and the cloud's own message
 * stays underneath as detail for support.
 */

const GENERIC_REASON =
  'A nuvem recusou esta alteração e ela não será reenviada sozinha.'

const REASONS: ReadonlyArray<readonly [string, string]> = [
  [
    'UNSUPPORTED_SYNC_OPERATION',
    'A nuvem não reconhece este tipo de alteração, provavelmente feita por uma versão antiga do aplicativo.',
  ],
  [
    'OFFLINE_CERTIFICATE_PUBLICATION_NOT_SUPPORTED',
    'Certificados são emitidos somente online: aprove a calibração na nuvem e o certificado é gerado e assinado lá.',
  ],
  [
    'STATUS_PAYLOAD_MISMATCH',
    'O status informado por esta alteração não é o que a calibração assume na nuvem.',
  ],
  [
    'INVALID_DESKTOP_EVENT_PAYLOAD',
    'Os dados desta alteração estão incompletos ou inválidos para a nuvem.',
  ],
  [
    'INVALID_SYNC_COMMAND',
    'Esta alteração não está no formato que a nuvem aceita. Atualize o aplicativo e, se persistir, descarte-a.',
  ],
  [
    'INVALID_STANDARD_SNAPSHOT',
    'O registro dos padrões usados nesta calibração está incompleto.',
  ],
  [
    'COMPILED_METHOD_SNAPSHOT_INVALID',
    'O método de calibração salvo com esta execução não é válido para a nuvem.',
  ],
  [
    'CALIBRATION_RECORD_INCOMPLETE',
    'O registro desta calibração está incompleto.',
  ],
  [
    'OFFICIAL_EXECUTION_FAILED',
    'A nuvem não conseguiu reproduzir o cálculo desta execução.',
  ],
  [
    'DOMAIN_VALIDATION_FAILED',
    'A nuvem recusou esta alteração por uma regra de validação.',
  ],
  [
    'TAG_ALREADY_EXISTS',
    'A etiqueta (tag) deste instrumento já está em uso na nuvem.',
  ],
  [
    'ASSET_NOT_FOUND',
    'O instrumento desta calibração não foi encontrado na nuvem.',
  ],
  [
    'ASSET_SPECIFICATION_MISSING',
    'O instrumento não tem as especificações necessárias para esta calibração.',
  ],
  [
    'REMOTE_ENTITY_NOT_FOUND',
    'O registro ao qual esta alteração se refere não existe mais na nuvem.',
  ],
  [
    'SYNC_PERMISSION_DENIED',
    'Seu perfil de acesso não permite esta operação na nuvem, mesmo online. Peça a um gestor para fazê-la, ou reenvie depois que o perfil for alterado.',
  ],
  [
    'INVALID_STATUS_TRANSITION',
    'Na nuvem, a calibração está em um status que não permite esta alteração.',
  ],
  [
    'STANDARD_EXPIRED',
    'Um padrão usado nesta calibração está com o certificado vencido.',
  ],
  ['STANDARD_NOT_ACTIVE', 'Um padrão usado nesta calibração está inativo.'],
  [
    'STANDARD_SCOPE_MISMATCH',
    'Um padrão usado nesta calibração não existe ou está fora do escopo do laboratório na nuvem.',
  ],
  [
    'STANDARD_CERTIFIED_VALUES_MISSING',
    'Um padrão usado nesta calibração não tem valores certificados registrados.',
  ],
  [
    'STANDARD_BACKDATE_REASON_REQUIRED',
    'O certificado de um padrão venceu depois da data da calibração: é preciso justificar o registro retroativo.',
  ],
  [
    'TECHNICIAN_COMPETENCE_MISSING',
    'O técnico da calibração não tem competência ativa para este tipo de instrumento.',
  ],
]

const ENTITY_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['asset', 'Ativo'],
  ['attachment', 'Anexo'],
  ['calibration_job', 'Calibração'],
  ['customer', 'Cliente'],
  ['non_conformance', 'Não conformidade'],
  ['service_order', 'Ordem de serviço'],
  ['service_order_execution', 'Execução da OS'],
  ['service_order_quote', 'Orçamento da OS'],
  ['service_order_delivery_document', 'Documento de entrega'],
  ['certificate_draft', 'Certificado'],
]

const OPERATION_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['create_local_asset', 'Cadastro de instrumento'],
  ['update_local_asset', 'Edição de instrumento'],
  ['create_local_customer', 'Cadastro de cliente'],
  ['update_local_customer', 'Edição de cliente'],
  ['update_local_customer_compliance', 'Conformidade do cliente'],
  ['create_local_job_draft', 'Abertura de calibração'],
  ['save_local_execution', 'Rascunho da execução'],
  ['submit_local_execution', 'Envio da execução para aprovação'],
  ['create_local_service_order_intake', 'Recebimento de ordem de serviço'],
  ['create_local_service_order_quote_draft', 'Orçamento da ordem de serviço'],
  ['save_local_service_order_execution_notes', 'Notas da execução da OS'],
  [
    'create_local_service_order_delivery_document_draft',
    'Documento de entrega',
  ],
  ['create_local_attachment', 'Anexo'],
  ['create_local_non_conformance', 'Registro de não conformidade'],
  ['generate_local_certificate_pdf', 'Publicação de certificado'],
]

function lookup(
  table: ReadonlyArray<readonly [string, string]>,
  key: string | null,
) {
  if (key === null) return undefined
  return table.find(([candidate]) => candidate === key)?.[1]
}

export type DeadEventDescription = {
  title: string
  /** Why the cloud refused it, in pt-BR. */
  reason: string
  /** The cloud's own message, for support. */
  detail: string | null
}

export function describeDeadEvent(
  event: LocalDeadOutboxEvent,
): DeadEventDescription {
  const entity = lookup(ENTITY_LABELS, event.entityType) ?? event.entityType
  const operation = lookup(OPERATION_LABELS, event.operation) ?? event.operation

  return {
    title: `${entity} · ${operation}`,
    reason: lookup(REASONS, event.errorCode) ?? GENERIC_REASON,
    detail: event.errorMessage,
  }
}

export type DeadEventDiscardWarning = {
  title: string
  description: string
  confirmLabel: string
  /** The event carries calibration readings. */
  regulated: boolean
}

/**
 * What to say before a dead event is thrown away. Discarding an execution is
 * not like discarding an edit: the readings were taken at the bench and the
 * cloud will never receive them, so the person must know they now live only on
 * this computer.
 */
export function getDeadEventDiscardWarning(
  event: LocalDeadOutboxEvent,
): DeadEventDiscardWarning {
  if (event.regulated) {
    return {
      title: 'Descartar as leituras desta calibração?',
      description:
        'As leituras ficam salvas somente neste computador e não serão enviadas à nuvem: a calibração não poderá ser concluída com elas. Se o problema puder ser corrigido (por exemplo, renovando o padrão vencido), use "Tentar novamente" em vez de descartar. O descarte fica registrado neste computador.',
      confirmLabel: 'Descartar mesmo assim',
      regulated: true,
    }
  }

  return {
    title: 'Descartar esta alteração?',
    description:
      'O registro local permanece neste computador, mas esta alteração sai da fila e não será enviada à nuvem. O descarte fica registrado neste computador.',
    confirmLabel: 'Descartar',
    regulated: false,
  }
}

export function getDeadEventsBannerLabel(count: number | undefined) {
  if (count === undefined || count <= 0) return null

  return count === 1
    ? '1 alteração foi recusada pela nuvem e não será reenviada.'
    : `${count} alterações foram recusadas pela nuvem e não serão reenviadas.`
}
