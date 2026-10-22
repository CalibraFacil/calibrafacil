// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button", () => {
  it("REQ-UI-5: an icon-only button is announced by its aria-label", () => {
    render(<Button size="icon" aria-label="Fechar" />);

    expect(screen.getByRole("button", { name: "Fechar" })).toBeTruthy();
  });

  it("REQ-UI-5: every icon size requires an accessible name at the type level", () => {
    // These elements are never rendered; `@ts-expect-error` makes check-types
    // fail if the `aria-label` requirement is ever loosened.
    const unlabelled = () => (
      <>
        {/* @ts-expect-error icon buttons need an aria-label */}
        <Button size="icon" />
        {/* @ts-expect-error icon buttons need an aria-label */}
        <Button size="icon-xs" />
        {/* @ts-expect-error icon buttons need an aria-label */}
        <Button size="icon-sm" />
        {/* @ts-expect-error icon buttons need an aria-label */}
        <Button size="icon-lg" />
      </>
    );
    const labelled = () => (
      <>
        <Button size="icon-sm" aria-label="Editar" />
        <Button>Salvar</Button>
        <Button size="sm">Salvar</Button>
      </>
    );

    expect(typeof unlabelled).toBe("function");
    expect(typeof labelled).toBe("function");
  });

  it("REQ-UI-1: a text button keeps its default size classes", () => {
    render(<Button>Salvar</Button>);

    expect(screen.getByRole("button", { name: "Salvar" }).className).toContain(
      "h-9",
    );
  });
});
