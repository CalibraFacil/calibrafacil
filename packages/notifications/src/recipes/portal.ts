// Recipes of the customer-facing portal notifications: certificate ready, as-found out of tolerance, audit pack, amendment.
// One row per notification type: load the entity, resolve the recipients and
// yield what each one receives. `notify()` sends the yielded rows one by one.
import { organization, portalExportJob } from "@calibra-facil/db/schema";
import { eq } from "drizzle-orm";
import { db } from "@calibra-facil/db";
import {
  formatCalendarDate,
  formatInstant,
} from "@calibra-facil/shared/format";
import { inOrg, findAuditPackLaboratory } from "../lab-scope";
import { buildCertificateAmendedLinks } from "../portal-links";
import { getLabEmailBrand, getPortalBaseUrl } from "../delivery";
import {
  getJobDetails,
  getAssetDetails,
  adminsAndOwners,
  listMemberIds,
  getCustomerPortalContact,
} from "./lookups";
import type { NotificationRecipes } from "./types";

export const portalRecipes = {
  /**
   * Notify client portal users when a certificate is ready
   */
  async *CERTIFICATE_READY({ jobId }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    const customerData = await getCustomerPortalContact(
      job.organizationId,
      job.customerId,
    );

    if (!customerData?.authOrganizationId) return;

    const assetData = await getAssetDetails(job.organizationId, job.assetId);

    const portalUserIds = await listMemberIds(customerData.authOrganizationId);

    const portalUrl = `${getPortalBaseUrl()}/certificates`;
    const emailBrand = await getLabEmailBrand(job.organizationId);

    for (const portalUserId of portalUserIds) {
      yield {
        recipientUserId: portalUserId,
        organizationId: customerData.authOrganizationId,
        type: "CERTIFICATE_READY",
        priority: "HIGH",
        title: "Certificado de calibração disponível",
        message: `O certificado da OS ${job.jobIdentifier} está pronto para download no portal.`,
        relatedEntity: {
          entityType: "job",
          entityId: jobId,
          jobId: job.jobIdentifier,
        },
        actionUrl: `/portal/certificates`,
        emailContext: {
          type: "certificate",
          data: {
            jobId: job.jobIdentifier,
            assetName: assetData?.name,
            customerName: customerData.name,
            portalUrl,
          },
        },
        emailBrand,
      };
    }
  },

  /**
   * Notify client portal users when their instrument was reproved in the
   * as-found ("como recebido") condition at certificate approval (#740 Track B).
   * The impact assessment is the CUSTOMER'S obligation (ISO 9001:2015 §7.1.5.2);
   * this only alerts and points at the portal workspace. Recipients mirror
   * notifyCertificateReady: every member of the customer's CLIENT org.
   */
  async *ASSET_FOUND_OUT_OF_TOLERANCE({ jobId }) {
    const job = await getJobDetails(jobId);
    if (!job) return;

    const customerData = await getCustomerPortalContact(
      job.organizationId,
      job.customerId,
    );

    if (!customerData?.authOrganizationId) return;

    const assetData = await getAssetDetails(job.organizationId, job.assetId);

    const portalUserIds = await listMemberIds(customerData.authOrganizationId);

    const portalUrl = `${getPortalBaseUrl()}/assets/${job.assetId}`;
    const emailBrand = await getLabEmailBrand(job.organizationId);
    const assetTag = assetData?.tag ?? String(job.assetId);

    for (const portalUserId of portalUserIds) {
      yield {
        recipientUserId: portalUserId,
        organizationId: customerData.authOrganizationId,
        type: "ASSET_FOUND_OUT_OF_TOLERANCE",
        priority: "HIGH",
        title: "Ação requerida: avaliar impacto",
        message: `O equipamento ${assetTag} foi reprovado na condição "como recebido" na calibração ${job.jobIdentifier}. Avalie o impacto sobre medições anteriores no portal.`,
        relatedEntity: {
          entityType: "asset",
          entityId: job.assetId,
        },
        actionUrl: `/portal/assets/${job.assetId}`,
        emailContext: {
          type: "assetOot",
          data: {
            assetTag,
            assetName: assetData?.name,
            jobId: job.jobIdentifier,
            portalUrl,
          },
        },
        emailBrand,
      };
    }
  },

  /**
   * Notify client portal users when an audit pack finished generating (#738).
   * Recipients are every member of the requesting CLIENT org (branch customer
   * or customer group) — the same audience that can see and download the pack
   * on the portal certificates page.
   */
  async *AUDIT_PACK_READY({ exportId }) {
    const laboratoryId = await findAuditPackLaboratory(exportId);
    if (!laboratoryId) return;

    const [exportRow] = await inOrg(laboratoryId, (o) =>
      o
        .select({
          id: portalExportJob.id,
          labOrganizationId: portalExportJob.labOrganizationId,
          authOrganizationId: portalExportJob.authOrganizationId,
          params: portalExportJob.params,
          certificateCount: portalExportJob.certificateCount,
          expiresAt: portalExportJob.expiresAt,
        })
        .from(portalExportJob)
        .where(eq(portalExportJob.id, exportId))
        .limit(1),
    );

    if (!exportRow) return;

    const [authOrganization] = await db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, exportRow.authOrganizationId))
      .limit(1);

    // The members of the requesting CLIENT organization (its own tenant column).
    const portalUserIds = await listMemberIds(exportRow.authOrganizationId);

    const periodLabel = `${formatCalendarDate(exportRow.params.dateFrom)} a ${formatCalendarDate(exportRow.params.dateTo)}`;
    const expiresAtLabel = exportRow.expiresAt
      ? formatInstant(exportRow.expiresAt, "date")
      : undefined;
    const portalUrl = `${getPortalBaseUrl()}/certificates`;
    const emailBrand = await getLabEmailBrand(exportRow.labOrganizationId);

    for (const portalUserId of portalUserIds) {
      yield {
        recipientUserId: portalUserId,
        organizationId: exportRow.authOrganizationId,
        type: "AUDIT_PACK_READY",
        priority: "HIGH",
        title: "Pacote de auditoria disponível",
        message: `O pacote de auditoria do período ${periodLabel} está pronto para download no portal.`,
        relatedEntity: {
          entityType: "audit_pack",
          entityId: exportId,
        },
        actionUrl: `/portal/certificates`,
        emailContext: {
          type: "auditPack",
          data: {
            customerName: authOrganization?.name,
            periodLabel,
            certificateCount: exportRow.certificateCount ?? 0,
            expiresAtLabel,
            portalUrl,
          },
        },
        emailBrand,
      };
    }
  },

  /**
   * Notify client portal users when a certificate is amended
   */
  async *CERTIFICATE_AMENDED({ originalJobId, amendedJobId, reason }) {
    const originalJob = await getJobDetails(originalJobId);
    const amendedJob = await getJobDetails(amendedJobId);
    if (!originalJob || !amendedJob) return;

    const customerData = await getCustomerPortalContact(
      originalJob.organizationId,
      originalJob.customerId,
    );

    if (!customerData?.authOrganizationId) return;

    const assetData = await getAssetDetails(
      originalJob.organizationId,
      originalJob.assetId,
    );

    const portalUserIds = await listMemberIds(customerData.authOrganizationId);

    // Deep-link to the superseded certificate's detail page (#744): it renders
    // the §7.8.8 supersession banner and links the retificação once issued —
    // the amendment itself is still DRAFT at this point.
    const { actionUrl, portalUrl } = buildCertificateAmendedLinks({
      portalBaseUrl: getPortalBaseUrl(),
      supersededJobIdentifier: originalJob.jobIdentifier,
    });
    const emailBrand = await getLabEmailBrand(originalJob.organizationId);

    for (const portalUserId of portalUserIds) {
      yield {
        recipientUserId: portalUserId,
        organizationId: customerData.authOrganizationId,
        type: "CERTIFICATE_AMENDED",
        priority: "HIGH",
        title: "Certificado de calibração retificado",
        message: `O certificado ${originalJob.jobIdentifier} foi retificado. Novo certificado: ${amendedJob.jobIdentifier}. Motivo: ${reason}`,
        relatedEntity: {
          entityType: "job",
          entityId: amendedJobId,
          jobId: amendedJob.jobIdentifier,
        },
        actionUrl,
        emailContext: {
          type: "certificate",
          data: {
            jobId: amendedJob.jobIdentifier,
            originalJobId: originalJob.jobIdentifier,
            assetName: assetData?.name,
            customerName: customerData.name,
            reason,
            portalUrl,
          },
        },
        emailBrand,
      };
    }

    // Also notify lab admins/owners
    const labAdmins = await adminsAndOwners(originalJob.organizationId);

    for (const adminId of labAdmins) {
      yield {
        recipientUserId: adminId,
        organizationId: originalJob.organizationId,
        type: "CERTIFICATE_AMENDED",
        priority: "HIGH",
        title: "Certificado retificado",
        message: `O certificado ${originalJob.jobIdentifier} foi retificado. Novo: ${amendedJob.jobIdentifier}. Motivo: ${reason}`,
        relatedEntity: {
          entityType: "job",
          entityId: amendedJobId,
          jobId: amendedJob.jobIdentifier,
        },
        actionUrl: `/dashboard/jobs/${amendedJobId}`,
        emailContext: {
          type: "certificate",
          data: {
            jobId: amendedJob.jobIdentifier,
            originalJobId: originalJob.jobIdentifier,
            assetName: assetData?.name,
            customerName: customerData.name,
            reason,
            portalUrl: `/dashboard/jobs/${amendedJobId}`,
          },
        },
      };
    }
  },
} satisfies Partial<NotificationRecipes>;
