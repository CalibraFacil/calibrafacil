import { describe, expect, it } from "vitest";

import type { RegulatedInterval } from "@calibra-facil/schemas";

import {
  resolveAssetRegimeWrite,
  type AssetRegimeWriteInput,
} from "./asset-regime.js";

const fixed24: RegulatedInterval = {
  kind: "fixed_months",
  valueMonths: 24,
  anchor: "last_verification",
  regulationReference: "Portaria Inmetro nº 124/2022",
  operationalizedByDelegate: false,
};

const industrialNow = {
  metrologyRegime: "INDUSTRIAL" as const,
  regulatedInterval: null,
};

/** Base write with nothing supplied — override per case. */
function write(partial: Partial<AssetRegimeWriteInput>): AssetRegimeWriteInput {
  return {
    metrologyRegime: undefined,
    regulatedInterval: undefined,
    current: industrialNow,
    ...partial,
  };
}

describe("resolveAssetRegimeWrite", () => {
  // REQ-MLR-030: LEGAL + a regulated interval → regime LEGAL, interval stored.
  it("stores the regulated interval for a LEGAL write", () => {
    const r = resolveAssetRegimeWrite(
      write({ metrologyRegime: "LEGAL", regulatedInterval: fixed24 }),
    );
    expect(r.metrologyRegime).toBe("LEGAL");
    expect(r.regulatedInterval).toEqual(fixed24);
  });

  // REQ-MLR-031: a non-LEGAL regime clears the regulated interval — even if the client
  // mistakenly supplies one.
  it("clears the regulated interval for INDUSTRIAL / UNKNOWN", () => {
    for (const regime of ["INDUSTRIAL", "UNKNOWN"] as const) {
      const r = resolveAssetRegimeWrite(
        write({
          metrologyRegime: regime,
          regulatedInterval: fixed24,
          current: { metrologyRegime: "LEGAL", regulatedInterval: fixed24 },
        }),
      );
      expect(r.metrologyRegime).toBe(regime);
      expect(r.regulatedInterval).toBeNull();
    }
  });

  // Keeps the current regime when no explicit regime is supplied.
  it("keeps the current regime when nothing regime-related is supplied", () => {
    const r = resolveAssetRegimeWrite(
      write({
        current: { metrologyRegime: "LEGAL", regulatedInterval: fixed24 },
      }),
    );
    expect(r.metrologyRegime).toBe("LEGAL");
    expect(r.regulatedInterval).toEqual(fixed24);
  });

  // LEGAL + regulatedInterval undefined → keep current; null → clear.
  it("keeps the current interval on undefined and clears it on null (still LEGAL)", () => {
    const keep = resolveAssetRegimeWrite(
      write({
        metrologyRegime: "LEGAL",
        current: { metrologyRegime: "LEGAL", regulatedInterval: fixed24 },
      }),
    );
    expect(keep.regulatedInterval).toEqual(fixed24);

    const cleared = resolveAssetRegimeWrite(
      write({
        metrologyRegime: "LEGAL",
        regulatedInterval: null,
        current: { metrologyRegime: "LEGAL", regulatedInterval: fixed24 },
      }),
    );
    expect(cleared.regulatedInterval).toBeNull();
  });
});
