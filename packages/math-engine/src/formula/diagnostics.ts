export type DiagnosticSeverity = "info" | "warning" | "error";

export interface CalculationDiagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}
