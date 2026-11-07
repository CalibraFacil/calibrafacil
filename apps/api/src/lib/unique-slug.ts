import { slugify } from "@calibra-facil/shared/text";

/** A slug for a unique column: the readable part plus a random six-character suffix. */
export function uniqueSlug(name: string, maxLength = 50): string {
  return `${slugify(name, maxLength)}-${Math.random().toString(36).slice(2, 8)}`;
}
