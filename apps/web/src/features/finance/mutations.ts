/**
 * Centralized finance mutation registry. Append-only: each revamp wave adds its
 * mutations here as named hooks so the cache-update strategy stays consistent
 * across the module (see docs/architecture/finance-revamp-specs.md).
 *
 * Strategy (mirrors features/settings/integrations/conta-azul-mutations.ts):
 * - the high-frequency action (registering a receipt) updates the cache
 *   optimistically via setQueryData so the row flips at click-speed, rolling
 *   back on error;
 * - issue/export reconcile by invalidating only the specific top-level keys —
 *   TanStack refetches just the ACTIVE (mounted) queries, so background list
 *   variants are marked stale without a refetch storm.
 */
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query'
import { toast } from 'sonner'

import { calibraApi } from '@/utils/api'
import type { FinancialPaymentMethod } from '@calibra-facil/shared'
import type { FinanceReceiptsData } from '@/features/finance/types'

const RECEIPTS_KEY = ['finance', 'receipts'] as const
const OVERVIEW_KEY = ['finance', 'overview'] as const
const DOCUMENTS_KEY = ['finance', 'documents'] as const
const ERP_KEY = ['finance', 'erp'] as const
const CONTRACTS_KEY = ['finance', 'contracts'] as const

export type ReceiveInstallmentInput = {
  installmentId: number
  amountCents: number
  paymentMethod: FinancialPaymentMethod
  reference?: string
  notes?: string
  receivedAt: string
}

function patchReceiptPaid(
  cache: FinanceReceiptsData | undefined,
  input: ReceiveInstallmentInput,
): FinanceReceiptsData | undefined {
  if (!cache) return cache
  return {
    ...cache,
    data: cache.data.map((row) =>
      row.installmentId === input.installmentId
        ? {
            ...row,
            installmentStatus: 'PAID',
            paidAt: input.receivedAt,
            paymentMethod: input.paymentMethod,
            paymentReference: input.reference ?? row.paymentReference,
          }
        : row,
    ),
  }
}

/** Reconcile derived aggregates after a finance write without a refetch storm. */
function reconcile(queryClient: QueryClient, keys: ReadonlyArray<readonly string[]>) {
  for (const queryKey of keys) {
    queryClient.invalidateQueries({ queryKey, refetchType: 'active' })
  }
}

/** Register a full receipt (baixa) against an installment — optimistic. */
export function useReceiveInstallmentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ReceiveInstallmentInput) =>
      calibraApi.finance.receiveInstallment(input.installmentId, {
        amountCents: input.amountCents,
        paymentMethod: input.paymentMethod,
        reference: input.reference || undefined,
        notes: input.notes || undefined,
        receivedAt: input.receivedAt,
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: RECEIPTS_KEY })
      const previous =
        queryClient.getQueryData<FinanceReceiptsData>(RECEIPTS_KEY)
      queryClient.setQueryData<FinanceReceiptsData>(RECEIPTS_KEY, (cache) =>
        patchReceiptPaid(cache, input),
      )
      return { previous }
    },
    onSuccess: () => {
      toast.success('Baixa registrada')
      reconcile(queryClient, [RECEIPTS_KEY, OVERVIEW_KEY, DOCUMENTS_KEY])
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<FinanceReceiptsData>(
          RECEIPTS_KEY,
          context.previous,
        )
      }
      toast.error(error instanceof Error ? error.message : 'Falha ao registrar baixa')
    },
  })
}

/** Issue a draft billing document. Reused for single + bulk via mutateAsync. */
export function useIssueDocumentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: number | string) =>
      calibraApi.finance.issueDocument(documentId),
    onSuccess: () => {
      reconcile(queryClient, [DOCUMENTS_KEY, OVERVIEW_KEY])
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Falha ao emitir documento')
    },
  })
}

export type UpdateDocumentInput = {
  id: number | string
  dueDate?: string
  notes?: string
  discountCents?: number
}

/** Update a draft document's parameters (due date, discount, notes). */
export function useUpdateDocumentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: UpdateDocumentInput) =>
      calibraApi.finance.updateDocument(input.id, {
        dueDate: input.dueDate,
        notes: input.notes,
        discountCents: input.discountCents,
      }),
    onSuccess: () => {
      reconcile(queryClient, [DOCUMENTS_KEY, OVERVIEW_KEY])
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao atualizar documento',
      )
    },
  })
}

/** Void (annul) a billing document, capturing a reason for the audit trail. */
export function useVoidDocumentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { id: number | string; reason: string }) =>
      calibraApi.finance.voidDocument(input.id, { reason: input.reason }),
    onSuccess: () => {
      reconcile(queryClient, [DOCUMENTS_KEY, RECEIPTS_KEY, OVERVIEW_KEY])
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao anular documento',
      )
    },
  })
}

/** Export an issued billing document to the financial provider (ERP). */
export function useExportErpDocumentMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (documentId: number | string) =>
      calibraApi.finance.exportErpDocument(documentId),
    onSuccess: () => {
      reconcile(queryClient, [DOCUMENTS_KEY, ERP_KEY, OVERVIEW_KEY])
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao exportar para o ERP',
      )
    },
  })
}

/** Activate a draft commercial agreement. */
export function useActivateContractMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number | string) => calibraApi.finance.activateContract(id),
    onSuccess: () => {
      reconcile(queryClient, [CONTRACTS_KEY, OVERVIEW_KEY])
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao ativar contrato',
      )
    },
  })
}

/** Cancel an active commercial agreement. */
export function useCancelContractMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number | string) => calibraApi.finance.cancelContract(id),
    onSuccess: () => {
      reconcile(queryClient, [CONTRACTS_KEY, OVERVIEW_KEY])
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Falha ao cancelar contrato',
      )
    },
  })
}
