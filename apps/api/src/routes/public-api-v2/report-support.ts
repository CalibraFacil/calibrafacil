import { z } from "zod";
import { ReportQuerySchema } from "./schemas";

export function resolvePeriodRange(
  period: z.infer<typeof ReportQuerySchema>["period"],
) {
  const now = new Date();
  const startDate = new Date(now);

  if (period === "month") {
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
    startDate.setDate(now.getDate() - days);
  }

  return {
    period,
    startDate,
    endDate: now,
  };
}

export function parseRequestedUnitIds(raw?: string) {
  if (!raw?.trim()) return null;

  const unitIds = raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return unitIds.length > 0 ? Array.from(new Set(unitIds)) : null;
}

export function getPeriodLabel(
  period: z.infer<typeof ReportQuerySchema>["period"],
) {
  switch (period) {
    case "7d":
      return "Últimos 7 dias";
    case "30d":
      return "Últimos 30 dias";
    case "90d":
      return "Últimos 90 dias";
    case "month":
      return "Mês atual";
    default:
      return "Últimos 30 dias";
  }
}

export function getHealthStatus(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}) {
  if (params.overdueNow > 0) return "critical";
  if (params.rejectedInPeriod > 0 || params.expiringStandardsSoon > 0) {
    return "attention";
  }
  return "healthy";
}

export function getHealthReason(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}) {
  if (params.overdueNow > 0) {
    return `${params.overdueNow} OS atrasada(s) em aberto`;
  }
  if (params.rejectedInPeriod > 0) {
    return `${params.rejectedInPeriod} rejeição(ões) no período`;
  }
  if (params.expiringStandardsSoon > 0) {
    return `${params.expiringStandardsSoon} padrão(ões) expirando em 30 dias`;
  }
  return "Operação sem alertas executivos no período";
}

export function buildReportScopeSummary(params: {
  selectedUnits: Array<{ id: number; name: string; slug: string }>;
  availableUnits: Array<{ id: number; name: string; slug: string }>;
}) {
  const unitsIncluded = params.selectedUnits.length;
  const isAllUnits = unitsIncluded === params.availableUnits.length;

  return {
    label: isAllUnits
      ? "Todas as unidades ativas"
      : `${unitsIncluded} unidade(s) selecionada(s)`,
    description: isAllUnits
      ? "Visão executiva consolidada para todas as unidades ativas acessíveis."
      : `Visão executiva filtrada para ${unitsIncluded} unidade(s).`,
    unitsIncluded,
    isAllUnits,
  };
}
