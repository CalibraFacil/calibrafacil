import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";

export type PortalVisitStatus =
  | "PROPOSED"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";

export type PortalVisitAddress = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
} | null;

export type PortalVisit = {
  id: number;
  status: PortalVisitStatus;
  scheduledAt: string | null;
  address: PortalVisitAddress;
  customerName: string;
  technicianName: string | null;
  sourceRequestId: number | null;
  cancelReason: string | null;
  assetCount: number;
};

type PortalVisitsResponse = {
  data: Array<PortalVisit>;
};

async function fetchVisits(): Promise<PortalVisitsResponse> {
  const response = await fetch(`${getApiBaseUrl()}/api/portal/visits`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Falha ao carregar as visitas");
  }
  return response.json();
}

/** On-site visits scheduled for the customer (excludes cancelled). */
export function usePortalVisits() {
  return useQuery({
    queryKey: ["portal-visits"],
    queryFn: fetchVisits,
    staleTime: 60_000,
  });
}

export const PORTAL_VISIT_STATUS_LABELS: Record<PortalVisitStatus, string> = {
  PROPOSED: "Proposta",
  CONFIRMED: "Confirmada",
  IN_PROGRESS: "Em andamento",
  COMPLETED: "Concluída",
  CANCELLED: "Cancelada",
};

export function formatPortalVisitAddress(address: PortalVisitAddress): string {
  if (!address) return "";
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const region = [address.neighbourhood, address.city, address.state]
    .filter(Boolean)
    .join(" - ");
  return [street, region]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" · ");
}
