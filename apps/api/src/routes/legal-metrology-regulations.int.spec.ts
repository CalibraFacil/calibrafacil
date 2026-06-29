import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@calibra-facil/db";
import {
  asset,
  assetType,
  legalMetrologyRegulation,
} from "@calibra-facil/db/schema";
import {
  LEGAL_METROLOGY_REGULATION_SEED,
  seedLegalMetrologyRegulations,
} from "@calibra-facil/db/seed-legal-metrology-regulations";

import { legalMetrologyRegulationsRouter } from "./legal-metrology-regulations";
import { loginAs, logout } from "../../test/integration/setup";
import { truncateAll } from "../../test/integration/db";
import { seedOrg, seedCustomer } from "../../test/integration/seed";

// Real-DB integration tests for the legal-metrology regulation catalog (deferred #3 of
// #423). Covers the GLOBAL seed (REQ-CATALOG-002), the read endpoint + auth gate
// (REQ-CATALOG-003), and the seed's data-only / idempotent guarantee (REQ-CATALOG-006).
//
// The catalog is GLOBAL reference data (no organizationId / unitId) — every authed lab
// reads the same rows. Only authentication is enforced (withPermission -> requireAuth);
// the GET path resolves the PORTAL auth first, which needs a realistic Host header to
// resolve a baseURL, then falls through to the mocked lab auth.
const JSON_HEADERS = {
  "content-type": "application/json",
  host: "dev-api.calibrafacil.com",
};

const SECONDARY_CATEGORIES = new Set(["Medidores de gás", "Hidrômetros"]);

