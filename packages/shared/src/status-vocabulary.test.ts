import { describe, expect, it } from "vitest";

import { defineStatusVocabulary } from "./status-vocabulary";

const vocabulary = defineStatusVocabulary(["OPEN", "CLOSED"] as const, {
  OPEN: { label: "Aberta", tone: "info" },
  CLOSED: { label: "Fechada", tone: "neutral" },
});

describe("defineStatusVocabulary", () => {
  it("parses only declared states", () => {
    expect(vocabulary.parse("CLOSED")).toBe("CLOSED");
    expect(vocabulary.parse("closed")).toBeNull();
    expect(vocabulary.parse(undefined)).toBeNull();
  });

  it("requires a declared state and throws on anything else", () => {
    expect(vocabulary.require("OPEN")).toBe("OPEN");
    expect(() => vocabulary.require("ARCHIVED")).toThrow(
      "Unknown status: ARCHIVED",
    );
    expect(() => vocabulary.require(undefined)).toThrow("Unknown status");
  });

  it("lists options in declaration order", () => {
    expect(vocabulary.options).toEqual([
      { value: "OPEN", label: "Aberta" },
      { value: "CLOSED", label: "Fechada" },
    ]);
  });
});
