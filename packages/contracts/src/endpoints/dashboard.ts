import { z } from "zod";
import { JobStatusSchema } from "@calibra-facil/schemas";

import { endpoint, type EndpointGroup } from "./define";

/**
 * The laboratory dashboard: one aggregated read. The response schema is the
 * wire body written from what `apps/api/src/routes/dashboard.ts` returns.
 * Cloud-only: the desktop shell has no dashboard offline.
 */

const dashboardJobSchema = z.object({
  id: z.number(),
  jobId: z.string(),
  customerName: z.string().nullable(),
  assetName: z.string().nullable(),
  serviceName: z.string().nullable(),
  technicianName: z.string().nullable(),
  status: JobStatusSchema,
  dueDate: z.string().nullable(),
  isOverdue: z.boolean().nullable(),
  createdAt: z.string(),
});
export type DashboardJob = z.infer<typeof dashboardJobSchema>;

/** GET /api/dashboard/stats */
export const dashboardStatsSchema = z.object({
  pendingCalibrations: z.number(),
  approvedThisMonth: z.number(),
  rejectedThisMonth: z.number(),
  approvalRate: z.number(),
  expiringStandards: z.number(),
  overdueJobs: z.number(),
  dueToday: z.number(),
  dueNextSevenDays: z.number(),
  statusBreakdown: z.array(
    z.object({ status: JobStatusSchema, count: z.number() }),
  ),
  reviewQueue: z.array(dashboardJobSchema),
  standardsWatchlist: z.array(
    z.object({
      id: z.number(),
      name: z.string(),
      serialNumber: z.string(),
      certificateNumber: z.string(),
      nextCalibrationDate: z.string(),
      status: z.string(),
    }),
  ),
  calibrationTrend: z.array(
    z.object({ date: z.string(), approved: z.number(), rejected: z.number() }),
  ),
  recentJobs: z.array(dashboardJobSchema),
  // Cross-domain operational signals (org-scoped)
  openNonConformances: z.number(),
  nonConformancesAwaitingDisposition: z.number(),
  capasOpen: z.number(),
  capasOverdue: z.number(),
  pendingCalibrationRequests: z.number(),
  serviceOrdersInProgress: z.number(),
  competencesExpiring: z.number(),
  competencesPendingEvaluation: z.number(),
  ptPlanOverdue: z.number(),
  ptRoundsPending: z.number(),
  spcChartsWithSignals: z.number(),
  dueSoonJobs: z.array(dashboardJobSchema),
});
export type DashboardStats = z.infer<typeof dashboardStatsSchema>;

export const dashboardEndpoints = {
  getStats: endpoint({
    method: "get",
    path: "/api/dashboard/stats",
    response: dashboardStatsSchema,
    failure: "Falha ao carregar estatísticas",
    policy: "cloud-only",
    desktopLabel: "Painel",
  }),
} as const satisfies EndpointGroup;
