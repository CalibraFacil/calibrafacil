/**
 * The Brazilian postal address shape the lab app, the portal and the API
 * payloads agree on (`neighbourhood` is the field name on the wire, `bairro`
 * in ViaCEP), and its one single-line formatter.
 */

/** An address as stored and sent: every part optional text. */
export type Address = {
  cep?: string;
  number?: string;
  street?: string;
  complement?: string;
  neighbourhood?: string;
  city?: string;
  state?: string;
};

/** An address as typed in a form: every part present, empty when blank. */
export type AddressForm = Required<Address>;

export const EMPTY_ADDRESS_FORM: AddressForm = {
  cep: "",
  street: "",
  number: "",
  complement: "",
  neighbourhood: "",
  city: "",
  state: "",
};

/** Any record that carries address parts, nullable as read-models often are. */
export type AddressLike = {
  [Part in keyof Address]?: string | null;
};

/**
 * Single-line address: "Rua A, 10 · Sala 2 · Centro - Curitiba - PR · 80000-000",
 * or "" when there is none. Street and number read as one part, the region
 * (neighbourhood, city, state) as another, every part is trimmed and blanks
 * are dropped.
 */
export function formatAddress(address: AddressLike | null | undefined): string {
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

/**
 * Flat, comma-separated address in postal order: "Rua Um, 123, Sala 2, Centro,
 * Curitiba, PR, 80000-000". Unlike {@link formatAddress} this is the text a
 * calibration's location snapshot stores (it is then frozen into the record),
 * so it keeps the plain list instead of the display grouping.
 */
export function formatAddressLine(
  address: AddressLike | null | undefined,
): string {
  if (!address) return "";
  return [
    address.street,
    address.number,
    address.complement,
    address.neighbourhood,
    address.city,
    address.state,
    address.cep,
  ]
    .filter(Boolean)
    .join(", ");
}
