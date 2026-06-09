import { useQuery } from "@tanstack/react-query";

import { getApiBaseUrl } from "@/lib/utils";
import type { RequestStatus } from "@/lib/status-labels";

export type OverviewEquipmentItem = {
  id: number;
  name: string;
  tag: string;
  nextCalibrationDate: string | null;
};

export type OverviewCertificate = {
  id: number;
  jobId: string;
  approvedAt: string | null;
  assetName: string;
  assetTag: string;
  releaseStatus: "RELEASED" | "PAYMENT_PENDING";
  ready: boolean;
};

export type OverviewRequest = {
  id: number;
  status: RequestStatus;
  submittedAt: string | null;
  itemCount: number;
};

export type OverviewServiceOrder = {
  id: number;
  publicId: string;
  serviceOrderNumber: string;
  status: string;
  openedAt: string | null;
  assetName: string | null;
};

export type PortalOverview = {
  equipment: {
    total: number;
    overdue: number;
    dueSoon: number;
    scheduled: number;
    unscheduled: number;
    inLab: number;
    attention: Array<OverviewEquipmentItem>;
  };
  certificates: {
    available: number;
    recent: Array<OverviewCertificate>;
  };
  requests: {
    total: number;
    open: number;
    rejected: number;
    recent: Array<OverviewRequest>;
  };
  serviceOrders: {
    total: number;
    inProgress: number;
    awaitingQuoteApproval: number;
    readyForPickup: number;
    awaitingQuote: Array<OverviewServiceOrder>;
    recent: Array<OverviewServiceOrder>;
  };
};

async function fetchOverview(): Promise<PortalOverview> {
  const response = await fetch(`${getApiBaseUrl()}/api/portal/overview`, {
    credentials: "include",
  });
  if (!response.ok) {
    throw new Error("Falha ao carregar o painel");
  }
  return response.json();
}

export function useOverview() {
  return useQuery({
    queryKey: ["portal-overview"],
    queryFn: fetchOverview,
    staleTime: 60_000,
  });
}
