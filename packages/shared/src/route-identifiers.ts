import { slugify } from "./text";

/**
 * Readable URL identifiers. The cloud API, the desktop's local store and the web app resolve the
 * same URL, so they all build and parse identifiers here.
 */
export function slugifyRouteIdentifier(value: string): string {
  return slugify(value) || "item";
}

export function methodRouteId(method: {
  name: string;
  version: number;
}): string {
  return `${slugifyRouteIdentifier(method.name)}-v${method.version}`;
}

export function standardRouteId(standard: {
  id: string | number;
  name: string;
}): string {
  return `${slugifyRouteIdentifier(standard.name)}-${standard.id}`;
}

export function assetRouteId(asset: { tag: string }): string {
  return slugifyRouteIdentifier(asset.tag);
}

export function clientRouteId(client: {
  name: string;
  taxId?: string | null;
}): string {
  return slugifyRouteIdentifier(client.taxId || client.name);
}

export function serviceRouteId(service: { name: string }): string {
  return slugifyRouteIdentifier(service.name);
}

/** A positive integer identifier (the numeric id older links carry), or null. */
export function parseNumericRouteIdentifier(identifier: string): number | null {
  if (!/^\d+$/.test(identifier)) return null;
  const value = Number(identifier);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
