// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SIGNAL_TONES, STATUS_TONE } from "../lib/status-tone";
import {
  BlueprintField,
  BlueprintGrid,
  Panel,
  PanelHeader,
  SignalTile,
} from "./instrument-panel";

describe("instrument-panel", () => {
  it("REQ-UI-1: Panel and PanelHeader render their title, description and action", () => {
    render(
      <Panel aria-label="Resumo">
        <PanelHeader
          title="Padrões"
          description="Vencem em 30 dias"
          action={<span>Ver todos</span>}
        />
      </Panel>,
    );

    expect(screen.getByRole("heading", { name: "Padrões" })).toBeTruthy();
    expect(screen.getByText("Vencem em 30 dias")).toBeTruthy();
    expect(screen.getByText("Ver todos")).toBeTruthy();
  });

  it("REQ-UI-1: SignalTile paints its value and tile with the tone's status classes", () => {
    for (const tone of SIGNAL_TONES) {
      const { container, unmount } = render(
        <SignalTile label="Vencidos" value="12" hint="no mês" tone={tone} />,
      );

      const value = screen.getByText("12");
      expect(value.className).toContain(STATUS_TONE[tone].value);
      expect(container.firstElementChild?.className).toContain(
        STATUS_TONE[tone].tile,
      );
      expect(screen.getByText("Vencidos")).toBeTruthy();
      expect(screen.getByText("no mês")).toBeTruthy();
      unmount();
    }
  });

  it("REQ-UI-1: BlueprintGrid lays out BlueprintField labels and values", () => {
    render(
      <BlueprintGrid>
        <BlueprintField label="Série" mono>
          SN-0042
        </BlueprintField>
        <BlueprintField label="Fabricante">Mitutoyo</BlueprintField>
      </BlueprintGrid>,
    );

    expect(screen.getByText("Série")).toBeTruthy();
    expect(screen.getByText("SN-0042").className).toContain("font-mono");
    expect(screen.getByText("Mitutoyo")).toBeTruthy();
  });
});
