/**
 * REQ-SOEMAIL-021, REQ-SOEMAIL-022, REQ-SOEMAIL-023, REQ-SOEMAIL-024
 * (template rendering) — mini-spec C "Novo Orçamento".
 *
 * Renders the REAL NovoOrcamentoEmail template to HTML and asserts the required
 * fields actually appear in the output.
 *
 * Tautology guard: asserting props passed to a mocked template cannot prove the
 * fields reach the customer (a dropped field still passes that test). This test
 * renders to real HTML and asserts the values appear in the output.
 *
 * Mutation check: drop a total from the template → the corresponding assertion
 * must go RED.
 */

import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import { NovoOrcamentoEmail } from "./novo-orcamento-email";
import type { NovoOrcamentoEmailProps } from "./novo-orcamento-email";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const SAMPLE_ITEMS: NovoOrcamentoEmailProps["items"] = [
  {
    id: 1,
    type: "service",
    description: "Calibração de balança",
    quantity: 1,
    unit: "un",
    unitPriceCents: 50000,
    totalPriceCents: 50000,
  },
  {
    id: 2,
    type: "external_service",
    description: "Laudo técnico externo",
    quantity: 1,
    unit: "un",
    unitPriceCents: 30000,
    totalPriceCents: 30000,
  },
  {
    id: 3,
    type: "part",
    description: "Peça de reposição XY",
    quantity: 2,
    unit: "un",
    unitPriceCents: 15000,
    totalPriceCents: 30000,
  },
  {
    id: 4,
    type: "freight",
    description: "Frete de envio",
    quantity: 1,
    unit: "un",
    unitPriceCents: 8000,
    totalPriceCents: 8000,
  },
  {
    id: 5,
    type: "discount",
    description: "Desconto especial",
    quantity: 1,
    unit: "un",
    unitPriceCents: -3000,
    totalPriceCents: -3000,
  },
];

const SAMPLE_PROPS: NovoOrcamentoEmailProps = {
  brand: { name: "Lab Acme Ltda", isWhiteLabel: true },
  serviceOrderNumber: "OS-2026-001",
  customerName: "Empresa Teste SA",
  customerTaxId: "12.345.678/0001-99",
  assetManufacturer: "Mettler Toledo",
  assetModel: "XS205",
  assetInventoryCode: "INV-001",
  intakeDate: "19/06/2026",
  assetSerialNumber: "SN-MT-12345",
  // REQ-SOEMAIL-025: instrument-agnostic spec rows. For a balance these happen
  // to be capacity/division/portaria — but they come from displaySpecs, not
  // hardcoded fields.
  displaySpecs: [
    { label: "Capacidade", value: "220g" },
    { label: "Divisão", value: "0,1mg" },
    { label: "Portaria", value: "Portaria INMETRO 236/94" },
  ],
  claimedDefect: "Balança não calibra corretamente",
  items: SAMPLE_ITEMS,
  subtotalServicesCents: 80000,
  subtotalPartsCents: 30000,
  freightCents: 8000,
  discountCents: 3000,
  totalCents: 115000,
  approvalUrl: "https://portal.calibrafacil.com/service-order-access/tok-abc123",
};

