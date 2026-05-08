export function slugifyRouteIdentifier(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "item";
}

export function buildMethodRouteIdentifier(method: {
  name: string;
  version: number;
}): string {
  return `${slugifyRouteIdentifier(method.name)}-v${method.version}`;
}

export function buildServiceRouteIdentifier(service: { name: string }): string {
  return slugifyRouteIdentifier(service.name);
}

export function parseLegacyNumericIdentifier(
  identifier: string,
): number | null {
  if (!/^\d+$/.test(identifier)) return null;
  const value = Number(identifier);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export const parseNumericRouteIdentifier = parseLegacyNumericIdentifier;
