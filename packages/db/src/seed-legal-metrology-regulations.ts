/**
 * Seed for the legal-metrology regulation catalog (deferred #3 of issue #423).
 *
 * Populates `legal_metrology_regulation` with the primary-grounded Portaria → regulated-
 * interval-shape table (research 2026-06-29; see `.goals/legal-metrology-catalog-seed.md`).
 * There is no public Inmetro registry, so the rows are curated in-house WITH provenance:
 *   - `primary`   the period shape was confirmed against the official Inmetro RTM / DOU.
 *   - `secondary` corroborated, but the exact article still needs operator re-confirmation
 *                 before it backs a compliance certificate (gás per-technology + hidrômetro).
 *
 * Idempotent: ON CONFLICT DO NOTHING on `category` (the natural key), so re-running never
 * duplicates a row. DATA-ONLY — it touches no `asset` row (REQ-CATALOG-006).
 *
 * Usage: bun run src/seed-legal-metrology-regulations.ts   (or via seed-asset-types.ts).
 *
 * Spec: `specs/legal-metrology-catalog/spec.md` (REQ-CATALOG-001/002).
 */

import { db as defaultDb } from "./db";
import {
  legalMetrologyRegulation,
  type LegalMetrologyProvenance,
  type LegalMetrologyRegulationKind,
} from "./schema";

export type LegalMetrologyRegulationSeed = {
  category: string;
  kind: LegalMetrologyRegulationKind;
  valueMonths: number | null;
  byTechnology: Record<string, number> | null;
  anchor: string | null;
  operationalizedByDelegate: boolean;
  regulationReference: string;
  provenance: LegalMetrologyProvenance;
  note: string | null;
};

/**
 * The grounded catalog rows (verbatim Portaria references; provenance per the seed doc).
 * gás + hidrômetro are SECONDARY — they ship flagged so the UI shows the DOU caveat.
 */
export const LEGAL_METROLOGY_REGULATION_SEED: LegalMetrologyRegulationSeed[] = [
  {
    category: "Taxímetros",
    kind: "fixed_months",
    valueMonths: 24,
    byTechnology: null,
    anchor: "last_verification",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 124, de 24 de março de 2022",
    provenance: "primary",
    note: null,
  },
  {
    category: "Cronotacógrafos",
    kind: "fixed_months",
    valueMonths: 24,
    byTechnology: null,
    anchor: "last_verification",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 481, de 6 de dezembro de 2021",
    provenance: "primary",
    note: null,
  },
  {
    category: "Etilômetros",
    kind: "fixed_months",
    valueMonths: 12,
    byTechnology: null,
    anchor: "last_verification",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 369, de 8 de setembro de 2021",
    provenance: "primary",
    note: null,
  },
  {
    category: "Medidores de velocidade (radar)",
    kind: "fixed_months",
    valueMonths: 12,
    byTechnology: null,
    anchor: "last_verification",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 158, de 31 de março de 2022",
    provenance: "primary",
    note: null,
  },
  {
    category: "Balanças (IPNA)",
    kind: "fixed_months",
    valueMonths: 12,
    byTechnology: null,
    anchor: "calendar_year",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 157, de 30 de março de 2022",
    provenance: "primary",
    note: null,
  },
  {
    category: "Esfigmomanômetros",
    kind: "fixed_months",
    valueMonths: 12,
    byTechnology: null,
    anchor: "last_verification",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 341, de 9 de agosto de 2021",
    provenance: "primary",
    note: null,
  },
  {
    category: "Medidores de gás",
    kind: "per_technology",
    valueMonths: null,
    byTechnology: {
      diafragma: 120,
      ultrassonico: 180,
      turbina: 60,
      rotativo: 60,
    },
    anchor: "first_verification",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 156, de 30 de março de 2022",
    provenance: "secondary",
    note: null,
  },
  {
    category: "Hidrômetros",
    kind: "max_months_from_install",
    valueMonths: 84,
    byTechnology: null,
    anchor: "install_year",
    operationalizedByDelegate: true,
    regulationReference: "Portaria Inmetro nº 155, de 30 de março de 2022",
    provenance: "secondary",
    note: null,
  },
  {
    category: "Medidores de energia elétrica",
    kind: "not_nationally_fixed",
    valueMonths: null,
    byTechnology: null,
    anchor: null,
    operationalizedByDelegate: false,
    regulationReference:
      "Inmetro: aprovação de modelo + verificação inicial (ANEEL REN 414/2010 é regime distinto)",
    provenance: "primary",
    note: null,
  },
];

type SeedDb = Pick<typeof defaultDb, "insert">;

/**
 * Idempotently seed the catalog. Inserts the grounded rows, skipping any whose `category`
 * already exists (ON CONFLICT DO NOTHING). Never updates or deletes — so a re-run is a
 * no-op and no `asset` row is ever touched.
 */
export async function seedLegalMetrologyRegulations(
  database: SeedDb = defaultDb,
): Promise<void> {
  for (const row of LEGAL_METROLOGY_REGULATION_SEED) {
    await database
      .insert(legalMetrologyRegulation)
      .values(row)
      .onConflictDoNothing({ target: legalMetrologyRegulation.category });
  }
}

const invokedDirectly =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  process.argv[1].includes("seed-legal-metrology-regulations");

if (invokedDirectly) {
  seedLegalMetrologyRegulations()
    .then(() => {
      console.log(
        `Seeded ${LEGAL_METROLOGY_REGULATION_SEED.length} legal-metrology regulations.`,
      );
      process.exit(0);
    })
    .catch((error) => {
      console.error("Legal-metrology regulation seed failed:", error);
      process.exit(1);
    });
}
