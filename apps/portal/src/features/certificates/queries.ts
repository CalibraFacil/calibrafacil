import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { PortalCertificateDetail } from "@calibra-facil/contracts/portal-client";
import { keepPreviousDataInScope } from "@calibra-facil/shared/query-scope";

import { usePortalKeys } from "@/lib/portal-keys";
import { portalApi } from "@/lib/portal-api";

export type CertificatesFilters = {
  page: number;
  limit: number;
  search: string;
  dateFrom: string;
  dateTo: string;
  assetId: number | undefined;
};

/** One page of released certificates; the previous page stays while the next loads. */
export function useCertificates(filters: CertificatesFilters) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.certificatesPage(filters),
    queryFn: () =>
      portalApi.certificates.list({
        query: {
          page: filters.page,
          limit: filters.limit,
          query: filters.search || undefined,
          dateFrom: filters.dateFrom || undefined,
          dateTo: filters.dateTo || undefined,
          assetId: filters.assetId || undefined,
        },
      }),
    placeholderData: keepPreviousDataInScope(keys.certificates),
  });
}

/** `id` is the certificate's job code (`jobId`). */
export function useCertificateDetail(id: string) {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.certificate(id),
    queryFn: (): Promise<PortalCertificateDetail> =>
      portalApi.certificates.get({ params: { id } }),
  });
}

/**
 * The customer's audit packs. A pack is generated asynchronously, so the list
 * polls while one is in flight and the row flips to "Pronto" without a refresh.
 */
export function useAuditPacks() {
  const keys = usePortalKeys();
  return useQuery({
    queryKey: keys.auditPacks,
    queryFn: () => portalApi.auditPacks.list(),
    refetchInterval: (query) =>
      query.state.data?.data.some(
        (pack) => pack.status === "PENDING" || pack.status === "PROCESSING",
      )
        ? 5_000
        : false,
  });
}

type AuditPackRequest = Parameters<
  typeof portalApi.auditPacks.request
>[0]["body"];

export function useRequestAuditPack(callbacks: {
  onSuccess: () => void;
  onError: (error: Error) => void;
}) {
  const queryClient = useQueryClient();
  const keys = usePortalKeys();
  return useMutation({
    mutationFn: (body: AuditPackRequest) =>
      portalApi.auditPacks.request({ body }, { serverErrorMessage: true }),
    onSuccess: async () => {
      callbacks.onSuccess();
      await queryClient.invalidateQueries({ queryKey: keys.auditPacks });
    },
    onError: callbacks.onError,
  });
}
