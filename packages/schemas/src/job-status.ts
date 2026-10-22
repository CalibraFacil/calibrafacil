import { z } from "zod";

// Lives in its own module so job-transitions.ts can import it without a cycle
// through index.ts.
export const JobStatusSchema = z.enum([
  "DRAFT",
  "IN_PROGRESS",
  "REVIEW",
  "GENERATING_PDF",
  "APPROVED",
  "REJECTED",
  "CANCELED",
  "SUPERSEDED",
]);

export type JobStatus = z.infer<typeof JobStatusSchema>;
