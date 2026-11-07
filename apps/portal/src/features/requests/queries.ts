import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  PortalRequestBatchResponse,
  PortalRequestsResponse,
} from "@calibra-facil/contracts/portal-client";
import { keepPreviousDataInScope } from "@calibra-facil/shared/query-scope";
import type { CalibrationRequestStatus } from "@calibra-facil/schemas/machines";

import { PortalApiError } from "@/lib/api-fetch";
import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

export type RequestsFilters = {
  page: number;
  limit: number;
  search: string;
  statusFilter: CalibrationRequestStatus | "";
};

/** The API's own message (`error`, else the joined validation `errors`) of an error body. */
function apiErrorMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const errorBody = Object.fromEntries(Object.entries(payload));
  if (typeof errorBody.error === "string") return errorBody.error;
  if (!Array.isArray(errorBody.errors)) return null;

  return errorBody.errors
    .flatMap((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return [];
      const message = Object.fromEntries(Object.entries(item)).message;
      return typeof message === "string" ? [message] : [];
    })
    .join(", ");
}

/** One page of the customer's calibration requests; the previous page stays while the next loads. */
export function useRequests(filters: RequestsFilters) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.requestsPage(filters),
    queryFn: async (): Promise<PortalRequestsResponse> => {
      try {
        return await portalApi.requests.list({
          query: {
            page: filters.page,
            limit: filters.limit,
            query: filters.search || undefined,
            status: filters.statusFilter || undefined,
          },
        });
      } catch (failure) {
        if (!(failure instanceof PortalApiError)) throw failure;
        // Show the API's own message (or its validation errors) with the status.
        const apiMessage = apiErrorMessage(failure.body);
        throw new Error(
          apiMessage
            ? `${apiMessage} (${failure.status})`
            : `Falha ao carregar solicitacoes (${failure.status})`,
          { cause: failure },
        );
      }
    },
    placeholderData: keepPreviousDataInScope(keys.requests),
  });
}

export function useRequestDetail(id: string) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.requestDetail(id),
    queryFn: () => portalApi.requests.get({ params: { id } }),
  });
}

/** One page of the instruments the customer can pick for a new request. */
export function useRequestableAssets(
  page: number,
  limit: number,
  search: string,
) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.requestAssets(page, limit, search),
    queryFn: () =>
      portalApi.assets.list({
        query: { page, limit, query: search || undefined },
      }),
  });
}

/** The identity of a deep-linked recall: its ids sorted and comma-joined; `null` for none. */
export function preselectKeyOf(assetIds: Array<number> | undefined) {
  return assetIds && assetIds.length > 0
    ? [...assetIds].sort((a, b) => a - b).join(",")
    : null;
}

/** The instruments of a deep-linked recall, to seed the selection once. */
export function usePreselectedAssets(assetIds: Array<number> | undefined) {
  const keys = usePortalKeys();
  const preselectKey = preselectKeyOf(assetIds);
  return useQuery({
    queryKey: keys.requestPreselect(preselectKey),
    enabled: preselectKey !== null,
    staleTime: Infinity,
    queryFn: () =>
      portalApi.assets.list({
        query: {
          ids: [...(assetIds ?? [])].sort((a, b) => a - b),
          limit: 50,
        },
      }),
  });
}

type CreateRequestBody = Parameters<
  typeof portalApi.requests.createBatch
>[0]["body"];

// The batch endpoint splits a (possibly cross-unit) selection into one request
// per unit and returns `{ created: [{ id, ... }] }`.
function createdRequestIds(result: PortalRequestBatchResponse): Array<number> {
  if (result.created.length === 0) {
    throw new Error("Resposta inválida ao criar solicitação");
  }
  return result.created.map((item) => item.id);
}

/** Sends the request(s); the result is the ids created (one per unit). */
export function useCreateRequests(callbacks: {
  onSuccess: (ids: Array<number>) => void;
  onError: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const keys = usePortalKeys();
  return useMutation({
    mutationFn: async (body: CreateRequestBody) =>
      createdRequestIds(
        await portalApi.requests.createBatch(
          { body },
          { serverErrorMessage: true },
        ),
      ),
    onSuccess: async (ids) => {
      await queryClient.invalidateQueries({ queryKey: keys.requests });
      await queryClient.invalidateQueries({ queryKey: keys.overview });
      callbacks.onSuccess(ids);
    },
    onError: callbacks.onError,
  });
}
