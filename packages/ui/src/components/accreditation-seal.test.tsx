// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccreditationSeal } from "./accreditation-seal";

describe("AccreditationSeal", () => {
  it("REQ-UI-2: renders the canonical seal artwork with the sheen layer inside the hover wrapper", () => {
    const { container } = render(
      <AccreditationSeal accreditationNumber="0123" />,
    );

    const seal = screen.getByRole("img", { name: /CAL 0123/ });
    expect(seal.closest(".accreditation-seal")).not.toBeNull();
    expect(container.querySelector(".seal-sheen")).not.toBeNull();
    expect(seal.getAttribute("width")).toBe("92");
  });

  it("REQ-UI-2: takes the width the caller asks for", () => {
    render(<AccreditationSeal accreditationNumber={null} width={120} />);

    expect(screen.getByRole("img").getAttribute("width")).toBe("120");
  });
});
