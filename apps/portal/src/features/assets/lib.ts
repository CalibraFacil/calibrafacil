import type { AssetStatus } from "./types";

export const statusLabels: Record<AssetStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  MAINTENANCE: "Manutenção",
  SCRAPPED: "Descartado",
};

export function formatSpecificationValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (Array.isArray(value))
    return value.map(formatSpecificationValue).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

const specificationLabels: Record<string, string> = {
  capacity: "Capacidade",
  humidityRangeMax: "Faixa de umidade máx.",
  humidityRangeMin: "Faixa de umidade mín.",
  humidityResolution: "Resolução de umidade",
  immersionDepth: "Profundidade de imersão",
  immersionType: "Tipo de imersão",
  instrumentType: "Tipo",
  jawType: "Tipo de bico",
  linearity: "Linearidade",
  rangeMax: "Faixa máx.",
  rangeMin: "Faixa mín.",
  repeatability: "Repetitividade",
  resolution: "Resolução",
  scaleDivision: "Divisão de escala",
  tempRangeMax: "Faixa de temperatura máx.",
  tempRangeMin: "Faixa de temperatura mín.",
  tempResolution: "Resolução de temperatura",
  weighingRanges: "Faixas de pesagem",
};

export function formatSpecificationLabel(key: string): string {
  if (specificationLabels[key]) return specificationLabels[key];
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (character) => character.toLocaleUpperCase("pt-BR"));
}
