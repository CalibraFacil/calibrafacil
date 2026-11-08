import type { ReportPeriod } from "@calibra-facil/contracts";

/**
 * What the dashboard's consolidated reports and the public API's v2 reports
 * say the same way: the period's label, the unit filter, the scope summary and
 * the health verdict with its reason. One place, so an integrator's report and
 * the lab's dashboard cannot disagree.
 */

type HealthStatus = "healthy" | "attention" | "critical";

type UnitSummary = {
  id: number;
  name: string;
  slug: string;
};

export function parseRequestedUnitIds(raw?: string) {
  if (!raw?.trim()) return null;

  const unitIds = raw
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value) && value > 0);

  return unitIds.length > 0 ? Array.from(new Set(unitIds)) : null;
}

export function getPeriodLabel(period: ReportPeriod) {
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

export function buildReportScopeSummary(params: {
  selectedUnits: UnitSummary[];
  availableUnits: UnitSummary[];
}) {
  const unitsIncluded = params.selectedUnits.length;
  const isAllUnits = unitsIncluded === params.availableUnits.length;

  return {
    label: isAllUnits
      ? "Todas as unidades ativas"
      : `${unitsIncluded} unidade(s) selecionada(s)`,
    description: isAllUnits
      ? "Visão executiva consolidada para todas as unidades ativas acessíveis."
      : `Visão executiva filtrada para ${unitsIncluded} unidade(s) dentro do consolidado.`,
    unitsIncluded,
    isAllUnits,
  };
}

export function getHealthStatus(params: {
  overdueNow: number;
  rejectedInPeriod: number;
  expiringStandardsSoon: number;
}): HealthStatus {
  if (params.overdueNow > 0) {
    return "critical";
  }

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
