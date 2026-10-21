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
    /** The part of `pendingOutboxCount` recorded by another user. */
    pendingForOtherUserCount: z.number().int().nonnegative().optional(),
    conflictCount: z.number().int().nonnegative(),
    activeCalibrationJobCount: z.number().int().nonnegative(),
    activeServiceOrderWorkflowCount: z.number().int().nonnegative(),
  }),
});

export type LocalDiagnostics = z.infer<typeof localDiagnosticsSchema>;
