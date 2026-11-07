import {
  calibrationRequest,
  calibrationRequestItem,
} from "@calibra-facil/db/schema";
import type { OrgContext } from "./org-context";

type NewCalibrationRequest = typeof calibrationRequest.$inferInsert;

/**
 * Submits one calibration request of the customer for `assetIds`: the request,
 * one item per asset and the `create` audit row, in the caller's transaction.
 * Shared by the portal (single and batch submissions) and the public API v2.
 * The caller owns what only it knows: the checks on the assets, the lock that
 * keeps a duplicate request out and the notification after the commit.
 *
 * `fields` carries what is specific to the channel (the portal's delivery
 * details); `submittedBy` is the actor of the context.
 */
export async function submitCalibrationRequest(
  ctx: OrgContext,
  params: {
    unitId: number;
    customerId: number;
    /** The customer's CLIENT organization (its portal tenant). */
    authOrganizationId: string;
    assetIds: number[];
    observations: string | undefined;
    requestedDueDate: Date | null;
    fields?: Partial<NewCalibrationRequest>;
  },
) {
  const [created] = await ctx.o
    .insert(calibrationRequest)
    .values({
      ...params.fields,
      organizationId: ctx.org,
      unitId: params.unitId,
      customerId: params.customerId,
      authOrganizationId: params.authOrganizationId,
      observations: params.observations || null,
      requestedDueDate: params.requestedDueDate,
      submittedBy: ctx.actor.userId,
    })
    .returning();
  if (!created) throw new Error("Erro ao criar solicitacao");

  await ctx.o.insert(calibrationRequestItem).values(
    params.assetIds.map((assetId) => ({
      organizationId: created.organizationId,
      requestId: created.id,
      assetId,
    })),
  );

  await ctx.audit("calibrationRequest", created.id, {
    action: "create",
    changes: {
      initial: {
        assetIds: params.assetIds,
        observations: params.observations || null,
        requestedDueDate: params.requestedDueDate?.toISOString() ?? null,
      },
    },
  });
  return created;
}
