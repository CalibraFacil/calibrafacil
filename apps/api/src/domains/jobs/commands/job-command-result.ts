import type { OrgExecutor } from "@calibra-facil/db/for-org";
import { DomainError } from "../../../lib/domain-errors";
import { jobNotFound } from "../job-access";
import { jobStatusConflict } from "./job-status-transitions";

function isOk<R extends { status: string }>(
  result: R,
): result is Extract<R, { status: "ok" }> {
  return result.status === "ok";
}

function refusalOf(result: object): DomainError | null {
  const error = Reflect.get(result, "error");
  return error instanceof DomainError ? error : null;
}

/**
 * The `ok` result of a job lifecycle command, or its refusal thrown as the
 * `DomainError` the route answers with: `not_found` is the 404, a lost
 * compare-and-set (`concurrent_update`) the 409 carrying the status the job
 * holds now, and every other refusal the command's own error (status, code and
 * pt-BR message unchanged). Call it inside the `withOrg` that ran the command:
 * the throw rolls the transaction back, and nothing a refusal reached is kept.
 */
export async function requireJobCommandOk<R extends { status: string }>(
  reader: Pick<OrgExecutor, "select">,
  jobId: number,
  result: R,
): Promise<Extract<R, { status: "ok" }>> {
  if (isOk(result)) return result;
  if (result.status === "not_found") throw jobNotFound();
  if (result.status === "concurrent_update") {
    throw await jobStatusConflict(jobId, reader);
  }
  const error = refusalOf(result);
  if (error) throw error;
  throw new Error(`Unmapped job command result: ${result.status}`);
}
