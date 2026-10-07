/**
 * Demo data for the demo laboratory (`demo-lab`), so a fresh install opens on a
 * lived-in lab instead of an empty one:
 *
 *   pnpm --dir apps/api seed:demo [--quick] [--all-certificates] [--allow-remote]   (run by `pnpm setup:dev`)
 *
 * It drives the real API routes in-process (see ./seed-demo/api.ts), so
 * customers, instruments, methods, calibrations and certificates carry the same
 * validation, numbering, snapshots and audit trail as the app produces; the
 * worker's own code renders the certificates. Dates are relative to "now" and
 * every random draw comes from a seeded PRNG, so a fresh run always builds the
 * same laboratory.
 *
 * Run it after `init` and `packages/db/scripts/seed-dev-lab.ts`, which create the
 * lab, its unit and the three demo users. A finished seed is recorded on the
 * organization and skipped next time; one that stopped half-way resumes (every
 * step recognises what it already created). `--quick` builds a smaller history
 * (about 30 approved calibrations instead of 112). Certificates are rendered
 * for the 40 newest approvals (each is a Chromium render); `--all-certificates`
 * renders them all. Refuses to run against anything but a local database (pass
 * --allow-remote to override).
 */
import { db } from "@calibra-facil/db";
import { assetType, organization } from "@calibra-facil/db/schema";
import { seedAssetTypes } from "@calibra-facil/db/seed-asset-types";
import { eq } from "drizzle-orm";

import { createSeedApi, LAB_ID } from "./seed-demo/api";
import { ageFoundations, seedAssetCalibrationDates } from "./seed-demo/aging";
import { seedAssets } from "./seed-demo/assets";
import { seedCompetences } from "./seed-demo/competences";
import type { SeedContext, SeedRefs } from "./seed-demo/context";
import { seedCustomers } from "./seed-demo/customers";
import { renderServiceOrderDocuments } from "./seed-demo/documents";
import { seedJobs, tidyNotifications } from "./seed-demo/jobs";
import { seedLabProfile } from "./seed-demo/lab-profile";
import { seedMethods } from "./seed-demo/methods";
import { createRng } from "./seed-demo/prng";
import { seedQuality } from "./seed-demo/quality";
import { seedRequests } from "./seed-demo/requests";
import { seedServiceOrders } from "./seed-demo/service-orders";
import { seedServices } from "./seed-demo/services";
import { seedStandards } from "./seed-demo/standards";

const SEED_VERSION = 1;

function assertLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  const { hostname } = new URL(databaseUrl);
  const isLocal = ["localhost", "127.0.0.1", "::1", "postgres"].includes(
    hostname,
  );
  if (!isLocal && !process.argv.includes("--allow-remote")) {
    throw new Error(
      `Refusing to seed demo data into ${hostname}. This seed is for local development only (pass --allow-remote to override).`,
    );
  }
}

/**
 * Two warnings are expected while seeding and would only alarm someone reading
 * the setup output: e-mail is switched off on purpose (see `main`), and the demo
 * laboratory has no signing certificate, so every certificate is issued
 * unsigned. They are counted instead of printed; anything else goes through.
 */
function muteExpectedWarnings(): { unsignedCertificates: () => number } {
  let unsigned = 0;
  const { warn, error } = console;
  console.warn = (...args: unknown[]) => {
    const [first] = args;
    if (
      typeof first === "string" &&
      /^\[JOB \d+\] No signing certificate/.test(first)
    ) {
      unsigned += 1;
      return;
    }
    warn(...args);
  };
  console.error = (...args: unknown[]) => {
    const [first] = args;
    if (typeof first === "string" && first.includes("EMAIL MISCONFIGURED")) {
      return;
    }
    error(...args);
  };
  return { unsignedCertificates: () => unsigned };
}

