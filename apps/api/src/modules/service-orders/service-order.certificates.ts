import {
  calibrationJob,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { invalid, notFound } from "../../lib/domain-errors";
import type { OrgContext } from "../../lib/org-context";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";

function orderOrCertificateNotFound() {
  return notFound(
    "service_order_certificate_not_found",
    "OS ou certificado nao encontrado",
  );
}

export async function linkServiceOrderCertificate(
  ctx: OrgContext,
  serviceOrderId: number,
  certificateJobId: number,
) {
  // Both ids are request-supplied: resolve each INSIDE the caller's
  // organization so "exists in another tenant" is indistinguishable from
  // "does not exist" (no 400-vs-404 existence oracle).
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    )
    .limit(1);
  const [job] = await ctx.o
    .select()
    .from(calibrationJob)
    .where(
      and(
        eq(calibrationJob.id, certificateJobId),
        eq(calibrationJob.organizationId, ctx.org),
      ),
    )
    .limit(1);

  if (!order || !job) throw orderOrCertificateNotFound();

  if (
    job.unitId !== order.unitId ||
    job.customerId !== order.customerId ||
    job.assetId !== order.assetId
  ) {
    throw invalid(
      "service_order_certificate_incompatible",
      "Certificado incompativel com a OS",
    );
  }

  const [link] = await ctx.o
    .insert(serviceOrderCertificateLink)
    .values({
      organizationId: ctx.org,
      serviceOrderId,
      certificateJobId,
      linkedByUserId: ctx.actor.userId,
    })
    .onConflictDoNothing({
      target: [
        serviceOrderCertificateLink.serviceOrderId,
        serviceOrderCertificateLink.certificateJobId,
      ],
    })
    .returning();

  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.certificate_linked",
      metadata: { certificateJobId },
    },
    ctx.o,
  );

  return link;
}

export async function unlinkServiceOrderCertificate(
  ctx: OrgContext,
  serviceOrderId: number,
  certificateJobId: number,
) {
  // SEC-01: a cross-tenant :id must not delete another org's link. The order
  // is resolved inside the caller's organization BEFORE the DELETE (the
  // handle scopes the read, so another tenant's order answers like a missing
  // one), mirroring the link sibling.
  const [order] = await ctx.o
    .select()
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, serviceOrderId),
        eq(serviceOrder.organizationId, ctx.org),
      ),
    )
    .limit(1);

  if (!order) throw orderOrCertificateNotFound();

  await ctx.o
    .delete(serviceOrderCertificateLink)
    .where(
      and(
        eq(serviceOrderCertificateLink.serviceOrderId, serviceOrderId),
        eq(serviceOrderCertificateLink.certificateJobId, certificateJobId),
        eq(serviceOrderCertificateLink.organizationId, ctx.org),
      ),
    );

  await recordServiceOrderEvent(
    {
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.certificate_unlinked",
      metadata: { certificateJobId },
    },
    ctx.o,
  );
}
