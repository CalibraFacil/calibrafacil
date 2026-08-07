import type { CalibrationCertificateData } from "./types.js";

/**
 * Review fixture: the real production job CAL-2026-9001 (Laboratório Exemplo,
 * 2000 kg platform scale, calibrated on site), transcribed so the layout can
 * be judged against real data rather than lorem. Values are already rounded
 * per NIT-DICLA-021 A.6.3 — U at two significant figures, the error to U's
 * last decimal place.
 */
export function massCertificateFixture(): CalibrationCertificateData {
  return {
    certificateNumber: "CAL-2026-9001",
    verificationUrl: "https://verify.calibrafacil.com/v/tok-demo",
    accredited: true,
    lab: {
      name: "Laboratório Exemplo de Metrologia Ltda",
      cnpj: "11.222.333/0001-81",
      addressText:
        "Av. das Medidas, 1000 — Centro, Porto Alegre/RS — CEP 90000-000",
      phone: "(51) 3000-0000",
      email: "contato@laboratorio.example",
      website: "laboratorio.example",
      accreditationNumber: "9999",
    },
    customer: {
      name: "Britagem Modelo Ltda",
      taxId: "00.000.000/0001-00",
      addressText:
        "Rua Celeste Magagnin, 133 — Vila Nova, Bento Gonçalves/RS — CEP 95.706-040",
    },
    item: {
      description: "Balança de plataforma — instrumento de pesagem não automático",
      manufacturer: "Toledo",
      model: "Plataforma industrial",
      serialNumber: "MODELO-2000KG-01",
      tag: "MODELO-BAL-2000KG-01",
      capacityText: "2000 kg",
      divisionText: "0,5 kg (classe III, n = 4000)",
      conditionOnReceipt:
        "Recebido em uso, plataforma íntegra, sem avaria aparente.",
      accessories: "Indicador digital, cabo de alimentação",
    },
    dates: {
      receivedAtText: "12/05/2026",
      performedAtText: "06/06/2026",
      issuedAtText: "25/06/2026",
    },
    method: {
      name: "Calibração Rastreável de Balanças — FOR 50/51",
      version: 6,
      procedureCode: "PBT09",
      referenceStandards: ["EURAMET cg-18", "EA-4/02 M:2022", "UKAS LAB 14"],
    },
    locationText:
      "Instalações do cliente (em loco) — Rua Celeste Magagnin, 133, Bento Gonçalves/RS",
    environment: {
      temperatureText: "23,0 °C",
      humidityText: "50 %",
      pressureText: "1013 hPa",
      withinLimits: true,
    },
    resultTables: [
      {
        title: "Resultados antes do ajuste",
        unit: "kg",
        note: "No estado em que foi recebido o instrumento apresentava erros iguais ou superiores ao erro máximo admissível; foi ajustado e novamente calibrado. Valores meramente informativos, sem declaração de conformidade.",
        rows: [
          { point: "500 kg", indication: "499,50", error: "−0,50", expandedUncertainty: "0,29" },
          { point: "1000 kg", indication: "999,00", error: "−1,00", expandedUncertainty: "0,30" },
          { point: "1500 kg", indication: "1498,50", error: "−1,50", expandedUncertainty: "0,31" },
          { point: "2000 kg", indication: "1998,00", error: "−2,00", expandedUncertainty: "0,54" },
        ],
      },
      {
        title: "Resultados após o ajuste",
        unit: "kg",
        note: "Valores certificados, no estado de entrega.",
        rows: [
          { point: "500 kg", referenceValue: "500,00", indication: "500,00", error: "0,00", expandedUncertainty: "0,29", coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
          { point: "1000 kg", referenceValue: "1000,00", indication: "1000,00", error: "0,00", expandedUncertainty: "0,30", coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
          { point: "1500 kg", referenceValue: "1500,00", indication: "1500,00", error: "0,00", expandedUncertainty: "0,31", coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
          { point: "2000 kg", referenceValue: "2000,00", indication: "2000,00", error: "0,00", expandedUncertainty: "0,54", coverageFactor: "2,00", effectiveDegreesOfFreedom: "∞" },
        ],
      },
    ],
    repeatability: {
      unit: "kg",
      rows: [
        {
          phase: "Antes do ajuste",
          readings: ["1000,00", "1000,50", "1000,00", "1000,50", "1000,00"],
          value: "0,50",
        },
        {
          phase: "Depois do ajuste",
          readings: ["1000,00", "1000,00", "1000,00", "1000,00", "1000,00"],
          value: "0,00",
        },
      ],
      note: "Ensaio conduzido a 1000 kg, 5 repetições.",
    },
    eccentricity: {
      unit: "kg",
      rows: [
        { position: "A (centro)", before: "0,00", after: "0,00" },
        { position: "B", before: "0,50", after: "0,00" },
        { position: "C", before: "0,50", after: "0,00" },
        { position: "D", before: "0,00", after: "0,00" },
        { position: "E", before: "0,50", after: "0,00" },
      ],
      maxDeviationText: "0,00 kg (após o ajuste)",
      // Injected by the caller, exactly as the QR is: the diagram comes from
      // renderEccentricityIndicatorSvgMarkup in @calibra-facil/certificate-data,
      // and this package stays presentation-only rather than depending on the
      // domain projection.
      indicatorSvg: null,
      note: "Carga de excentricidade: 500 kg.",
    },
    uncertaintyStatement:
      "A incerteza expandida de medição relatada é declarada como a incerteza padrão de medição multiplicada pelo fator de abrangência k = 2,00, o qual para uma distribuição t com νeff → ∞ graus de liberdade efetivos corresponde a uma probabilidade de abrangência de aproximadamente 95 %. A incerteza padrão da medição foi determinada de acordo com a publicação EA-4/02.",
    standards: [
      { name: "JPO1 — Jogo de pesos padrão", certificateNumber: "01031/26", issuer: "SENAI", validUntilText: "26/03/2028" },
      { name: "JPO3 — Jogo de pesos padrão", certificateNumber: "01762/26", issuer: "SENAI", validUntilText: "18/05/2028" },
      { name: "JMP500 — Massa padrão 500 kg", certificateNumber: "SURRS-M036/2026", issuer: "SURRS", validUntilText: "03/03/2028" },
    ],
    traceabilityStatementText:
      "As medições realizadas são metrologicamente rastreáveis ao Sistema Internacional de Unidades (SI) por meio dos padrões relacionados neste certificado, calibrados por SENAI e SURRS.",
    methodDeviations: null,
    conformity: null,
    observations: null,
    signatory: {
      name: "Carlos Andrade",
      role: "Responsável Técnico — Signatário Autorizado",
      placeAndDateText: "Canoas/RS, 25 de junho de 2026",
    },
    provenance: {
      engineVersion: "math-engine 0.3.0",
      methodFingerprint: "a614c64c…",
      resultFingerprint: "e4928929…",
    },
  };
}
