import {
  calibrationJob,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { orgDb } from "../../lib/org-db";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";

export async function linkServiceOrderCertificate(input: {
  serviceOrderId: number;
  certificateJobId: number;
  organizationId: string;
  actorUserId: string;
}) {
  return orgDb(input.organizationId).transaction(async (o) => {
    // Both ids are request-supplied: resolve each INSIDE the caller's
    // organization so "exists in another tenant" is indistinguishable from
    // "does not exist" (no 400-vs-404 existence oracle).
    const [order] = await o
      .select()
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.id, input.serviceOrderId),
          eq(serviceOrder.organizationId, input.organizationId),
        ),
      )
      .limit(1);
    const [job] = await o
      .select()
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.id, input.certificateJobId),
          eq(calibrationJob.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    if (!order || !job) return { status: "not_found" as const };

    if (
      job.unitId !== order.unitId ||
      job.customerId !== order.customerId ||
      job.assetId !== order.assetId
    ) {
      return { status: "incompatible" as const };
    }

    const [link] = await o
      .insert(serviceOrderCertificateLink)
      .values({
        organizationId: input.organizationId,
        serviceOrderId: input.serviceOrderId,
        certificateJobId: input.certificateJobId,
        linkedByUserId: input.actorUserId,
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
        serviceOrderId: input.serviceOrderId,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.certificate_linked",
        metadata: { certificateJobId: input.certificateJobId },
      },
      o,
    );

    return { status: "ok" as const, data: link };
  });
}

export async function unlinkServiceOrderCertificate(input: {
  serviceOrderId: number;
  certificateJobId: number;
  organizationId: string;
  actorUserId: string;
}) {
  return orgDb(input.organizationId).transaction(async (o) => {
    // SEC-01: a cross-tenant :id must not delete another org's link. The order
    // is resolved inside the caller's organization BEFORE the DELETE (the
    // handle scopes the read, so another tenant's order answers like a missing
    // one), mirroring the link sibling.
    const [order] = await o
      .select()
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.id, input.serviceOrderId),
          eq(serviceOrder.organizationId, input.organizationId),
        ),
      )
      .limit(1);

    if (!order) {
      return { status: "not_found" as const };
    }

    await o
      .delete(serviceOrderCertificateLink)
      .where(
        and(
          eq(serviceOrderCertificateLink.serviceOrderId, input.serviceOrderId),
          eq(
            serviceOrderCertificateLink.certificateJobId,
            input.certificateJobId,
          ),
          eq(serviceOrderCertificateLink.organizationId, input.organizationId),
        ),
      );

    await recordServiceOrderEvent(
      {
        organizationId: order.organizationId,
        unitId: order.unitId,
        serviceOrderId: input.serviceOrderId,
        actorType: "lab_user",
        actorId: input.actorUserId,
        eventType: "service_order.certificate_unlinked",
        metadata: { certificateJobId: input.certificateJobId },
      },
      o,
    );

    return { status: "ok" as const };
  });
}
