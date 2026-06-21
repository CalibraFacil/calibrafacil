/**
 * REQ-SOEMAIL-054 (template rendering) — "Em Revisão Final".
 *
 * Renders the REAL FinalReviewEmail template to HTML and asserts the
 * required fields actually appear in the output.
 *
 * Non-tautology guard: these tests go RED if the OS number or status phrase
 * is dropped from the template. Mutation: remove serviceOrderNumber from the
 * template body → "OS-2026-703" assertion goes RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { FinalReviewEmail } from "./final-review-email";

describe(
  "REQ-SOEMAIL-054: FinalReviewEmail template renders required fields",
  () => {
    async function renderRevisaoFinal(): Promise<string> {
      return render(
        FinalReviewEmail({
          brand: { name: "Lab Omega", isWhiteLabel: true },
          serviceOrderNumber: "OS-2026-703",
          customerName: "Empresa Revisao SA",
        }),
      );
    }

    it("REQ-SOEMAIL-054: includes the OS number", async () => {
      const html = await renderRevisaoFinal();
      expect(html).toContain("OS-2026-703");
    });

    it(
      "REQ-SOEMAIL-054: includes a status-specific phrase indicating final review",
      async () => {
        const html = await renderRevisaoFinal();
        // Status-specific phrase that must appear
        expect(html).toContain("revisão final");
      },
    );

    it("REQ-SOEMAIL-054: includes the customer name", async () => {
      const html = await renderRevisaoFinal();
      expect(html).toContain("Empresa Revisao SA");
    });

    it("REQ-SOEMAIL-054: includes the lab name from the brand", async () => {
      const html = await renderRevisaoFinal();
      expect(html).toContain("Lab Omega");
    });
  },
);
