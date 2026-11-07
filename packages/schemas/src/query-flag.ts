import { z } from "zod";

/**
 * A yes/no filter in a query string. A query string carries text, so `"false"`
 * must read as false (`z.coerce.boolean()` turns every non-empty string, `"false"`
 * included, into true). A boolean is accepted too, for callers that build the
 * query as an object; any other text is a validation error.
 */
export const queryFlag = z
  .union([z.boolean(), z.enum(["true", "false", "1", "0"])])
  .transform((value) => value === true || value === "true" || value === "1");
