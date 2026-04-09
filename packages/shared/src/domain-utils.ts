function trimTrailingDot(value: string): string {
  return value.replace(/\.$/, "");
}

export function normalizeHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return null;

  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const hostname = trimTrailingDot(withoutProtocol.split("/")[0] ?? "");
  if (!hostname) return null;
  if (hostname.includes(":")) return null;
  if (!/^[a-z0-9.-]+$/.test(hostname)) return null;
  if (hostname.startsWith(".") || hostname.endsWith(".")) return null;

  return hostname;
}

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return null;
  }
}

export function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".local") ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
  );
}
