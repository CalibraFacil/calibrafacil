import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { keepPreviousDataInScope } from "@calibra-facil/shared/query-scope";
import type { ServiceOrderStatus } from "@calibra-facil/shared/service-orders";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

export type ServiceOrdersFilters = {
  page: number;
  limit: number;
  search: string;
  statusFilter: ServiceOrderStatus | "";
};

/** One page of the customer's service orders; the previous page stays while the next loads. */
export function useServiceOrders(filters: ServiceOrdersFilters) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.serviceOrdersPage(filters),
    queryFn: () =>
      portalApi.serviceOrders.list({
        query: {
          page: filters.page,
          limit: filters.limit,
          query: filters.search || undefined,
          status: filters.statusFilter || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(keys.serviceOrders),
  });
}

/** `id` is the order's opaque `publicId`. */
export function useServiceOrderDetail(id: string) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.serviceOrder(id),
    queryFn: async () => {
      const result = await portalApi.serviceOrders.get({ params: { id } });
      return result.data;
    },
  });
}

export function useServiceOrderFinancialSummary(id: string) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.serviceOrderFinancialSummary(id),
    queryFn: async () => {
      const result = await portalApi.serviceOrders.financialSummary({
        params: { id },
      });
      return result.data;
    },
  });
}

/** What a quote decision changes: the order, the lists that show its status and the dashboard counters. */
function useInvalidateAfterQuoteDecision(id: string) {
  const queryClient = useQueryClient();
  const keys = usePortalKeys();
  return async () => {
    await queryClient.invalidateQueries({ queryKey: keys.serviceOrder(id) });
    await queryClient.invalidateQueries({ queryKey: keys.serviceOrders });
    await queryClient.invalidateQueries({ queryKey: keys.overview });
  };
}

type QuoteDecisionCallbacks = {
  onSuccess: () => void;
  onError: (error: Error) => void;
};

export function useApproveQuote(
  id: string,
  { onSuccess, onError }: QuoteDecisionCallbacks,
) {
  const invalidate = useInvalidateAfterQuoteDecision(id);
  return useMutation({
    mutationFn: (quoteId: number) =>
      portalApi.serviceOrders.approveQuote({
        params: { id, quoteId },
        body: {},
      }),
    onSuccess: async () => {
      onSuccess();
      await invalidate();
    },
    onError,
  });
}

export function useRejectQuote(
  id: string,
  { onSuccess, onError }: QuoteDecisionCallbacks,
) {
  const invalidate = useInvalidateAfterQuoteDecision(id);
  return useMutation({
    mutationFn: ({
      quoteId,
      rejectionReason,
    }: {
      quoteId: number;
      rejectionReason: string;
    }) =>
      portalApi.serviceOrders.rejectQuote({
        params: { id, quoteId },
        body: { rejectionReason },
      }),
    onSuccess: async () => {
      onSuccess();
      await invalidate();
    },
    onError,
  });
}
