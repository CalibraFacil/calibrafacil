import { describe, expect, it } from "vitest";

import { render } from "./entry-server";
import { REPOSITORY_URL } from "./lib/site";

function ids(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/\sid="([^"]*)"/g)].map((match) => match[1] ?? ""),
  );
}

/** The href of every <a>, in document order. */
function linkTargets(html: string): string[] {
  return [...html.matchAll(/<a\s[^>]*?href="([^"]*)"/g)].map(
    (match) => match[1] ?? "",
  );
}

describe("home page", () => {
  const html = render("home");

  it("links every in-page anchor to a section that exists", () => {
    const sections = ids(html);
    const anchors = linkTargets(html)
      .filter((href) => href.startsWith("/#") || href.startsWith("#"))
      .map((href) => href.slice(href.indexOf("#") + 1));

    expect(anchors.length).toBeGreaterThan(0);
    expect(anchors.filter((anchor) => !sections.has(anchor))).toEqual([]);
  });

  it("only links within the page or out to absolute URLs", () => {
    const internalPaths = linkTargets(html).filter(
      (href) => href.startsWith("/") && !href.startsWith("/#") && href !== "/",
    );

    expect(internalPaths).toEqual([]);
  });

  it("points at the repository and the local setup", () => {
    expect(html).toContain(REPOSITORY_URL);
    expect(html).toContain("pnpm setup:dev");
  });
});

describe("not-found page", () => {
  it("renders a way back home", () => {
    const html = render("not-found");

    expect(html).toContain("Página não encontrada");
    expect(linkTargets(html)).toContain("/");
  });
});
