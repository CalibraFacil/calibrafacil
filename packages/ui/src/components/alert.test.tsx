// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { STATUS_TONE } from "../lib/status-tone";
import { Alert, AlertDescription, AlertTitle } from "./alert";

describe("Alert", () => {
  it("REQ-UI-1: the tonal variants use the shared status-tone alert classes", () => {
    const cases = [
      ["info", STATUS_TONE.info.alert],
      ["success", STATUS_TONE.ok.alert],
      ["warning", STATUS_TONE.warning.alert],
    ] as const;

    for (const [variant, classes] of cases) {
      const { unmount } = render(
        <Alert variant={variant}>
          <AlertTitle>Título</AlertTitle>
          <AlertDescription>Descrição</AlertDescription>
        </Alert>,
      );

      const alert = screen.getByRole("alert");
      for (const token of classes.split(" ")) {
        expect(alert.className).toContain(token);
      }
      expect(screen.getByText("Título")).toBeTruthy();
      expect(screen.getByText("Descrição")).toBeTruthy();
      unmount();
    }
  });

  it("REQ-UI-1: keeps the destructive variant the lab app already used", () => {
    render(<Alert variant="destructive">Falhou</Alert>);

    expect(screen.getByRole("alert").className).toContain("text-destructive");
  });
});
