import {
  serviceOrder,
  serviceOrderDeliveryDocument,
  serviceOrderIntakeDocument,
  serviceOrderQuote,
  serviceOrderExecution,
  serviceOrderTag,
  type ServiceOrderSignatureData,
} from "@calibra-facil/db/schema";
import { and, desc, eq } from "drizzle-orm";
import type { OrgContext } from "../../lib/org-context";
import { orgDb } from "../../lib/org-db";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";
import {
  createR2Client,
  generatePresignedUrl,
  type R2Env,
} from "../../lib/storage";
import { buildUnitScopeCondition } from "../../lib/units";
import { getServiceOrderDetail } from "./service-order.read-model";
import { serviceOrderNotFound } from "./service-order-errors";
import type { ServiceOrderScope } from "./service-order-scope";
import { portalBaseUrl } from "@calibra-facil/shared/public-urls";

export type ServiceOrderDocumentEnv = R2Env & {
  PORTAL_APP_URL?: string;
};

export function buildPortalBaseUrl(env: ServiceOrderDocumentEnv) {
  return env.PORTAL_APP_URL ?? portalBaseUrl();
}

/**
 * The scope's order with its documents, or a 404: the same answer for an order
 * of another laboratory or unit as for a missing one.
 */
async function requireServiceOrderDetail(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
) {
  const detail = await getServiceOrderDetail(
    ctx.o,
    serviceOrderId,
    ctx.org,
    buildUnitScopeCondition(serviceOrder.unitId, scope),
  );
  if (!detail) throw serviceOrderNotFound();
  return detail;
}

export async function issueIntakeDocument(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  input: { env: ServiceOrderDocumentEnv; serviceOrderId: number },
) {
  const detail = await requireServiceOrderDetail(
    ctx,
    scope,
    input.serviceOrderId,
  );

  const [document] = await ctx.o
    .insert(serviceOrderIntakeDocument)
    .values({
      organizationId: ctx.org,
      serviceOrderId: input.serviceOrderId,
      documentNumber: `${detail.serviceOrderNumber}/REC`,
      version: detail.intakeDocuments.length + 1,
      issuedAt: new Date(),
      issuedByUserId: ctx.actor.userId,
      qrCodePayload: `${buildPortalBaseUrl(input.env)}/service-order-access`,
    })
    .returning();

  await recordServiceOrderEvent(
    {
      organizationId: detail.organizationId,
      unitId: detail.unitId,
      serviceOrderId: input.serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.intake_document_issued",
      metadata: { documentId: document?.id },
    },
    ctx.o,
  );

  // The job renders the row this transaction wrote: it is staged with it.
  await ctx.emit({
    type: "SERVICE_ORDER_INTAKE_DOCUMENT",
    serviceOrderId: input.serviceOrderId,
    documentId: document?.id,
    userId: ctx.actor.userId,
  });

  return document ?? null;
}

export async function issueTag(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
) {
  const detail = await requireServiceOrderDetail(ctx, scope, serviceOrderId);

  const [tag] = await ctx.o
    .insert(serviceOrderTag)
    .values({
      organizationId: ctx.org,
      serviceOrderId,
      tagNumber: `${detail.serviceOrderNumber}-TAG-${detail.tags.length + 1}`,
      printedAt: new Date(),
      printedByUserId: ctx.actor.userId,
    })
    .returning();

  await recordServiceOrderEvent(
    {
      organizationId: detail.organizationId,
      unitId: detail.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.tag_printed",
      metadata: { tagId: tag?.id },
    },
    ctx.o,
  );

  await ctx.emit({
    type: "SERVICE_ORDER_TAG",
    serviceOrderId,
    tagId: tag?.id,
    userId: ctx.actor.userId,
  });

  return tag ?? null;
}

