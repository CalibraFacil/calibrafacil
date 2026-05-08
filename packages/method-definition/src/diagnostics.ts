import type { MethodDiagnostic, MethodDiagnosticSeverity } from "./types";

export function diagnostic(
  code: string,
  severity: MethodDiagnosticSeverity,
  message: string,
  path?: string,
  details?: MethodDiagnostic["details"],
): MethodDiagnostic {
  return {
    code,
    severity,
    message,
    ...(path ? { path } : {}),
    ...(details ? { details } : {}),
  };
}

export function hasErrors(diagnostics: readonly MethodDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === "error");
}

export function errorDiagnostic(
  code: string,
  message: string,
  path?: string,
  details?: MethodDiagnostic["details"],
): MethodDiagnostic {
  return diagnostic(code, "error", message, path, details);
}

export function warningDiagnostic(
  code: string,
  message: string,
  path?: string,
  details?: MethodDiagnostic["details"],
): MethodDiagnostic {
  return diagnostic(code, "warning", message, path, details);
}

export function infoDiagnostic(
  code: string,
  message: string,
  path?: string,
  details?: MethodDiagnostic["details"],
): MethodDiagnostic {
  return diagnostic(code, "info", message, path, details);
}
