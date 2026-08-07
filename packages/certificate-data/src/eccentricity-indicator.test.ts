import { describe, expect, it } from "vitest";

import {
  ECCENTRICITY_INDICATOR_SPEC_KEY,
  renderEccentricityIndicatorSvgMarkup,
  type CertificateImageContext,
} from "./eccentricity-indicator.js";

/**
 * Smoke coverage for the eccentricity-indicator diagram. The module was carved
 * out of the deleted XLSX renderer by hand and shipped without tests there; a
 * bad cut would surface as a missing marker or an unparsable SVG rather than a
 * type error, so pin the observable behaviour: the opt-in gate, both variants,
 * and the fact that the selected position is actually marked.
 */

function contextWithIndicator(
  variant?: "circular_platform" | "road_scale",
): CertificateImageContext {
  return {
    dataFields: [
      {
        key: "eccentricity",
        eccentricityIndicator: { enabled: true, variant },
      },
    ],
  };
}

describe("renderEccentricityIndicatorSvgMarkup", () => {
  it("returns null when the method does not opt in", () => {
    expect(renderEccentricityIndicatorSvgMarkup(undefined, {})).toBeNull();
    expect(
      renderEccentricityIndicatorSvgMarkup(
        { dataFields: [{ key: "readings" }] },
        {},
      ),
    ).toBeNull();
  });

  it("opts in via an explicit graphics variant, with no data field", () => {
    const svg = renderEccentricityIndicatorSvgMarkup(undefined, {
      graphics: { eccentricityIndicatorVariant: "road_scale" },
    });
    expect(svg).not.toBeNull();
    expect(svg).toContain("<svg");
  });

  it("renders a well-formed circular-platform diagram by default", () => {
    const svg = renderEccentricityIndicatorSvgMarkup(
      contextWithIndicator(),
      {},
    );
    expect(svg).toBeTypeOf("string");
    expect(svg).toMatch(/^<svg[\s>]/);
    expect(svg?.trimEnd().endsWith("</svg>")).toBe(true);
    // the five circular load points are the labels an operator reads off
    for (const point of ["A", "B", "C", "D", "E"]) {
      expect(svg).toContain(`>${point}<`);
    }
  });

  it("renders the road-scale variant with its four numbered positions", () => {
    const svg = renderEccentricityIndicatorSvgMarkup(
      contextWithIndicator("road_scale"),
      {},
    );
    expect(svg).toMatch(/^<svg[\s>]/);
    for (const point of ["1", "2", "3", "4"]) {
      expect(svg).toContain(`>${point}<`);
    }
    // road scale must not borrow the circular platform's lettered points
    expect(svg).not.toContain(">E<");
  });

  it("marks the selected position, and a different one changes the markup", () => {
    const at = (position: string) =>
      renderEccentricityIndicatorSvgMarkup(
        {
          ...contextWithIndicator(),
          specifications: { [ECCENTRICITY_INDICATOR_SPEC_KEY]: position },
        },
        {},
      );
    const none = renderEccentricityIndicatorSvgMarkup(
      contextWithIndicator(),
      {},
    );

    expect(at("top")).not.toEqual(at("bottom"));
    expect(at("top")).not.toEqual(none);
  });

  it("resolves the position from the nested graphics path in the data record", () => {
    const viaGraphics = renderEccentricityIndicatorSvgMarkup(
      contextWithIndicator(),
      { graphics: { eccentricityIndicatorPosition: "left" } },
    );
    const viaContext = renderEccentricityIndicatorSvgMarkup(
      {
        ...contextWithIndicator(),
        specifications: { [ECCENTRICITY_INDICATOR_SPEC_KEY]: "left" },
      },
      {},
    );
    expect(viaGraphics).toEqual(viaContext);
  });

  it("ignores a position that is invalid for the variant", () => {
    // "3" is a road-scale position; on a circular platform it is not selectable
    const bogus = renderEccentricityIndicatorSvgMarkup(
      {
        ...contextWithIndicator(),
        specifications: { [ECCENTRICITY_INDICATOR_SPEC_KEY]: "3" },
      },
      {},
    );
    const none = renderEccentricityIndicatorSvgMarkup(
      contextWithIndicator(),
      {},
    );
    expect(bogus).toEqual(none);
  });
});