export async function issueDeliveryDocument(
  ctx: OrgContext,
  scope: ServiceOrderScope,
  serviceOrderId: number,
  signatures: {
    technicianSignatureData?: ServiceOrderSignatureData | null;
    clientSignatureData?: ServiceOrderSignatureData | null;
  },
) {
  const detail = await requireServiceOrderDetail(ctx, scope, serviceOrderId);

  const nextVersion = detail.deliveryDocuments.length + 1;
  const [document] = await ctx.o
    .insert(serviceOrderDeliveryDocument)
    .values({
      organizationId: ctx.org,
      serviceOrderId,
      documentNumber: `${detail.serviceOrderNumber}/ENT`,
      version: nextVersion,
      issuedAt: new Date(),
      issuedByUserId: ctx.actor.userId,
      technicianSignatureData: signatures.technicianSignatureData ?? null,
      clientSignatureData: signatures.clientSignatureData ?? null,
    })
    .returning();

  if (detail.execution) {
    await ctx.o
      .update(serviceOrderExecution)
      .set({
        technicianSignatureData:
          signatures.technicianSignatureData ??
          detail.execution.technicianSignatureData ??
          null,
        clientSignatureData:
          signatures.clientSignatureData ??
          detail.execution.clientSignatureData ??
          null,
        updatedAt: new Date(),
      })
      .where(eq(serviceOrderExecution.id, detail.execution.id));
  }

  await recordServiceOrderEvent(
    {
      organizationId: detail.organizationId,
      unitId: detail.unitId,
      serviceOrderId,
      actorType: "lab_user",
      actorId: ctx.actor.userId,
      eventType: "service_order.delivery_document_issued",
      metadata: { documentId: document?.id, version: nextVersion },
    },
    ctx.o,
  );

  await ctx.emit({
    type: "SERVICE_ORDER_DELIVERY_RECEIPT",
    serviceOrderId,
    documentId: document?.id,
    userId: ctx.actor.userId,
  });

  return document ?? null;
}

export async function getLatestIntakeDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
  organizationId: string,
) {
  const [document] = await orgDb(organizationId).transaction((o) =>
    o
      .select()
      .from(serviceOrderIntakeDocument)
      .where(eq(serviceOrderIntakeDocument.serviceOrderId, serviceOrderId))
      .orderBy(desc(serviceOrderIntakeDocument.version))
      .limit(1),
  );

  return document?.pdfR2Key
    ? createDocumentDownloadUrl(env, document.pdfR2Key)
    : null;
}

export async function getLatestTagDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
  organizationId: string,
) {
  const [tag] = await orgDb(organizationId).transaction((o) =>
    o
      .select()
      .from(serviceOrderTag)
      .where(eq(serviceOrderTag.serviceOrderId, serviceOrderId))
      .orderBy(desc(serviceOrderTag.id))
      .limit(1),
  );

  return tag?.pdfR2Key ? createDocumentDownloadUrl(env, tag.pdfR2Key) : null;
}

export async function getLatestDeliveryDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
  organizationId: string,
) {
  const [document] = await orgDb(organizationId).transaction((o) =>
    o
      .select()
      .from(serviceOrderDeliveryDocument)
      .where(eq(serviceOrderDeliveryDocument.serviceOrderId, serviceOrderId))
      .orderBy(desc(serviceOrderDeliveryDocument.version))
      .limit(1),
  );

  return document?.pdfR2Key
    ? createDocumentDownloadUrl(env, document.pdfR2Key)
    : null;
}

export async function getQuoteDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
  quoteId: number,
  organizationId: string,
) {
  const [quote] = await orgDb(organizationId).transaction((o) =>
    o
      .select()
      .from(serviceOrderQuote)
      .where(
        and(
          eq(serviceOrderQuote.id, quoteId),
          eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
        ),
      )
      .limit(1),
  );

  return quote?.pdfR2Key
    ? createDocumentDownloadUrl(env, quote.pdfR2Key)
    : null;
}

async function createDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  pdfR2Key: string,
) {
  const client = createR2Client(env);
  return generatePresignedUrl(client, env.R2_BUCKET_NAME, pdfR2Key);
}
