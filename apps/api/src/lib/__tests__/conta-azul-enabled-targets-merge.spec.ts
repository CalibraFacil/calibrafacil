import { describe, expect, it } from "vitest";
import { normalizeContaAzulConnectionConfig } from "@calibra-facil/shared";

// Regression for a UX/data bug previously observed: flipping a single domain
// toggle appeared to reset every other domain to inactive. Locks in the
// spread-merge contract that the PUT /:id/conta-azul/config route relies on.
//
// The route handler reads the current normalized config, spreads it into a new
// object alongside the partial input, then re-normalizes. If anyone replaces
// that sequence with a direct hand-off of `input.enabledTargets` to
// normalizeContaAzulConnectionConfig, normalize defaults take over and every
// untouched domain falls back to its hard-coded default.
describe("Conta Azul partial enabledTargets merge", () => {
  it("preserves other enabledTargets when toggling one domain off", () => {
    const initial = normalizeContaAzulConnectionConfig({
      enabledTargets: {
        customers: true,
        suppliers: true,
        transporters: true,
        services: true,
        billingDocuments: true,
        payables: true,
      },
    });

    const partial = { suppliers: false };
    const next = normalizeContaAzulConnectionConfig({
      ...initial,
      enabledTargets: { ...initial.enabledTargets, ...partial },
    });

    expect(next.enabledTargets).toMatchObject({
      customers: true,
      suppliers: false,
      transporters: true,
      services: true,
      billingDocuments: true,
      payables: true,
    });
  });

  it("preserves other enabledTargets when toggling one domain on", () => {
    const initial = normalizeContaAzulConnectionConfig({
      enabledTargets: {
        customers: true,
        suppliers: false,
        transporters: false,
        billingDocuments: true,
        payables: true,
      },
    });

    const next = normalizeContaAzulConnectionConfig({
      ...initial,
      enabledTargets: {
        ...initial.enabledTargets,
        transporters: true,
      },
    });

    expect(next.enabledTargets).toMatchObject({
      customers: true,
      suppliers: false,
      transporters: true,
      billingDocuments: true,
      payables: true,
    });
  });

  it("keeps the existing config when no enabledTargets partial is provided", () => {
    const initial = normalizeContaAzulConnectionConfig({
      enabledTargets: { customers: true, suppliers: true, payables: true },
    });

    const next = normalizeContaAzulConnectionConfig({
      ...initial,
      // omit enabledTargets — mirrors a request that only changes other fields
    });

    expect(next.enabledTargets).toMatchObject({
      customers: true,
      suppliers: true,
      payables: true,
    });
  });
});