function isSeeded(metadata: string | null): boolean {
  if (!metadata) return false;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (typeof parsed !== "object" || parsed === null) return false;
    const seed: unknown = Reflect.get(parsed, "demoSeed");
    return (
      typeof seed === "object" &&
      seed !== null &&
      Reflect.get(seed, "version") === SEED_VERSION
    );
  } catch {
    return false;
  }
}

async function main() {
  const startedAt = Date.now();
  assertLocalDatabase();

  const [lab] = await db
    .select({ id: organization.id, metadata: organization.metadata })
    .from(organization)
    .where(eq(organization.id, LAB_ID))
    .limit(1);
  if (!lab) {
    throw new Error(
      `Laboratory "${LAB_ID}" not found: run packages/db/scripts/seed-dev-lab.ts first (pnpm setup:dev does).`,
    );
  }
  if (isSeeded(lab.metadata)) {
    console.log("Demo data is already in place: nothing to do.");
    return;
  }

  // Approvals must only enqueue the certificate render: the seed backdates the
  // job first and then runs the worker's own code, so the PDF carries the
  // planned dates. (The app re-reads this on every request, so set it before the
  // app is created.) No e-mail goes out either: the demo users have no
  // mailboxes, and a configured Mailpit would fill up with notices about a
  // made-up history.
  process.env.BACKGROUND_JOBS_MODE = "queue";
  for (const key of ["SMTP_HOST", "RESEND_API_KEY"]) delete process.env[key];
  const warnings = muteExpectedWarnings();

  const quick = process.argv.includes("--quick");
  const api = await createSeedApi();
  const ctx: SeedContext = {
    api,
    rng: createRng("calibra-facil-demo-v1"),
    now: new Date(),
    log: (message) => console.log(message),
  };

  try {
    console.log(`Seeding the demo laboratory${quick ? " (quick)" : ""}`);
    await seedAssetTypes();
    const types = await db
      .select({ id: assetType.id, slug: assetType.slug })
      .from(assetType);
    const refs: SeedRefs = {
      unitId: 1,
      assetTypeIds: new Map(types.map((row) => [row.slug, row.id])),
    };

    console.log("Laboratory, methods and catalog");
    await seedLabProfile();
    const methodIds = await seedMethods(ctx, refs);
    const serviceIds = await seedServices(ctx, refs, methodIds);
    const standardIds = await seedStandards(ctx);

    console.log("Customers, instruments and people");
    const customerIds = await seedCustomers(ctx);
    const assets = await seedAssets(ctx, refs, customerIds);
    await seedCompetences(ctx, refs);

    console.log("Calibrations and certificates");
    const jobs = await seedJobs(ctx, assets, serviceIds, standardIds, {
      quick,
      concurrency: 5,
      certificates: process.argv.includes("--all-certificates") ? "all" : 40,
    });
    const unsigned = warnings.unsignedCertificates();
    if (unsigned > 0) {
      ctx.log(
        `  certificates: ${unsigned} issued unsigned (the demo laboratory has no signing certificate)`,
      );
    }

    console.log("Quality records");
    await seedQuality(ctx, jobs);
    await tidyNotifications(jobs);

    console.log("Service orders, requests and visits");
    await seedServiceOrders(ctx, assets, customerIds);
    await seedRequests(ctx, assets, customerIds, serviceIds);
    await renderServiceOrderDocuments(ctx);

    console.log("Finishing touches");
    await seedAssetCalibrationDates(ctx, assets);
    await ageFoundations(ctx);

    await db
      .update(organization)
      .set({
        metadata: JSON.stringify({
          demoSeed: {
            version: SEED_VERSION,
            completedAt: new Date().toISOString(),
          },
        }),
      })
      .where(eq(organization.id, LAB_ID));
  } finally {
    await api.close();
  }
  console.log(
    `Demo laboratory ready in ${Math.round((Date.now() - startedAt) / 1000)}s. Sign in as admin@laboratorio.test.`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("Demo seed failed:", error);
    process.exit(1);
  });