describe("legal-metrology regulation catalog — real DB", () => {
  beforeEach(async () => {
    await truncateAll();
  });

  // REQ-CATALOG-002 ----------------------------------------------------------
  // [HIGH RISK — regulatory data] The seed populates the 9 grounded rows with the
  // verbatim Portaria references + the correct provenance (gás + hidrômetro secondary,
  // the rest primary). Asserted against the REAL persisted rows, not the seed constant.
  it("REQ-CATALOG-002: seeds the 9 grounded regulations with correct references + provenance", async () => {
    await seedLegalMetrologyRegulations();

    const rows = await db
      .select()
      .from(legalMetrologyRegulation)
      .orderBy(legalMetrologyRegulation.category);

    expect(rows).toHaveLength(9);

    const byCategory = new Map(rows.map((row) => [row.category, row]));

    // Verbatim references (a dropped/garbled Portaria string must fail here).
    expect(byCategory.get("Taxímetros")?.regulationReference).toBe(
      "Portaria Inmetro nº 124, de 24 de março de 2022",
    );
    expect(byCategory.get("Balanças (IPNA)")?.regulationReference).toBe(
      "Portaria Inmetro nº 157, de 30 de março de 2022",
    );
    expect(byCategory.get("Esfigmomanômetros")?.regulationReference).toBe(
      "Portaria Inmetro nº 341, de 9 de agosto de 2021",
    );
    expect(byCategory.get("Cronotacógrafos")?.regulationReference).toBe(
      "Portaria Inmetro nº 481, de 6 de dezembro de 2021",
    );
    expect(byCategory.get("Etilômetros")?.regulationReference).toBe(
      "Portaria Inmetro nº 369, de 8 de setembro de 2021",
    );
    expect(
      byCategory.get("Medidores de velocidade (radar)")?.regulationReference,
    ).toBe("Portaria Inmetro nº 158, de 31 de março de 2022");
    expect(byCategory.get("Medidores de gás")?.regulationReference).toBe(
      "Portaria Inmetro nº 156, de 30 de março de 2022",
    );
    expect(byCategory.get("Hidrômetros")?.regulationReference).toBe(
      "Portaria Inmetro nº 155, de 30 de março de 2022",
    );
    expect(
      byCategory.get("Medidores de energia elétrica")?.regulationReference,
    ).toBe(
      "Inmetro: aprovação de modelo + verificação inicial (ANEEL REN 414/2010 é regime distinto)",
    );

    // Provenance: exactly gás + hidrômetro are secondary; everything else primary.
    for (const row of rows) {
      const expected = SECONDARY_CATEGORIES.has(row.category)
        ? "secondary"
        : "primary";
      expect(row.provenance).toBe(expected);
    }
    const secondary = rows
      .filter((row) => row.provenance === "secondary")
      .map((row) => row.category)
      .toSorted();
    expect(secondary).toEqual(["Hidrômetros", "Medidores de gás"]);

    // Shape fidelity: gás per-technology map, hidrômetro install ceiling, energia N/A.
    const gas = byCategory.get("Medidores de gás");
    expect(gas?.kind).toBe("per_technology");
    expect(gas?.anchor).toBe("first_verification");
    expect(gas?.valueMonths).toBeNull();
    expect(gas?.byTechnology).toEqual({
      diafragma: 120,
      ultrassonico: 180,
      turbina: 60,
      rotativo: 60,
    });

    const hidrometro = byCategory.get("Hidrômetros");
    expect(hidrometro?.kind).toBe("max_months_from_install");
    expect(hidrometro?.valueMonths).toBe(84);
    expect(hidrometro?.anchor).toBe("install_year");

    const energia = byCategory.get("Medidores de energia elétrica");
    expect(energia?.kind).toBe("not_nationally_fixed");
    expect(energia?.valueMonths).toBeNull();
    expect(energia?.operationalizedByDelegate).toBe(false);

    // Every seed category landed exactly once.
    expect([...byCategory.keys()].toSorted()).toEqual(
      LEGAL_METROLOGY_REGULATION_SEED.map((row) => row.category).toSorted(),
    );
  });

  // REQ-CATALOG-006 ----------------------------------------------------------
  // [HIGH RISK] Idempotent on re-run, and DATA-ONLY: seeding the catalog must not touch
  // any asset row (regime / regulated_interval / dates unchanged), nor add/remove assets.
  it("REQ-CATALOG-006: is idempotent and modifies no asset row", async () => {
    const org = await seedOrg({ orgId: "org-seed", role: "admin" });
    const customerId = await seedCustomer({
      labOrganizationId: org.orgId,
      name: "Cliente Seed",
    });
    const [type] = await db
      .insert(assetType)
      .values({
        name: "Hidrômetro",
        slug: "hidrometro-seed",
        definition: [
          { key: "x", label: "X", type: "number", required: true },
        ],
      })
      .returning({ id: assetType.id });
    if (!type) throw new Error("assetType insert failed");

    const installedAt = new Date("2020-03-01T00:00:00.000Z");
    const [seededAsset] = await db
      .insert(asset)
      .values({
        unitId: org.unitId,
        customerId,
        assetTypeId: type.id,
        name: "Hidrômetro do cliente",
        serialNumber: "SN-CATALOG-1",
        tag: "TAG-CATALOG-1",
        metrologyRegime: "LEGAL",
        installedAt,
        regulatedInterval: {
          kind: "max_months_from_install",
          valueMonths: 60,
          anchor: "install_year",
          regulationReference: "Lab-typed reference (must not change)",
          operationalizedByDelegate: true,
        },
      })
      .returning();
    if (!seededAsset) throw new Error("asset insert failed");

    // First seed run.
    await seedLegalMetrologyRegulations();
    expect(
      await db.select().from(legalMetrologyRegulation),
    ).toHaveLength(9);

    // Second seed run — idempotent (still 9, ON CONFLICT DO NOTHING).
    await seedLegalMetrologyRegulations();
    expect(
      await db.select().from(legalMetrologyRegulation),
    ).toHaveLength(9);

    // The asset row is byte-for-byte unchanged, and there is still exactly one asset.
    const assetsAfter = await db.select().from(asset);
    expect(assetsAfter).toHaveLength(1);
    const after = assetsAfter[0];
    expect(after?.id).toBe(seededAsset.id);
    expect(after?.metrologyRegime).toBe("LEGAL");
    expect(after?.regulatedInterval).toEqual(seededAsset.regulatedInterval);
    expect(after?.installedAt?.getTime()).toBe(installedAt.getTime());
    expect(after?.updatedAt.getTime()).toBe(seededAsset.updatedAt.getTime());
  });

  // REQ-CATALOG-003 ----------------------------------------------------------
  it("REQ-CATALOG-003: an authenticated user gets the catalog rows", async () => {
    await seedLegalMetrologyRegulations();
    const org = await seedOrg({ orgId: "org-read", role: "member" });

    loginAs({ userId: org.userId, organizationId: org.orgId });
    const res = await legalMetrologyRegulationsRouter.request("/", {
      headers: { ...JSON_HEADERS, "x-active-unit-id": String(org.unitId) },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toHaveLength(9);
    const taximetro = body.data.find(
      (row: { category: string }) => row.category === "Taxímetros",
    );
    expect(taximetro.regulationReference).toBe(
      "Portaria Inmetro nº 124, de 24 de março de 2022",
    );
    expect(taximetro.provenance).toBe("primary");
  });

  it("REQ-CATALOG-003: an unauthenticated request is rejected with 401", async () => {
    await seedLegalMetrologyRegulations();

    logout();
    const res = await legalMetrologyRegulationsRouter.request("/", {
      headers: JSON_HEADERS,
    });

    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain("Portaria");
  });
});
