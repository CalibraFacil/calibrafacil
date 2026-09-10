import { describe, expect, it } from "vitest";

import {
  describeDeepLinkRejection,
  findDeepLinkInArgv,
  resolveDeepLink,
  type DeepLinkRejection,
} from "./deep-links";
import { hasControlCharacter } from "./deep-link-path";

function pathOf(url: string) {
  const result = resolveDeepLink(url);
  return result.ok ? result.path : null;
}

function rejectionOf(url: string): DeepLinkRejection | null {
  const result = resolveDeepLink(url);
  return result.ok ? null : result.reason;
}

describe("resolveDeepLink", () => {
  it("routes a dashboard link", () => {
    expect(pathOf("calibrafacil://dashboard/jobs/12")).toBe(
      "/dashboard/jobs/12",
    );
  });

  it("accepts the triple-slash spelling", () => {
    // `calibrafacil://dashboard/x` parses with host "dashboard"; the
    // triple-slash form puts everything in pathname. Both must land the same.
    expect(pathOf("calibrafacil:///dashboard/jobs/12")).toBe(
      "/dashboard/jobs/12",
    );
  });

  it("preserves search and hash", () => {
    expect(pathOf("calibrafacil://dashboard/jobs?status=REVIEW#top")).toBe(
      "/dashboard/jobs?status=REVIEW#top",
    );
  });

  it("normalizes trailing slashes", () => {
    expect(pathOf("calibrafacil://dashboard/jobs/")).toBe("/dashboard/jobs");
  });

  it("keeps percent-encoded route identifiers intact", () => {
    // Certificate numbers contain slashes and reach routes double-encoded.
    expect(pathOf("calibrafacil://dashboard/jobs/R-0001%252F2026")).toBe(
      "/dashboard/jobs/R-0001%252F2026",
    );
  });
});

/**
 * Hostile inputs an attacker could hand the OS. The contract is not that each
 * one produces a particular rejection — the URL parser neutralizes several of
 * them on its own, and which ones is a parser-version detail. The contract is
 * that nothing here ever yields a path that leaves the app.
 */
const HOSTILE_LINKS = [
  "calibrafacil://javascript:alert(1)",
  "calibrafacil://data:text/html,<script>alert(1)</script>",
  "calibrafacil://file:///etc/passwd",
  "calibrafacil:////evil.example/steal",
  "calibrafacil://dashboard/../../etc/passwd",
  "calibrafacil://dashboard/%2e%2e%2f%2e%2e%2fetc/passwd",
  "calibrafacil://dashboard/%00jobs",
  "calibrafacil://dashboard/%0Ajobs",
  "calibrafacil://dashboard/%E0%A4%A",
  "calibrafacil://dashboard//evil.example",
  "calibrafacil://\\evil.example/steal",
];

describe("resolveDeepLink safety invariant", () => {
  it.each(HOSTILE_LINKS)("never escapes the app for %s", (link) => {
    const result = resolveDeepLink(link);
    if (!result.ok) return;

    // Exactly one leading slash: `//host` would be protocol-relative and the
    // renderer would follow it off-origin.
    expect(result.path.startsWith("/")).toBe(true);
    expect(result.path.startsWith("//")).toBe(false);
    // No scheme the renderer could execute.
    expect(/^[a-z][a-z0-9+.-]*:/i.test(result.path.slice(1))).toBe(false);
    expect(result.path).not.toContain("..");
    expect(hasControlCharacter(decodeURIComponent(result.path))).toBe(false);
  });
});

describe("resolveDeepLink rejections", () => {
  it("rejects a link that is not a URL", () => {
    expect(rejectionOf("not a url")).toBe("not-a-url");
  });

  it("rejects another application's scheme", () => {
    expect(rejectionOf("https://evil.example/dashboard")).toBe("wrong-scheme");
    expect(rejectionOf("otherapp://dashboard/jobs")).toBe("wrong-scheme");
  });

  it("rejects a link with no destination", () => {
    expect(rejectionOf("calibrafacil://")).toBe("empty-path");
    expect(rejectionOf("calibrafacil:///")).toBe("empty-path");
  });

  it("rejects percent-encoded traversal, which the URL parser leaves intact", () => {
    expect(rejectionOf("calibrafacil://dashboard/%2e%2e%2f%2e%2e%2fetc")).toBe(
      "unsafe-path",
    );
  });

  it("rejects control characters", () => {
    expect(rejectionOf("calibrafacil://dashboard/%00jobs")).toBe("unsafe-path");
    expect(rejectionOf("calibrafacil://dashboard/%0Ajobs")).toBe("unsafe-path");
  });

  it("rejects a malformed percent-escape rather than guessing", () => {
    expect(rejectionOf("calibrafacil://dashboard/%E0%A4%A")).toBe(
      "unsafe-path",
    );
  });

  it("has an operator-readable message for every rejection", () => {
    for (const reason of [
      "not-a-url",
      "wrong-scheme",
      "empty-path",
      "unsafe-path",
    ] as const) {
      expect(describeDeepLinkRejection(reason)).toMatch(/\S/);
    }
  });
});

describe("findDeepLinkInArgv", () => {
  it("finds the link a packaged Windows launch appends", () => {
    expect(
      findDeepLinkInArgv([
        "C:\\Program Files\\CalibraFacil\\CalibraFacil.exe",
        "--allow-file-access-from-files",
        "calibrafacil://dashboard/jobs/12",
      ]),
    ).toBe("calibrafacil://dashboard/jobs/12");
  });

  it("prefers the last link when argv carries more than one", () => {
    expect(
      findDeepLinkInArgv([
        "calibrafacil://dashboard/old",
        "calibrafacil://dashboard/new",
      ]),
    ).toBe("calibrafacil://dashboard/new");
  });

  it("matches the scheme case-insensitively", () => {
    expect(findDeepLinkInArgv(["CalibraFacil://dashboard/jobs"])).toBe(
      "CalibraFacil://dashboard/jobs",
    );
  });

  it("returns null for an ordinary launch", () => {
    expect(findDeepLinkInArgv(["/usr/bin/calibra-facil", "--no-sandbox"])).toBe(
      null,
    );
    expect(findDeepLinkInArgv([])).toBe(null);
  });

  it("does not mistake a similar scheme for ours", () => {
    expect(findDeepLinkInArgv(["calibrafacil-evil://dashboard"])).toBe(null);
  });
});
