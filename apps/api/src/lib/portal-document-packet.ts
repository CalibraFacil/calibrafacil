import { db } from "@calibra-facil/db";
import {
  billingDocument,
  calibrationJob,
  serviceOrder,
  serviceOrderCertificateLink,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";
import {
  resolvePortalFinancialDocumentHrefs,
  type PortalFinancialDocumentHrefSigner,
} from "./portal-financial-summary";
import { loadPortalReleaseStatuses } from "./portal-certificate-release-gate";

export interface PortalDocumentPacketItem {
  kind: "invoice" | "fiscal_document" | "receipt" | "certificate";
  label: string;
  availableAt: string | null;
  href: string | null;
}

export interface PortalDocumentPacket {
  serviceOrderId: number;
  items: PortalDocumentPacketItem[];
}

/**
 * Bundle every signed document URL the portal customer is allowed to
 * download for a single service order: invoice PDF + fiscal-document
 * XML + receipt PDFs (from slice 1b's portal financial summary) plus
 * the certificate URL when the slice-1 release gate says it's
 * released.
 *
 * Provider-neutral DTO: no policy mode, no provider name, no raw
 * billing-document status — only the kind enum + label + availableAt
 * + href.
 */
export async function buildPortalDocumentPacket(params: {
  organizationId: string;
  serviceOrderId: number;
  customerId: number;
  signer: PortalFinancialDocumentHrefSigner;
}): Promise<PortalDocumentPacket | null> {
  // Service order must belong to the linked customer + lab tenant.
  const [order] = await db
    .select({
      id: serviceOrder.id,
      customerId: serviceOrder.customerId,
      billingDocumentId: serviceOrder.billingDocumentId,
    })
    .from(serviceOrder)
    .where(
      and(
        eq(serviceOrder.id, params.serviceOrderId),
        eq(serviceOrder.organizationId, params.organizationId),
        eq(serviceOrder.customerId, params.customerId),
      ),
    )
    .limit(1);
  if (!order) return null;

  const items: PortalDocumentPacketItem[] = [];

  // Financial documents (invoice + fiscal + receipts).
  if (order.billingDocumentId) {
    const [doc] = await db
      .select({
        id: billingDocument.id,
        issueDate: billingDocument.issueDate,
      })
      .from(billingDocument)
      .where(eq(billingDocument.id, order.billingDocumentId))
      .limit(1);

    if (doc) {
      const hrefs = await resolvePortalFinancialDocumentHrefs({
        organizationId: params.organizationId,
        billingDocumentId: doc.id,
        fiscalAccessKey: null,
        receiptIds: [],
        signer: params.signer,
      });

      if (hrefs.invoice) {
        items.push({
          kind: "invoice",
          label: "Fatura",
          availableAt: doc.issueDate ? doc.issueDate.toISOString() : null,
          href: hrefs.invoice,
        });
      }
      if (hrefs.fiscalDocument) {
        items.push({
          kind: "fiscal_document",
          label: "Documento fiscal",
          availableAt: doc.issueDate ? doc.issueDate.toISOString() : null,
          href: hrefs.fiscalDocument,
        });
      }
      for (const [receiptId, href] of Object.entries(hrefs.receipts ?? {})) {
        if (!href) continue;
        items.push({
          kind: "receipt",
          label: `Recibo #${receiptId}`,
          availableAt: null,
          href,
        });
      }
    }
  }

  // Certificate(s) linked to the SO that are RELEASED per slice 1.
  const certificateJobs = await db
    .select({
      id: calibrationJob.id,
      certificateUrl: calibrationJob.certificateUrl,
      status: calibrationJob.status,
      approvedAt: calibrationJob.approvedAt,
    })
    .from(serviceOrderCertificateLink)
    .innerJoin(
      calibrationJob,
      eq(calibrationJob.id, serviceOrderCertificateLink.certificateJobId),
    )
    .where(eq(serviceOrderCertificateLink.serviceOrderId, params.serviceOrderId));

  const approvedJobs = certificateJobs.filter(
    (row) => row.status === "APPROVED" || row.status === "SUPERSEDED",
  );
  if (approvedJobs.length > 0) {
    const releaseStatuses = await loadPortalReleaseStatuses({
      organizationId: params.organizationId,
      calibrationJobIds: approvedJobs.map((row) => row.id),
    });
    for (const job of approvedJobs) {
      if (!job.certificateUrl) continue;
      const status = releaseStatuses.get(job.id) ?? "RELEASED";
      if (status !== "RELEASED") continue;
      items.push({
        kind: "certificate",
        label: `Certificado #${job.id}`,
        availableAt: job.approvedAt ? job.approvedAt.toISOString() : null,
        // Certificate URLs are not re-signed here — portal already
        // proxies them via the existing download endpoint. Expose the
        // R2 key in the packet so the portal can call its own signed-
        // download endpoint per cert.
        href: job.certificateUrl,
      });
    }
  }

  return { serviceOrderId: params.serviceOrderId, items };
}
