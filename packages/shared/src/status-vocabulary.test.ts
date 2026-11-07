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

  it("lists options in declaration order", () => {
    expect(vocabulary.options).toEqual([
      { value: "OPEN", label: "Aberta" },
      { value: "CLOSED", label: "Fechada" },
    ]);
  });
});
