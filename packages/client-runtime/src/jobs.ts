import type { ExecuteJobInput } from "@calibra-facil/schemas";

/**
 * The body of the execute (draft save) and submit calls: the schema the cloud
 * validates the execute request with, plus the submit-only backdate reason.
 */
export type JobExecutionPayload = ExecuteJobInput & {
  backdateReason?: string;
};
