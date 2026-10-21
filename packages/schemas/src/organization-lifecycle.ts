import { z } from "zod";

/**
 * Soft delete of a laboratory (records retention, decision Q16).
 *
 * The owner types the organization's name to confirm and gives the reason that
 * is kept on the organization record and its event log. The confirmation is
 * compared with the real name on the server (`confirmationMatchesOrganizationName`),
 * because the schema cannot know it.
 */
export const SOFT_DELETE_REASON_MIN_LENGTH = 10;
export const SOFT_DELETE_REASON_MAX_LENGTH = 500;

export const SoftDeleteOrganizationSchema = z.object({
  confirmName: z.string().trim().min(1).max(200),
  reason: z
    .string()
    .trim()
    .min(SOFT_DELETE_REASON_MIN_LENGTH)
    .max(SOFT_DELETE_REASON_MAX_LENGTH),
});

export type SoftDeleteOrganizationInput = z.infer<
  typeof SoftDeleteOrganizationSchema
>;

/** Exact match with the organization name; only surrounding spaces are forgiven. */
export function confirmationMatchesOrganizationName(
  confirmation: string,
  organizationName: string,
): boolean {
  return confirmation.trim() === organizationName.trim();
}
