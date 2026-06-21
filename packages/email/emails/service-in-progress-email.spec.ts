/**
 * REQ-SOEMAIL-042 (template rendering) — "Serviço em Andamento".
 *
 * Renders the REAL ServiceInProgressEmail template to HTML and asserts the
 * required fields actually appear in the output for BOTH stages:
 *  - awaiting_calibration
 *  - calibration_in_progress
 *
 * Non-tautology guard: drop the `stageLabel` render from the template →
 * the "Aguardando calibração" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { ServiceInProgressEmail } from "./service-in-progress-email";

describe(
  "REQ-SOEMAIL-042: ServiceInProgressEmail template renders required fields",
  () => {
    it(
      "REQ-SOEMAIL-042: awaiting_calibration — includes OS number and stage label",
      async () => {
        const html = await render(
          ServiceInProgressEmail({
            brand: { name: "Lab Delta", isWhiteLabel: true },
            serviceOrderNumber: "OS-2026-601",
            customerName: "Cliente Calibracao Ltda",
            stage: "awaiting_calibration",
          }),
        );
        expect(html).toContain("OS-2026-601");
        expect(html).toContain("Aguardando calibração");
        expect(html).toContain("Cliente Calibracao Ltda");
      },
    );

    it(
      "REQ-SOEMAIL-042: calibration_in_progress — includes OS number and stage label",
      async () => {
        const html = await render(
          ServiceInProgressEmail({
            brand: { name: "Lab Delta", isWhiteLabel: true },
            serviceOrderNumber: "OS-2026-602",
            customerName: "Cliente Calibracao Ltda",
            stage: "calibration_in_progress",
          }),
        );
        expect(html).toContain("OS-2026-602");
        expect(html).toContain("Calibração em andamento");
        expect(html).toContain("Cliente Calibracao Ltda");
      },
    );

    it(
      "REQ-SOEMAIL-042: awaiting_calibration — includes stage-specific message phrase",
      async () => {
        const html = await render(
          ServiceInProgressEmail({
            brand: { name: "Lab Delta", isWhiteLabel: true },
            serviceOrderNumber: "OS-2026-603",
            customerName: "Cliente",
            stage: "awaiting_calibration",
          }),
        );
        // Phase-specific phrase that distinguishes awaiting_calibration
        expect(html).toContain("aguarda o processo de calibração");
      },
    );

    it(
      "REQ-SOEMAIL-042: calibration_in_progress — includes stage-specific message phrase",
      async () => {
        const html = await render(
          ServiceInProgressEmail({
            brand: { name: "Lab Delta", isWhiteLabel: true },
            serviceOrderNumber: "OS-2026-604",
            customerName: "Cliente",
            stage: "calibration_in_progress",
          }),
        );
        // Phase-specific phrase that distinguishes calibration_in_progress
        expect(html).toContain("processo de calibração");
      },
    );
  },
);
