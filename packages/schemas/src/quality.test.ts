import { describe, expect, it } from "vitest";

import { CreateCapaSchema, CreateNonConformanceSchema } from "./quality";

describe("CreateNonConformanceSchema", () => {
  it("accepts a valid payload", () => {
    expect(
      CreateNonConformanceSchema.safeParse({
        type: "work",
        description: "Leitura fora da faixa esperada",
        detectedAt: "2026-05-20T12:00:00.000Z",
        jobId: 42,
      }).success,
    ).toBe(true);
  });

  it("rejects short descriptions", () => {
    const result = CreateNonConformanceSchema.safeParse({
      type: "work",
      description: "Curta",
      detectedAt: "2026-05-20T12:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });

  it("rejects invalid detection timestamps", () => {
    const result = CreateNonConformanceSchema.safeParse({
      type: "work",
      description: "Descrição suficiente para validar",
      detectedAt: "data-invalida",
    });

    expect(result.success).toBe(false);
  });

  it("allows omitting jobId", () => {
    expect(
      CreateNonConformanceSchema.safeParse({
        type: "documentation",
        description: "Documento emitido com informação divergente",
        detectedAt: "2026-05-20T12:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects invalid jobId values", () => {
    const result = CreateNonConformanceSchema.safeParse({
      type: "equipment",
      description: "Equipamento identificado fora de tolerância",
      detectedAt: "2026-05-20T12:00:00.000Z",
      jobId: 0,
    });

    expect(result.success).toBe(false);
  });
});

describe("CreateCapaSchema", () => {
  const validPayload = {
    title: "Ajustar procedimento",
    description: "Procedimento precisa de revisão após auditoria",
    source: "internal_audit",
    detectionDate: "2026-05-20T12:00:00.000Z",
    type: "corrective",
    severity: "major",
    category: "procedure",
    actionPlan: "Revisar procedimento, treinar equipe e registrar evidências",
    responsibleId: "user-1",
    dueDate: "2026-06-20T12:00:00.000Z",
  } as const;

  it("accepts a valid CAPA creation payload", () => {
    expect(CreateCapaSchema.safeParse(validPayload).success).toBe(true);
  });

  it("rejects invalid classification values", () => {
    expect(
      CreateCapaSchema.safeParse({
        ...validPayload,
        severity: "blocker",
      }).success,
    ).toBe(false);
  });

  it("requires a responsible user", () => {
    expect(
      CreateCapaSchema.safeParse({
        ...validPayload,
        responsibleId: "",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid target dates", () => {
    expect(
      CreateCapaSchema.safeParse({
        ...validPayload,
        dueDate: "data-invalida",
      }).success,
    ).toBe(false);
  });
});
