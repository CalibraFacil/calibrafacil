import { describe, expect, it } from "vitest";
import {
  classifyFleetDueStatus,
  renderFleetStatusReportHtml,
  FLEET_DUE_SOON_DAYS,
  type FleetStatusAsset,
} from "./FleetStatusReportHtml.js";

const NOW = new Date("2026-07-10T12:00:00.000Z");

describe("classifyFleetDueStatus", () => {
  it("classifies a missing next date as UNSCHEDULED", () => {
    expect(classifyFleetDueStatus(null, NOW)).toEqual({
      status: "UNSCHEDULED",
      label: "Sem programação",
    });
  });

  it("classifies a past date as OVERDUE with the day count", () => {
    const due = classifyFleetDueStatus(new Date("2026-07-05T12:00:00Z"), NOW);
    expect(due.status).toBe("OVERDUE");
    expect(due.label).toBe("Vencido há 5 dias");
  });

  it("classifies today as DUE_SOON / 'Vence hoje'", () => {
    const due = classifyFleetDueStatus(new Date("2026-07-10T12:00:00Z"), NOW);
    expect(due.status).toBe("DUE_SOON");
    expect(due.label).toBe("Vence hoje");
  });

  it("classifies a date within the window as DUE_SOON with the day count", () => {
    const due = classifyFleetDueStatus(new Date("2026-07-20T12:00:00Z"), NOW);
    expect(due.status).toBe("DUE_SOON");
    expect(due.label).toBe("Vence em 10 dias");
  });

  it("classifies a date beyond the window as OK ('Em dia')", () => {
    const beyond = new Date(NOW);
    beyond.setDate(beyond.getDate() + FLEET_DUE_SOON_DAYS + 1);
    expect(classifyFleetDueStatus(beyond, NOW)).toEqual({
      status: "OK",
      label: "Em dia",
    });
  });
});

function makeAsset(overrides: Partial<FleetStatusAsset>): FleetStatusAsset {
  return {
    name: "Balança Analítica",
    tag: "EQ-001",
    serialNumber: "SN-1",
    manufacturer: "Fabricante",
    model: "MOD-1",
    unitName: null,
    lastCalibrationDate: "2026-01-10T12:00:00.000Z",
    nextCalibrationDate: "2027-01-10T12:00:00.000Z",
    calibrationIntervalMonths: 12,
    metrologyRegime: "INDUSTRIAL",
    nextLegalVerificationDate: null,
    ...overrides,
  };
}

describe("renderFleetStatusReportHtml", () => {
  it("renders the disclaimer, the asset row and the pt-BR status label", () => {
    const html = renderFleetStatusReportHtml({
      labName: "Lab Acme",
      customerName: "Empresa Teste SA",
      generatedAtIso: NOW.toISOString(),
      dueSoonDays: FLEET_DUE_SOON_DAYS,
      assets: [
        makeAsset({}),
        makeAsset({
          tag: "EQ-002",
          nextCalibrationDate: "2026-07-01T12:00:00.000Z",
        }),
      ],
    });

    expect(html).toContain("não é um certificado de calibração");
    expect(html).toContain("§7.8.4.3");
    expect(html).toContain("EQ-001");
    expect(html).toContain("Em dia");
    expect(html).toContain("Vencido há 9 dias");
    // Single-unit fleet: no Unidade column.
    expect(html).not.toContain("<th>Unidade</th>");
  });

  it("adds the Unidade column only when assets span multiple units", () => {
    const html = renderFleetStatusReportHtml({
      labName: "Lab Acme",
      customerName: "Rede Teste",
      generatedAtIso: NOW.toISOString(),
      dueSoonDays: FLEET_DUE_SOON_DAYS,
      assets: [
        makeAsset({ unitName: "Filial Sul" }),
        makeAsset({ tag: "EQ-002", unitName: "Filial Norte" }),
      ],
    });
    expect(html).toContain("<th>Unidade</th>");
    expect(html).toContain("Filial Sul");
  });

  it("escapes HTML in customer-controlled fields", () => {
    const html = renderFleetStatusReportHtml({
      labName: "Lab Acme",
      customerName: "Empresa <script>alert(1)</script>",
      generatedAtIso: NOW.toISOString(),
      dueSoonDays: FLEET_DUE_SOON_DAYS,
      assets: [makeAsset({ name: 'Balança "X" <b>' })],
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<b>");
  });
});
