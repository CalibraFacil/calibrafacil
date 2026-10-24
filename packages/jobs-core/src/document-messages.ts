import type { DocumentBackgroundJobMessage } from "@calibra-facil/schemas";
import {
  type DeliveryAttempt,
  type Env,
  isFinalDelivery,
} from "./runtime-types.js";
import { processServiceOrderIntakeDocument } from "./service-order-data.js";
import {
  processServiceOrderDeliveryReceipt,
  processServiceOrderQuote,
  processServiceOrderTag,
} from "./service-order-documents.js";
import { processOotNotification } from "./oot-notifications.js";
import { processLabelJob } from "./labels.js";
import { processJob } from "./certificate-render.js";
import { findJobOrganization, withDbClient } from "./pdf-render.js";
import { setJobError } from "./job-events.js";

function isServiceOrderDocumentMessage(
  message: DocumentBackgroundJobMessage,
): message is Extract<
  DocumentBackgroundJobMessage,
  {
    type:
      | "SERVICE_ORDER_INTAKE_DOCUMENT"
      | "SERVICE_ORDER_TAG"
      | "SERVICE_ORDER_QUOTE"
      | "SERVICE_ORDER_DELIVERY_RECEIPT";
  }
> {
  return (
    message.type === "SERVICE_ORDER_INTAKE_DOCUMENT" ||
    message.type === "SERVICE_ORDER_TAG" ||
    message.type === "SERVICE_ORDER_QUOTE" ||
    message.type === "SERVICE_ORDER_DELIVERY_RECEIPT"
  );
}

export async function processDocumentMessage(
  env: Env,
  body: DocumentBackgroundJobMessage,
  delivery?: DeliveryAttempt,
) {
  if (isServiceOrderDocumentMessage(body)) {
    let result: { success: boolean; error?: string };
    if (body.type === "SERVICE_ORDER_INTAKE_DOCUMENT") {
      result = await processServiceOrderIntakeDocument(
        env,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_TAG") {
      result = await processServiceOrderTag(
        env,
        body.serviceOrderId,
        body.tagId,
        body.userId,
      );
    } else if (body.type === "SERVICE_ORDER_QUOTE") {
      result = await processServiceOrderQuote(
        env,
        body.serviceOrderId,
        body.quoteId,
      );
    } else {
      result = await processServiceOrderDeliveryReceipt(
        env,
        body.serviceOrderId,
        body.documentId,
        body.userId,
      );
    }

    if (!result.success) {
      throw new Error(result.error ?? `${body.type} failed`);
    }
    return;
  }

  if (body.type === "OOT_NOTIFICATION") {
    const result = await processOotNotification(env, body.notificationId);
    if (!result.success) {
      throw new Error(result.error ?? "OOT_NOTIFICATION failed");
    }
    return;
  }

  const messageType = body.type || "CERTIFICATE";
  const result =
    messageType === "LABEL"
      ? await processLabelJob(env, body.jobId, body.userId)
      : await processJob(env, body.jobId, body.userId);

  if (!result.success && messageType !== "LABEL") {
    // A transient failure (Gotenberg timeout, S3 hiccup) must not REJECT an
    // approved calibration: the queue redelivers this message, and a REJECTED
    // job would make that redelivery a no-op. So the job stays GENERATING_PDF
    // until the last delivery, or until the failure is one retrying cannot fix.
    if (
      ("permanent" in result && result.permanent) ||
      isFinalDelivery(delivery)
    ) {
      await (async () => {
        const organizationId = await findJobOrganization(env, body.jobId);
        if (!organizationId) return;
        await withDbClient(env, (client) =>
          setJobError(
            client,
            organizationId,
            body.jobId,
            result.error || "Unknown error",
            body.userId,
          ),
        );
      })().catch((dbError) => {
        console.error(`[JOB ${body.jobId}] Failed to record error:`, dbError);
      });
    } else {
      console.warn(
        `[JOB ${body.jobId}] Certificate attempt ${delivery?.attempt}/${delivery?.maxAttempts} failed; keeping GENERATING_PDF for redelivery: ${result.error}`,
      );
    }
  }

  if (!result.success) {
    throw new Error(result.error ?? `${messageType} generation failed`);
  }
}
