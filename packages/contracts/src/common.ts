import { z } from "zod";

/**
 * Building blocks shared by the response contracts of every domain. Same
 * rules as `jobs.ts`: wire schemas that only validate (no defaults,
 * transforms or coercion), unknown keys allowed.
 */

export const nullableString = z.string().nullable();
export const nullableNumber = z.number().nullable();

/** The `{ page, limit, total, totalPages }` block of every paginated list. */
export const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});
export type Pagination = z.infer<typeof paginationSchema>;

/** The `{ unitId, unitName }` context the unit-scoped settings routes echo. */
export const unitContextSchema = z.object({
  unitId: z.number().nullable(),
  unitName: nullableString,
});
export type UnitContext = z.infer<typeof unitContextSchema>;
