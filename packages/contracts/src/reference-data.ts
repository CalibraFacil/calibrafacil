import { z } from "zod";
import { nullableString } from "./common";

/**
 * Response contracts for the reference data a technician reads and captures in
 * the field: asset types (the other domains live in `endpoints/`). Wire
 * schemas (see `jobs.ts` for the rules). The cloud API and the desktop
 * local-server (offline mirror) both serve these shapes; the API contract
 * specs and the local-server contract tests parse the real responses with the
 * same schemas, so the two cannot drift apart unnoticed.
 *
 * Fields the offline mirror does not keep (the SQLite cache stores only what
 * the field workflows need) are declared optional here, exactly as the client
 * types already treat them.
 */

const jsonRecordSchema = z.record(z.string(), z.unknown());

// ---------------------------------------------------------------------------
// Asset types
// ---------------------------------------------------------------------------

const assetTypeSchema = z.object({
  id: z.number(),
  name: z.string(),
  slug: z.string(),
  description: nullableString,
  /** The field definitions of the specification form (opaque list of records). */
  definition: z.array(jsonRecordSchema).nullable(),
});

/** GET /api/asset-types */
export const assetTypesResponseSchema = z.object({
  data: z.array(assetTypeSchema),
});
export type AssetTypesResponse = z.infer<typeof assetTypesResponseSchema>;