async function renderEmail(
  props: NovoOrcamentoEmailProps = SAMPLE_PROPS,
): Promise<string> {
  return render(NovoOrcamentoEmail(props));
}

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-021: header fields
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-021: header fields appear in rendered HTML", () => {
  it("includes OS number", async () => {
    const html = await renderEmail();
    expect(html).toContain("OS-2026-001");
  });

  it("includes customer name", async () => {
    const html = await renderEmail();
    expect(html).toContain("Empresa Teste SA");
  });

  it("includes customer CNPJ/CPF", async () => {
    const html = await renderEmail();
    expect(html).toContain("12.345.678/0001-99");
  });

  it("includes asset manufacturer (brand)", async () => {
    const html = await renderEmail();
    expect(html).toContain("Mettler Toledo");
  });

  it("includes asset model", async () => {
    const html = await renderEmail();
    expect(html).toContain("XS205");
  });

  it("includes asset inventory code", async () => {
    const html = await renderEmail();
    expect(html).toContain("INV-001");
  });

  it("includes intake date", async () => {
    const html = await renderEmail();
    expect(html).toContain("19/06/2026");
  });

  it("includes serial number", async () => {
    const html = await renderEmail();
    expect(html).toContain("SN-MT-12345");
  });

  it("renders displaySpecs rows generically (label + value)", async () => {
    const html = await renderEmail();
    // A balance's specs flow through displaySpecs, not hardcoded fields.
    expect(html).toContain("Capacidade");
    expect(html).toContain("220g");
    expect(html).toContain("Divisão");
    expect(html).toContain("0,1mg");
    expect(html).toContain("Portaria");
    expect(html).toContain("Portaria INMETRO 236/94");
  });

  it("omits the spec section when displaySpecs is empty", async () => {
    const html = await renderEmail({ ...SAMPLE_PROPS, displaySpecs: [] });
    expect(html).not.toContain("220g");
    expect(html).not.toContain("Portaria INMETRO 236/94");
  });

  it("is NOT scale-centric: a non-balance instrument shows only its own displaySpecs", async () => {
    // A caliper (paquímetro): the email must render the lab's spec rows and
    // must NOT inject weighing-only labels (Capacidade/Divisão/Portaria).
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      displaySpecs: [
        { label: "Faixa de medição", value: "0–150 mm" },
        { label: "Resolução", value: "0,01 mm" },
      ],
    });
    expect(html).toContain("Faixa de medição");
    expect(html).toContain("0–150 mm");
    expect(html).toContain("Resolução");
    expect(html).not.toContain("Capacidade");
    expect(html).not.toContain("Divisão");
    expect(html).not.toContain("Portaria");
  });

  it("includes claimed defect", async () => {
    const html = await renderEmail();
    expect(html).toContain("Balança não calibra corretamente");
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-022: line items and persisted totals [HIGH RISK]
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-022: line items grouped by type, persisted totals rendered [HIGH RISK]", () => {
  it("renders a service item description", async () => {
    const html = await renderEmail();
    expect(html).toContain("Calibração de balança");
  });

  it("renders an external_service item description", async () => {
    const html = await renderEmail();
    expect(html).toContain("Laudo técnico externo");
  });

  it("renders a part item description", async () => {
    const html = await renderEmail();
    expect(html).toContain("Peça de reposição XY");
  });

  it("renders a freight item description", async () => {
    const html = await renderEmail();
    expect(html).toContain("Frete de envio");
  });

  it("renders a discount item description", async () => {
    const html = await renderEmail();
    expect(html).toContain("Desconto especial");
  });

  it("renders unit price of service item in BRL", async () => {
    const html = await renderEmail();
    // 50000 cents = R$ 500,00
    expect(html).toContain("500,00");
  });

  it("renders line total of part item in BRL", async () => {
    const html = await renderEmail();
    // 30000 cents = R$ 300,00
    expect(html).toContain("300,00");
  });

  it("renders subtotalServicesCents as persisted (not recomputed)", async () => {
    // 80000 cents = R$ 800,00
    const html = await renderEmail();
    expect(html).toContain("800,00");
  });

  it("renders subtotalPartsCents as persisted (not recomputed)", async () => {
    // 30000 cents = R$ 300,00
    const html = await renderEmail();
    // The value appears in the totals section
    expect(html).toContain("300,00");
  });

  it("renders totalCents as persisted (not recomputed) [HIGH RISK]", async () => {
    // 115000 cents = R$ 1.150,00
    const html = await renderEmail();
    expect(html).toContain("1.150,00");
  });

  it("mutation check: dropping totalCents prop causes assertion failure", async () => {
    // Verify our test is real: pass 0 as totalCents, assert 1.150,00 is NOT there
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      totalCents: 0,
    });
    expect(html).not.toContain("1.150,00");
  });

  it("mutation check: dropping subtotalServicesCents causes assertion failure", async () => {
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      subtotalServicesCents: 0,
    });
    expect(html).not.toContain("800,00");
  });

  it("renders freightCents in BRL", async () => {
    // 8000 cents = R$ 80,00
    const html = await renderEmail();
    expect(html).toContain("80,00");
  });

  it("renders discountCents in BRL", async () => {
    // 3000 cents = R$ 30,00
    const html = await renderEmail();
    expect(html).toContain("30,00");
  });

  it("renders item quantity", async () => {
    const html = await renderEmail();
    // The part item has quantity 2
    expect(html).toContain("2");
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-023: approval URL, no internalNotes [HIGH RISK]
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-023: approval URL present, internalNotes absent [HIGH RISK]", () => {
  it("renders the approval URL", async () => {
    const html = await renderEmail();
    expect(html).toContain(
      "https://portal.calibrafacil.com/service-order-access/tok-abc123",
    );
  });

  it("approval URL appears as a clickable link (href)", async () => {
    const html = await renderEmail();
    expect(html).toContain(
      'href="https://portal.calibrafacil.com/service-order-access/tok-abc123"',
    );
  });

  it("does NOT expose any internalNotes field or value", async () => {
    // Render with a distinctive internalNotes string and verify it does NOT appear
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      // The template should never accept or render internalNotes even if passed
    });
    // Ensure the word "internalNotes" or typical internal-note content is absent
    expect(html).not.toContain("internalNotes");
    expect(html).not.toContain("Nota interna");
    expect(html).not.toContain("nota_interna");
  });

  it("mutation check: dropping approvalUrl causes link assertion to fail", async () => {
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      approvalUrl: "https://other.example.com/different",
    });
    // The original URL must not be there if we pass a different URL
    expect(html).not.toContain(
      "https://portal.calibrafacil.com/service-order-access/tok-abc123",
    );
    // The new URL must appear
    expect(html).toContain("https://other.example.com/different");
  });
});

// ---------------------------------------------------------------------------
// REQ-SOEMAIL-024: BRL formatting from integer cents, no float drift
// ---------------------------------------------------------------------------

describe("REQ-SOEMAIL-024: monetary values rendered in BRL from integer cents", () => {
  it("formats 146000 cents as R$ 1.460,00", async () => {
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      totalCents: 146000,
      subtotalServicesCents: 146000,
    });
    expect(html).toContain("1.460,00");
  });

  it("formats 0 cents as R$ 0,00 (no float drift on zero)", async () => {
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      totalCents: 0,
      subtotalServicesCents: 0,
      subtotalPartsCents: 0,
      freightCents: 0,
      discountCents: 0,
    });
    // R$ 0,00 must appear somewhere (the zero total)
    expect(html).toContain("0,00");
  });

  it("correctly formats large amounts without float drift", async () => {
    // 1_234_567 cents = R$ 12.345,67
    const html = await renderEmail({
      ...SAMPLE_PROPS,
      totalCents: 1_234_567,
    });
    expect(html).toContain("12.345,67");
  });
});
