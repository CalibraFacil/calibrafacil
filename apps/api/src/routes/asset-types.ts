import { createRouter } from "../server/router";
import { assetTypeEndpoints } from "@calibra-facil/contracts";
import { withPermission, type AuthVariables } from "../middleware/permission";
import { findAssetTypeById, listAssetTypes } from "../lib/asset-types";
import { invalid, notFound } from "../lib/domain-errors";
import { mount } from "../lib/endpoint-mount";
import { orgDb } from "../lib/org-db";

/**
 * READ-ONLY lab-facing view of the GLOBAL asset-type catalog (#637).
 *
 * `asset_type` has no organization_id — it is a platform-wide shared catalog,
 * so tenant RBAC must never gate writes to it (any lab admin could corrupt or
 * delete types used by every other tenant). Per Pedro's decision (2026-07-05)
 * the catalog is curated centrally: it is seeded by
 * `packages/db/src/seed-asset-types.ts` and is read-only through the API.
 *
 * The reads live in `lib/asset-types.ts`: the catalog has no tenant column and
 * no row-level-security policy, so there is no laboratory to bind them to.
 */
const PREFIX = "/api/asset-types";

export const assetTypesRouter = createRouter<{ Variables: AuthVariables }>();

// GET / - List all asset types (for dropdown/selection)
mount(
  assetTypesRouter,
  PREFIX,
  assetTypeEndpoints.list,
  withPermission({ equipment: ["read"] }),
  async (_c, { query }) => ({ data: await listAssetTypes(query.query) }),
);

// GET /:id - Get a single asset type by ID. Not client-facing (nothing in the
// frontends calls it), so it stays a plain route outside the endpoint
// definitions.
assetTypesRouter.get(
  "/:id",
  ...withPermission({ equipment: ["read"] }),
  async (c) => {
    const id = parseInt(c.req.param("id"), 10);

    if (isNaN(id)) {
      throw invalid("invalid_request", "ID inválido");
    }

    const foundType = await orgDb(c.get("member").organizationId).transaction(
      (o) => findAssetTypeById(id, o),
    );

    if (!foundType) {
      throw notFound("asset_type_not_found", "Tipo de ativo não encontrado");
    }

    return c.json(foundType);
  },
);
