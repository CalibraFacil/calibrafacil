import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { JOB_HANDLERS } from "../../../vercel-src/cron/dispatch";

/**
 * Guards the exact class of outage that took every cron offline in prod
 * (2026-06-24): a greedy `/api/(.*) -> /api` rewrite swallowed every
 * `/api/cron/*` path into the Hono app (404) before the `api/cron/[job]`
 * dispatcher could match, AND nothing asserted that each scheduled cron path
 * actually has a registered handler. This test locks down three invariants in
 * `vercel.json` so neither failure mode can silently reappear:
 *
 *   1. crons[].path  <->  JOB_HANDLERS  is a bijection (no 404-on-missing-handler,
 *      no orphan handler without a schedule).
 *   2. No rewrite swallows a `/api/cron/*` path into the Hono app (`/api`). The
 *      cron paths must fall through to the dynamic dispatcher with their path
 *      intact (the dispatcher reads the trailing segment).
 *   3. Ordinary `/api/*` traffic STILL reaches the Hono app, so the cron
 *      exclusion did not over-narrow the catch-all.
 *
 * Matching is done with a small, self-contained translator for the Vercel
 * rewrite-source subset this project uses (literals, `:name(<regex>)`,
 * `(<regex>)`, `:name`, `*`). It deliberately does NOT depend on path-to-regexp:
 * that package is a security-flagged dep here (pnpm override pins 8.x, whose
 * syntax differs from the `:path((?!cron/).*)` form we use). The translator
 * throws on any construct it doesn't recognize, so a future rewrite using new
 * syntax fails loudly instead of silently passing.
 */

type Rewrite = { source: string; destination: string };
type Cron = { path: string; schedule: string };
type VercelConfig = { crons?: Cron[]; rewrites?: Rewrite[] };

const vercelConfig: VercelConfig = JSON.parse(
  readFileSync(
    fileURLToPath(new URL("../../../vercel.json", import.meta.url)),
    "utf8",
  ),
);

const crons = vercelConfig.crons ?? [];
const rewrites = vercelConfig.rewrites ?? [];

function trailingSegment(path: string): string {
  const segments = path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

/** Read a balanced `(...)` group starting at `start` (which must be `(`). */
function readBalancedParens(
  source: string,
  start: number,
): { group: string; next: number } {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0)
        return { group: source.slice(start, i + 1), next: i + 1 };
    }
  }
  throw new Error(`Unbalanced parentheses in rewrite source: ${source}`);
}

/**
 * Translate a Vercel rewrite `source` into an anchored RegExp for the subset of
 * syntax used in this repo. Throws on unrecognized constructs.
 */
function sourceToRegExp(source: string): RegExp {
  let pattern = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === ":") {
      i++; // skip ':'
      while (i < source.length && /[A-Za-z0-9_]/.test(source[i] ?? "")) i++;
      if (source[i] === "(") {
        const { group, next } = readBalancedParens(source, i);
        pattern += group; // a named param with an explicit capture pattern
        i = next;
      } else {
        pattern += "([^/]+)"; // bare :name -> one path segment
      }
      if (i < source.length && "*+?".includes(source[i] ?? "")) {
        pattern += source[i];
        i++;
      }
    } else if (ch === "(") {
      const { group, next } = readBalancedParens(source, i);
      pattern += group;
      i = next;
    } else if (ch === "*") {
      pattern += "(.*)";
      i++;
    } else {
      pattern += (ch ?? "").replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      i++;
    }
  }
  return new RegExp(`^${pattern}$`);
}

/**
 * First rewrite (in array order — Vercel is first-match-wins) whose source
 * matches `path`, or undefined if the path falls through to the filesystem /
 * dynamic functions.
 */
function firstMatchingRewrite(path: string): Rewrite | undefined {
  return rewrites.find((rewrite) => sourceToRegExp(rewrite.source).test(path));
}

describe("cron routing parity (vercel.json)", () => {
  it("every scheduled cron path maps to exactly one registered handler", () => {
    const cronSegments = crons
      .map((cron) => trailingSegment(cron.path))
      .toSorted();
    const handlerNames = Object.keys(JOB_HANDLERS).toSorted();
    expect(cronSegments).toEqual(handlerNames);
  });

  it("declares at least the six known crons (catches a dropped schedule)", () => {
    expect(crons.length).toBeGreaterThanOrEqual(6);
  });

  it.each(crons.map((cron) => cron.path))(
    "does not swallow %s into the Hono app",
    (cronPath) => {
      const match = firstMatchingRewrite(cronPath);
      // Either no rewrite matches (falls through to the api/cron/[job] lambda),
      // or one matches but it must NOT redirect the cron path to the Hono app.
      if (match) {
        expect(match.destination).not.toBe("/api");
      }
    },
  );

  it("still routes ordinary /api/* traffic to the Hono app", () => {
    const match = firstMatchingRewrite("/api/jobs/123/approve");
    expect(match?.destination).toBe("/api");
  });
});
