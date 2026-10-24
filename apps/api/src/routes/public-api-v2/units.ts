import { Hono } from "hono";
import { organizationUnit } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { buildPublicApiError } from "../../lib/public-api";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { orgDb } from "../../lib/org-db";

export const unitRoutes = new Hono<PublicApiV2Env>()
  .get("/units", requireApiScope("units:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const units = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select({
          id: organizationUnit.id,
          name: organizationUnit.name,
          slug: organizationUnit.slug,
          status: organizationUnit.status,
          isDefault: organizationUnit.isDefault,
        })
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.organizationId, apiKey.organizationId),
            eq(organizationUnit.status, "ACTIVE"),
          ),
        )
        .orderBy(organizationUnit.name),
    );
    return c.json({ data: units });
  })
  .get("/units/:id", requireApiScope("units:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.json(
        buildPublicApiError({
          code: "unit_not_found",
          message: "Unidade não encontrada",
        }),
        404,
      );
    }
    const [found] = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select()
        .from(organizationUnit)
        .where(
          and(
            eq(organizationUnit.id, id),
            eq(organizationUnit.organizationId, apiKey.organizationId),
          ),
        )
        .limit(1),
    );
    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "unit_not_found",
          message: "Unidade não encontrada",
        }),
        404,
      );
    }
    return c.json({ data: found });
  });
