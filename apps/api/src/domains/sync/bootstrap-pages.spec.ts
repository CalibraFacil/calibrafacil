import { describe, expect, it } from "vitest";
import {
  parseBootstrapPageToken,
  wantsBootstrapPages,
} from "./bootstrap-pages";
import { SYNC_ENTITY_SOURCES } from "./entity-sources";

describe("the bootstrap page token", () => {
  it("REQ-CS-3: parses the walk position it hands out and nothing else", () => {
    expect(parseBootstrapPageToken("b3|1234|2|99")).toEqual({
      xmin: 1234n,
      rank: 2,
      afterId: 99,
    });
    for (const bad of [
      "",
      "not-a-token",
      "b3|1234|2",
      "b3|x|2|99",
      "b3|1234|-1|99",
      "b2|1234|2|99",
      "v3|1234|0",
      // past the last entity
      `b3|1234|${SYNC_ENTITY_SOURCES.length}|0`,
      // ids are 32-bit serials
      "b3|1234|2|99999999999",
      "b3|1234|2|2147483648",
    ]) {
      expect(parseBootstrapPageToken(bad), bad).toBeNull();
    }
  });

  it("REQ-CS-3: the last entity is still a valid place to resume", () => {
    expect(
      parseBootstrapPageToken(`b3|7|${SYNC_ENTITY_SOURCES.length - 1}|0`),
    ).toEqual({ xmin: 7n, rank: SYNC_ENTITY_SOURCES.length - 1, afterId: 0 });
  });
});

describe("which bootstrap requests get pages", () => {
  it("REQ-CS-4: only a body that states protocol 3 or later; no body, or an older protocol, is the legacy bootstrap", () => {
    expect(wantsBootstrapPages(null)).toBe(false);
    expect(wantsBootstrapPages({})).toBe(false);
    expect(wantsBootstrapPages("3")).toBe(false);
    expect(wantsBootstrapPages({ protocolVersion: 2 })).toBe(false);
    expect(wantsBootstrapPages({ protocolVersion: "3" })).toBe(false);
    expect(wantsBootstrapPages({ protocolVersion: 3 })).toBe(true);
    expect(wantsBootstrapPages({ protocolVersion: 4, pageToken: null })).toBe(
      true,
    );
  });
});
