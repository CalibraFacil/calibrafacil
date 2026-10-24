import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { service } from "@calibra-facil/db/schema";
import { and, count, eq, ilike, or } from "drizzle-orm";
import { buildListMeta, buildPublicApiError } from "../../lib/public-api";
import { requireApiScope } from "../../middleware/api-key-auth";
import { type PublicApiV2Env } from "./env";
import { ListQuerySchema } from "./schemas";
import { orgDb } from "../../lib/org-db";

export const serviceRoutes = new Hono<PublicApiV2Env>()
  .get(
    "/services",
    requireApiScope("services:read"),
    zValidator(
      "query",
      ListQuerySchema.extend({ isActive: z.string().optional() }),
    ),
    async (c) => {
      const apiKey = c.get("apiKey");
      const { page, limit, query, unitId, isActive } = c.req.valid("query");
      const offset = (page - 1) * limit;
      const conditions = [
        eq(service.organizationId, apiKey.organizationId),
        unitId ? eq(service.unitId, unitId) : undefined,
        isActive === "true" ? eq(service.isActive, true) : undefined,
        isActive === "false" ? eq(service.isActive, false) : undefined,
        query
          ? or(
              ilike(service.name, `%${query}%`),
              ilike(service.description, `%${query}%`),
            )
          : undefined,
      ];

      const [countResult, rows] = await orgDb(
        apiKey.organizationId,
      ).transaction((o) =>
        Promise.all([
          o
            .select({ total: count() })
            .from(service)
            .where(and(...conditions)),
          o
            .select()
            .from(service)
            .where(and(...conditions))
            .orderBy(service.name)
            .limit(limit)
            .offset(offset),
        ]),
      );

      return c.json({
        data: rows,
        meta: buildListMeta({
          page,
          limit,
          total: countResult[0]?.total ?? 0,
          filters: {
            query: query ?? null,
            unitId: unitId ?? null,
            isActive: isActive ?? null,
          },
        }),
      });
    },
  )
  .get("/services/:id", requireApiScope("services:read"), async (c) => {
    const apiKey = c.get("apiKey");
    const id = Number.parseInt(c.req.param("id"), 10);
    if (Number.isNaN(id)) {
      return c.json(
        buildPublicApiError({
          code: "service_not_found",
          message: "Serviço não encontrado",
        }),
        404,
      );
    }
    const [found] = await orgDb(apiKey.organizationId).transaction((o) =>
      o
        .select()
        .from(service)
        .where(
          and(
            eq(service.id, id),
            eq(service.organizationId, apiKey.organizationId),
          ),
        )
        .limit(1),
    );
    if (!found) {
      return c.json(
        buildPublicApiError({
          code: "service_not_found",
          message: "Serviço não encontrado",
        }),
        404,
      );
    }
    return c.json({ data: found });
  });
