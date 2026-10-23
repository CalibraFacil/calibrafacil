import { db } from "@calibra-facil/db";
import { assetType } from "@calibra-facil/db/schema";
import { eq, ilike, or } from "drizzle-orm";

/**
 * Reads of the GLOBAL asset-type catalog (routes/asset-types.ts). `asset_type`
 * has no organization column and no row-level-security policy (tenancy.ts), so
 * these statements are not bound to a laboratory: any connection role may read
 * the catalog, which is why they stay on the plain `db` handle, in a lib.
 */
export async function listAssetTypes(query: string | undefined) {
  const whereCondition = query
    ? or(
        ilike(assetType.name, `%${query}%`),
        ilike(assetType.slug, `%${query}%`),
        ilike(assetType.description, `%${query}%`),
      )
    : undefined;

  return db
    .select({
      id: assetType.id,
      name: assetType.name,
      slug: assetType.slug,
      description: assetType.description,
      definition: assetType.definition,
      createdAt: assetType.createdAt,
      updatedAt: assetType.updatedAt,
    })
    .from(assetType)
    .where(whereCondition)
    .orderBy(assetType.name);
}

export async function findAssetTypeById(id: number) {
  const [foundType] = await db
    .select()
    .from(assetType)
    .where(eq(assetType.id, id))
    .limit(1);
  return foundType ?? null;
}
