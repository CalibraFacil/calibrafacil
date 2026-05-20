import { db } from "@calibra-facil/db";
import {
  serviceOrderDeliveryDocument,
  serviceOrderIntakeDocument,
  serviceOrderQuote,
  serviceOrderExecution,
  serviceOrderTag,
  type ServiceOrderSignatureData,
} from "@calibra-facil/db/schema";
import type { BackgroundJobMessage } from "@calibra-facil/shared";
import { and, desc, eq } from "drizzle-orm";
import { enqueueBackgroundJob } from "../../lib/background-jobs";
import { recordServiceOrderEvent } from "../../lib/service-order-workflow";
import {
  createR2Client,
  generatePresignedUrl,
  type R2Env,
} from "../../lib/storage";
import { buildUnitScopeCondition } from "../../lib/units";
import { getServiceOrderDetail } from "./service-order.read-model";

export type ServiceOrderDocumentEnv = R2Env & {
  PORTAL_APP_URL?: string;
};

export function buildPortalBaseUrl(env: ServiceOrderDocumentEnv) {
  return env.PORTAL_APP_URL ?? "https://portal.calibrafacil.com";
}

export async function enqueueServiceOrderDocumentJob(
  message: BackgroundJobMessage,
) {
  await enqueueBackgroundJob(message);
  return true;
}

export async function issueIntakeDocument(input: {
  env: ServiceOrderDocumentEnv;
  serviceOrderId: number;
  organizationId: string;
  unitCondition?: ReturnType<typeof buildUnitScopeCondition>;
  actorUserId: string;
}) {
  const detail = await getServiceOrderDetail(
    input.serviceOrderId,
    input.organizationId,
    input.unitCondition,
  );
  if (!detail) return null;

  const [document] = await db
    .insert(serviceOrderIntakeDocument)
    .values({
      serviceOrderId: input.serviceOrderId,
      documentNumber: `${detail.serviceOrderNumber}/REC`,
      version: detail.intakeDocuments.length + 1,
      issuedAt: new Date(),
      issuedByUserId: input.actorUserId,
      qrCodePayload: `${buildPortalBaseUrl(input.env)}/service-order-access`,
    })
    .returning();

  await recordServiceOrderEvent({
    organizationId: detail.organizationId,
    unitId: detail.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.intake_document_issued",
    metadata: { documentId: document?.id },
  });
  await enqueueServiceOrderDocumentJob({
    type: "SERVICE_ORDER_INTAKE_DOCUMENT",
    serviceOrderId: input.serviceOrderId,
    documentId: document?.id,
    userId: input.actorUserId,
  });

  return document ?? null;
}

export async function issueTag(input: {
  serviceOrderId: number;
  organizationId: string;
  unitCondition?: ReturnType<typeof buildUnitScopeCondition>;
  actorUserId: string;
}) {
  const detail = await getServiceOrderDetail(
    input.serviceOrderId,
    input.organizationId,
    input.unitCondition,
  );
  if (!detail) return null;

  const [tag] = await db
    .insert(serviceOrderTag)
    .values({
      serviceOrderId: input.serviceOrderId,
      tagNumber: `${detail.serviceOrderNumber}-TAG-${detail.tags.length + 1}`,
      printedAt: new Date(),
      printedByUserId: input.actorUserId,
    })
    .returning();

  await recordServiceOrderEvent({
    organizationId: detail.organizationId,
    unitId: detail.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.tag_printed",
    metadata: { tagId: tag?.id },
  });
  await enqueueServiceOrderDocumentJob({
    type: "SERVICE_ORDER_TAG",
    serviceOrderId: input.serviceOrderId,
    tagId: tag?.id,
    userId: input.actorUserId,
  });

  return tag ?? null;
}

export async function issueDeliveryDocument(input: {
  serviceOrderId: number;
  organizationId: string;
  unitCondition?: ReturnType<typeof buildUnitScopeCondition>;
  actorUserId: string;
  signatures: {
    technicianSignatureData?: ServiceOrderSignatureData | null;
    clientSignatureData?: ServiceOrderSignatureData | null;
  };
}) {
  const detail = await getServiceOrderDetail(
    input.serviceOrderId,
    input.organizationId,
    input.unitCondition,
  );
  if (!detail) return null;

  const nextVersion = detail.deliveryDocuments.length + 1;
  const [document] = await db
    .insert(serviceOrderDeliveryDocument)
    .values({
      serviceOrderId: input.serviceOrderId,
      documentNumber: `${detail.serviceOrderNumber}/ENT`,
      version: nextVersion,
      issuedAt: new Date(),
      issuedByUserId: input.actorUserId,
      technicianSignatureData: input.signatures.technicianSignatureData ?? null,
      clientSignatureData: input.signatures.clientSignatureData ?? null,
    })
    .returning();

  if (detail.execution) {
    await db
      .update(serviceOrderExecution)
      .set({
        technicianSignatureData:
          input.signatures.technicianSignatureData ??
          detail.execution.technicianSignatureData ??
          null,
        clientSignatureData:
          input.signatures.clientSignatureData ??
          detail.execution.clientSignatureData ??
          null,
        updatedAt: new Date(),
      })
      .where(eq(serviceOrderExecution.id, detail.execution.id));
  }

  await recordServiceOrderEvent({
    organizationId: detail.organizationId,
    unitId: detail.unitId,
    serviceOrderId: input.serviceOrderId,
    actorType: "lab_user",
    actorId: input.actorUserId,
    eventType: "service_order.delivery_document_issued",
    metadata: { documentId: document?.id, version: nextVersion },
  });
  await enqueueServiceOrderDocumentJob({
    type: "SERVICE_ORDER_DELIVERY_RECEIPT",
    serviceOrderId: input.serviceOrderId,
    documentId: document?.id,
    userId: input.actorUserId,
  });

  return document ?? null;
}

export async function getLatestIntakeDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
) {
  const [document] = await db
    .select()
    .from(serviceOrderIntakeDocument)
    .where(eq(serviceOrderIntakeDocument.serviceOrderId, serviceOrderId))
    .orderBy(desc(serviceOrderIntakeDocument.version))
    .limit(1);

  return document?.pdfR2Key
    ? createDocumentDownloadUrl(env, document.pdfR2Key)
    : null;
}

export async function getLatestTagDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
) {
  const [tag] = await db
    .select()
    .from(serviceOrderTag)
    .where(eq(serviceOrderTag.serviceOrderId, serviceOrderId))
    .orderBy(desc(serviceOrderTag.id))
    .limit(1);

  return tag?.pdfR2Key ? createDocumentDownloadUrl(env, tag.pdfR2Key) : null;
}

export async function getLatestDeliveryDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
) {
  const [document] = await db
    .select()
    .from(serviceOrderDeliveryDocument)
    .where(eq(serviceOrderDeliveryDocument.serviceOrderId, serviceOrderId))
    .orderBy(desc(serviceOrderDeliveryDocument.version))
    .limit(1);

  return document?.pdfR2Key
    ? createDocumentDownloadUrl(env, document.pdfR2Key)
    : null;
}

export async function getQuoteDocumentDownloadUrl(
  env: ServiceOrderDocumentEnv,
  serviceOrderId: number,
  quoteId: number,
) {
  const [quote] = await db
    .select()
    .from(serviceOrderQuote)
    .where(
      and(
        eq(serviceOrderQuote.id, quoteId),
        eq(serviceOrderQuote.serviceOrderId, serviceOrderId),
      ),
    )
    .limit(1);

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
