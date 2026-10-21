import { jsx, jsxs } from "react/jsx-runtime";
import { describe, expect, it } from "vitest";
import runtime, { Fragment, jsxDEV } from "./jsx-dev-runtime";

describe("jsx-dev-runtime stand-in (email build, NODE_ENV=production)", () => {
  it("REQ-CI-BUILD-001 jsxDEV is a function even where React's production jsxDEV is undefined", () => {
    expect(typeof jsxDEV).toBe("function");
    expect(typeof runtime.jsxDEV).toBe("function");
    expect(runtime.Fragment).toBe(Fragment);
  });

  it("REQ-CI-BUILD-001 produces the same element as the production transform (output unchanged)", () => {
    const props = { className: "x", children: "hello" };

    expect(jsxDEV("p", props, "k", false)).toEqual(jsx("p", props, "k"));
    expect(
      jsxDEV(
        "ul",
        { children: [jsx("li", {}, "a"), jsx("li", {}, "b")] },
        undefined,
        true,
      ),
    ).toEqual(
      jsxs(
        "ul",
        { children: [jsx("li", {}, "a"), jsx("li", {}, "b")] },
        undefined,
      ),
    );
  });
});
