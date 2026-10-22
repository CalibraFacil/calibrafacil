function slugify(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 50);
}

export function generateUniqueSlug(name: string) {
  return `${slugify(name)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(Object.entries(value));
}

export function toIdempotencyResponseStatus(
  status: number,
): 200 | 201 | 202 | 204 {
  switch (status) {
    case 201:
    case 202:
    case 204:
      return status;
    default:
      return 200;
  }
}
