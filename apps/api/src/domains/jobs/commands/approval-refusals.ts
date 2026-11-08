import { toApiErrorJson } from "../../../lib/api-error-json";
import {
  DomainError,
  conflict,
  forbidden,
  invalid,
  unprocessable,
} from "../../../lib/domain-errors";
import { jobNotFound } from "../job-access";
import type { ApproveJobResult } from "./approve-job";
import { approvalStandardsRefusalDomainError } from "./standards-judgement";

/**
 * The cloud route's answer to an approval that did not release the
 * certificate: the refusal as the `DomainError` the route throws. Status, the
 * stable code and the pt-BR message; `environmentalSnapshot` and
 * `scopeCompliance` stay top-level fields of their bodies. The public API
 * (`public-api-v2/jobs-decisions.ts`) maps the same results to its own codes
 * (the same spelling for the refusals both answer).
 */
export function approvalRefusalError(
  result: Exclude<ApproveJobResult, { status: "approved" }>,
): DomainError {
  switch (result.status) {
    case "not_found":
      return jobNotFound();
    case "invalid_status":
      return invalid(
        "job_not_approvable",
        `Nao e possivel aprovar um job com status ${result.currentStatus}. O job deve estar em REVIEW.`,
      );
    case "approval_requires_signatory":
      return forbidden(
        "approval_requires_signatory",
        "Apenas um signatário autorizado pode aprovar a calibração.",
      );
    case "role_not_permitted":
      return forbidden(
        "APPROVAL_ROLE_NOT_PERMITTED",
        "Seu papel não permite aprovar calibrações.",
      );
    case "dispatch_failed":
      return new DomainError({
        code: "approval_dispatch_failed",
        status: 503,
        message:
          "Não foi possível enfileirar a geração do certificado. A aprovação foi revertida; tente novamente.",
      });
    case "concurrent_approval":
      return conflict(
        "approval_conflict",
        "A calibração foi alterada por outra aprovação ou revisão em andamento. Atualize e tente novamente.",
      );
    case "self_approval_blocked":
      return forbidden(
        "self_approval_blocked",
        "Separação de responsabilidades (ISO/IEC 17025): quem executou, criou ou submeteu a calibração para revisão não pode aprová-la. Solicite a aprovação a outro membro autorizado.",
      );
    case "signatory_roster_empty":
      return forbidden(
        "APPROVAL_ROSTER_EMPTY",
        "O laboratório acreditado não mantém signatários autorizados ativos (ISO/IEC 17025 §6.2.6): ninguém pode liberar o certificado. Cadastre ao menos um signatário autorizado e tente novamente.",
      );
    case "standards_refused":
      return approvalStandardsRefusalDomainError(result.refusal);
    case "not_authorized_signatory":
      return forbidden(
        "APPROVER_NOT_AUTHORIZED_SIGNATORY",
        "O aprovador não é um signatário autorizado para este tipo de instrumento (ISO/IEC 17025 §6.2.6). A liberação do certificado deve ser feita por um signatário autorizado.",
      );
    case "environmental_justification_required":
      return invalid(
        "environmental_justification_required",
        "Condições ambientais fora dos limites. Forneça uma justificativa para aprovar.",
        {
          legacyBody: {
            environmentalSnapshot: toApiErrorJson(result.environmentalSnapshot),
          },
        },
      );
    case "scope_violation":
      return unprocessable(
        "scope_violation",
        "Violação do escopo acreditado (CMC): a emissão acreditada está bloqueada. Corrija o resultado ou aprove com justificativa documentada. Nesse caso o certificado sai sem o selo de acreditação.",
        {
          legacyBody: {
            scopeCompliance: toApiErrorJson(result.scopeCompliance),
          },
        },
      );
  }
}
