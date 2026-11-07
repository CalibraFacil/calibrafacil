// The one reader of dotenv-style files: the Bun entry points (API, worker), the
// config check and the dev setup script all read through it, so a line one of
// them takes is a line all of them take. No imports: a plain Node script can
// load this file directly.

export interface EnvFile {
  readonly env: Record<string, string>;
  /** Malformed lines, by number: a line's content is never quoted. */
  readonly problems: readonly string[];
}

/**
 * Parse a dotenv-style file: `KEY=VALUE` lines, `#` comments, optional
 * `export`, single or double quotes around the value.
 */
export function parseEnvFile(contents: string): EnvFile {
  const env: Record<string, string> = {};
  const problems: string[] = [];

  contents.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) return;

    const match = line.match(
      /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/,
    );
    if (!match?.[1]) {
      problems.push(`line ${index + 1} is not KEY=VALUE`);
      return;
    }

    let value = (match[2] ?? "").trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    env[match[1]] = value;
  });

  return { env, problems };
}
