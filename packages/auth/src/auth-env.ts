export function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function getRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

/** Comma-separated env list, trimmed, empty entries dropped. */
export function readEnvList(name: string): string[] {
  return (readEnv(name) ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
