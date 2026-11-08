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

describe("one create schema per record", () => {
  it("the package root exports the same NC and CAPA schemas as ./quality (no shadowing copy)", async () => {
    const root = await import("./index");
    const quality = await import("./quality");

    expect(root.CreateNonConformanceSchema).toBe(
      quality.CreateNonConformanceSchema,
    );
    expect(root.NonConformanceTypeSchema).toBe(
      quality.NonConformanceTypeSchema,
    );
    expect(root.CreateCapaSchema).toBe(quality.CreateCapaSchema);
  });

  it("the root NC schema refuses a bad detectedAt and a negative or fractional jobId", async () => {
    const { CreateNonConformanceSchema: rootSchema } = await import("./index");
    const base = {
      type: "work",
      description: "Leitura fora da faixa esperada",
      detectedAt: "2026-05-20T12:00:00.000Z",
    };

    expect(rootSchema.safeParse({ ...base, detectedAt: "abc" }).success).toBe(
      false,
    );
    expect(rootSchema.safeParse({ ...base, jobId: -1 }).success).toBe(false);
    expect(rootSchema.safeParse({ ...base, jobId: 1.5 }).success).toBe(false);
    expect(rootSchema.safeParse({ ...base, jobId: null }).success).toBe(true);
  });

  it("the CAPA schema accepts the explicit nulls API clients send and refuses a bad date", () => {
    const payload = {
      title: "Falha no procedimento",
      description: "Desvio identificado na verificação intermediária",
      source: "nc_detection",
      sourceReference: null,
      detectionDate: "2026-06-01",
      type: "corrective",
      severity: "minor",
      category: "procedure",
      actionPlan: "Revisar o procedimento e retreinar a equipe",
      responsibleId: "user-1",
      dueDate: "2026-09-01",
      rootCauseAnalysis: null,
      rootCauseAnalysisMethod: null,
      preventiveMeasures: null,
    };

    expect(CreateCapaSchema.safeParse(payload).success).toBe(true);
    expect(
      CreateCapaSchema.safeParse({ ...payload, detectionDate: "abc" }).success,
    ).toBe(false);
  });
});
