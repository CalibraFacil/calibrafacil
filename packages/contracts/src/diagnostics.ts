import { z } from "zod";

export const localDiagnosticsSchema = z.object({
  runtime: z.object({
    desktopRunId: z.string().nullable(),
    localServerRunId: z.string().nullable(),
  }),
  sync: z.object({
    state: z.string(),
    activeRunId: z.string().nullable(),
    lastRunId: z.string().nullable(),
    lastError: z.string().nullable(),
  }),
  database: z.object({
    schemaVersion: z.number().int().nonnegative(),
    integrity: z.object({
      ok: z.boolean(),
      messages: z.array(z.string()),
    }),
    pendingOutboxCount: z.number().int().nonnegative(),
    conflictCount: z.number().int().nonnegative(),
    activeCalibrationJobCount: z.number().int().nonnegative(),
    activeServiceOrderWorkflowCount: z.number().int().nonnegative(),
  }),
});

export type LocalDiagnostics = z.infer<typeof localDiagnosticsSchema>;
