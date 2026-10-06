import { db } from "@calibra-facil/db";
import { asset } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField } from "./api";
import { buildAssetPlan, type PlannedAsset } from "./asset-plan";
import type { CustomerIds } from "./customers";
import type { SeedContext, SeedRefs } from "./context";

export type SeededAsset = PlannedAsset & { id: number };

const INTERVAL_RATIONALES = [
  "Periodicidade definida pelo plano de metrologia do cliente, com base na criticidade do processo.",
  "Intervalo mantido conforme o histórico de estabilidade do instrumento nas últimas calibrações.",
  "Definido pelo procedimento interno de controle de equipamentos de medição.",
  "Periodicidade reduzida por uso intensivo na linha de produção.",
];

/**
 * Registers the instrument park through the real route, then records each
 * customer's chosen recalibration interval (the lab never authors it: the
 * route does not accept it, the portal sets it, so a plain column write
 * stands in for the customer here).
 */
export async function seedAssets(
  ctx: SeedContext,
  refs: SeedRefs,
  customerIds: CustomerIds,
): Promise<SeededAsset[]> {
  const rng = ctx.rng.fork("assets");
  const plan = buildAssetPlan(rng);
  const seeded: SeededAsset[] = [];
  let created = 0;

  for (const planned of plan) {
    const customerId = customerIds.get(planned.customerCode);
    const assetTypeId = refs.assetTypeIds.get(planned.typeSlug);
    if (!customerId || !assetTypeId) {
      throw new Error(`Unresolved customer/type for ${planned.tag}`);
    }

    const [existing] = await db
      .select({ id: asset.id })
      .from(asset)
      .where(
        and(eq(asset.labOrganizationId, LAB_ID), eq(asset.tag, planned.tag)),
      )
      .limit(1);
    if (existing) {
      seeded.push({ ...planned, id: existing.id });
      continue;
    }

    const body = await ctx.api.call("owner", "POST", "/api/assets", {
      customerId,
      assetTypeId,
      name: planned.name,
      manufacturer: planned.manufacturer,
      model: planned.model,
      serialNumber: planned.serialNumber,
      tag: planned.tag,
      status: planned.status,
      baseMeasurementUnit: planned.baseMeasurementUnit,
      specifications: planned.specifications,
    });
    const id = numberField(body, "id");
    await db
      .update(asset)
      .set({
        calibrationIntervalMonths: planned.intervalMonths,
        intervalSetBy: "customer_confirmed",
        intervalSetAt: new Date(
          ctx.now.getTime() - rng.int(20, 400) * 86_400_000,
        ),
        intervalRationale: rng.pick(INTERVAL_RATIONALES),
      })
      .where(eq(asset.id, id));
    seeded.push({ ...planned, id });
    created += 1;
  }
  ctx.log(
    `  assets: ${created} created, ${seeded.length - created} already there`,
  );
  return seeded;
}
