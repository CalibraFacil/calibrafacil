import { describe, expect, it } from "vitest";

import { SIGNAL_TONES, STATUS_TONE } from "./status-tone";

const RAW_PALETTE =
  /(?:^|[\s:[])(?:text|bg|border|ring|fill|stroke|from|via|to|outline|divide|shadow|decoration|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}/;

describe("status-tone", () => {
  it("REQ-UI-1: every signal tone has every class slot", () => {
    for (const tone of SIGNAL_TONES) {
      for (const [slot, classes] of Object.entries(STATUS_TONE[tone])) {
        expect(classes, `${tone}.${slot}`).toMatch(/\S/);
      }
    }
    expect(Object.keys(STATUS_TONE).toSorted()).toEqual(
      [...SIGNAL_TONES].toSorted(),
    );
  });

  it("REQ-UI-1: the tone classes resolve to theme tokens, never a raw palette colour", () => {
    for (const tone of SIGNAL_TONES) {
      for (const [slot, classes] of Object.entries(STATUS_TONE[tone])) {
        expect(classes, `${tone}.${slot}`).not.toMatch(RAW_PALETTE);
      }
    }
  });

  it("REQ-UI-1: critical, info and neutral reuse the shadcn tokens", () => {
    expect(STATUS_TONE.critical.text).toBe("text-destructive");
    expect(STATUS_TONE.info.text).toBe("text-primary");
    expect(STATUS_TONE.neutral.text).toBe("text-muted-foreground");
  });
});
