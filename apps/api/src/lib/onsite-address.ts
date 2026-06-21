import type { CustomerAddress } from "@calibra-facil/db/schema";

/**
 * Formats the on-site calibration address to a single-line text string.
 * Used to freeze the calibration location snapshot at job creation time.
 */
export function formatOnsiteAddressText(
  address: CustomerAddress | null,
): string {
  if (!address) return "";
  const street = [address.street, address.number].filter(Boolean).join(", ");
  const region = [address.neighbourhood, address.city, address.state]
    .filter(Boolean)
    .join(" - ");
  return [street, address.complement, region, address.cep]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" · ");
}
