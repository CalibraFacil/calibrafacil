import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";

export async function linkServiceOrderCertificate(input: {
  serviceOrderId: number;
  certificateJobId: number;
  organizationId: string;
  actorUserId: string;
}) {
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .limit(1);
  const [job] = await db
    .select()
    .from(calibrationJob)
    .where(eq(calibrationJob.id, input.certificateJobId))
    .limit(1);

  if (!order || !job) return { status: "not_found" as const };

  if (
    order.organizationId !== input.organizationId ||
    job.organizationId !== order.organizationId ||
    job.unitId !== order.unitId ||
    job.customerId !== order.customerId ||
    job.assetId !== order.assetId
  ) {
    return { status: "incompatible" as const };
  }

  const [link] = await db
    .insert(serviceOrderCertificateLink)
    .values({
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

  await recordServiceOrderEvent({
    organizationId: order.organizationId,
    unitId: order.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.certificate_linked",
    metadata: { certificateJobId: input.certificateJobId },
  });

  return { status: "ok" as const, data: link };
}

export async function unlinkServiceOrderCertificate(input: {
  serviceOrderId: number;
  certificateJobId: number;
  actorUserId: string;
}) {
  const [order] = await db
    .select()
    .from(serviceOrder)
    .where(eq(serviceOrder.id, input.serviceOrderId))
    .limit(1);

  await db
    .delete(serviceOrderCertificateLink)
    .where(
      and(
        eq(serviceOrderCertificateLink.serviceOrderId, input.serviceOrderId),
        eq(
          serviceOrderCertificateLink.certificateJobId,
          input.certificateJobId,
        ),
      ),
    );

  if (order) {
    await recordServiceOrderEvent({
      organizationId: order.organizationId,
      unitId: order.unitId,
      serviceOrderId: input.serviceOrderId,
      actorType: "lab_user",
      actorId: input.actorUserId,
      eventType: "service_order.certificate_unlinked",
      metadata: { certificateJobId: input.certificateJobId },
    });
  }

  return { ok: true };
}
