// Relations of every table (they read tables of all domains, so they sit above them).
import { relations } from "drizzle-orm";
import {
  account,
  invitation,
  labAccountSetupToken,
  member,
  memberUnitAssignment,
  memberVisualSignature,
  organization,
  organizationApiKey,
  organizationApiKeyAuditLog,
  organizationCustomDomain,
  organizationEmailDomain,
  organizationEventLog,
  organizationSigningCertificate,
  organizationUnit,
  passkey,
  session,
  ssoProvider,
  user,
} from "./identity";
import {
  notification,
  notificationPreference,
  scheduledNotification,
} from "./platform";
import { customer, customerAuditLog, customerGroup } from "./customers";
import { asset, assetAuditLog, assetType } from "./assets";
import { calibrationMethod, methodAuditLog } from "./methods";
import { material, service, serviceAuditLog } from "./catalog";
import {
  referenceStandard,
  referenceStandardAuditLog,
  referenceStandardCertificateDocument,
} from "./standards";
import {
  billingDocument,
  integrationConnection,
  integrationEventLog,
  integrationObjectLink,
  integrationSyncCursor,
  integrationSyncItem,
  integrationSyncRun,
  organizationIntegration,
} from "./finance";
import {
  calibrationRequest,
  calibrationRequestAuditLog,
  calibrationVisit,
  visitAuditLog,
  visitRescheduleRequest,
} from "./visits";
import {
  serviceOrder,
  serviceOrderAssetSnapshot,
  serviceOrderAttachment,
  serviceOrderDeliveryDocument,
  serviceOrderEmailLog,
  serviceOrderEmailOutbox,
  serviceOrderEvaluation,
  serviceOrderEventLog,
  serviceOrderExecution,
  serviceOrderExecutionItem,
  serviceOrderIntakeDocument,
  serviceOrderQuote,
  serviceOrderQuoteItem,
  serviceOrderTag,
} from "./service-orders";
import { calibrationJob, issuedCertificateSnapshot, jobAuditLog } from "./jobs";
import {
  calibrationRequestItem,
  jobStandard,
  serviceOrderCertificateLink,
} from "./job-links";
import {
  accreditedScopeLine,
  accreditedScopeLineAuditLog,
  checkStandardReading,
  controlChart,
  controlChartAuditLog,
  correctiveAction,
  correctiveActionAuditLog,
  environmentalLimits,
  nonConformance,
  nonConformanceAuditLog,
  personnelCompetence,
  personnelCompetenceAuditLog,
  proficiencyTest,
  proficiencyTestAuditLog,
  ptPlanItem,
  trainingRecord,
  trainingRecordAuditLog,
} from "./quality";
import {
  assetOotAuditLog,
  assetOotEvent,
  assetOotImpactAssessment,
  ootEmailOutbox,
  ootImpactAssessment,
  ootNotification,
  standardRecall,
} from "./oot";

export const userRelations = relations(user, ({ many }) => ({
  sessions: many(session),
  accounts: many(account),
  passkeys: many(passkey),
  members: many(member),
  invitations: many(invitation),
  labAccountSetupTokens: many(labAccountSetupToken),
  ssoProviders: many(ssoProvider),
  customDomains: many(organizationCustomDomain),
  emailDomains: many(organizationEmailDomain),
  issuedCertificateSnapshots: many(issuedCertificateSnapshot),
  apiKeyAuditLogs: many(organizationApiKeyAuditLog),
}));

export const sessionRelations = relations(session, ({ one }) => ({
  user: one(user, {
    fields: [session.userId],
    references: [user.id],
  }),
}));

export const accountRelations = relations(account, ({ one }) => ({
  user: one(user, {
    fields: [account.userId],
    references: [user.id],
  }),
}));

export const passkeyRelations = relations(passkey, ({ one }) => ({
  user: one(user, {
    fields: [passkey.userId],
    references: [user.id],
  }),
}));

export const organizationRelations = relations(
  organization,
  ({ one, many }) => ({
    members: many(member),
    units: many(organizationUnit),
    unitAssignments: many(memberUnitAssignment),
    invitations: many(invitation),
    labAccountSetupTokens: many(labAccountSetupToken),
    eventLogs: many(organizationEventLog),
    ssoProviders: many(ssoProvider),
    customDomain: one(organizationCustomDomain),
    emailDomain: one(organizationEmailDomain),
    issuedCertificateSnapshots: many(issuedCertificateSnapshot),
    apiKeys: many(organizationApiKey),
    integrations: many(organizationIntegration),
    integrationConnections: many(integrationConnection),
    integrationSyncRuns: many(integrationSyncRun),
    integrationSyncCursors: many(integrationSyncCursor),
    integrationEventLogs: many(integrationEventLog),
    integrationObjectLinks: many(integrationObjectLink),
  }),
);

export const memberRelations = relations(member, ({ one, many }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [member.userId],
    references: [user.id],
  }),
  unitAssignments: many(memberUnitAssignment),
}));

export const memberUnitAssignmentRelations = relations(
  memberUnitAssignment,
  ({ one }) => ({
    organization: one(organization, {
      fields: [memberUnitAssignment.organizationId],
      references: [organization.id],
    }),
    member: one(member, {
      fields: [memberUnitAssignment.memberId],
      references: [member.id],
    }),
    unit: one(organizationUnit, {
      fields: [memberUnitAssignment.unitId],
      references: [organizationUnit.id],
    }),
    createdByUser: one(user, {
      fields: [memberUnitAssignment.createdBy],
      references: [user.id],
    }),
  }),
);

export const organizationEventLogRelations = relations(
  organizationEventLog,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationEventLog.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [organizationEventLog.unitId],
      references: [organizationUnit.id],
    }),
    actorUser: one(user, {
      fields: [organizationEventLog.actorUserId],
      references: [user.id],
    }),
    actorMember: one(member, {
      fields: [organizationEventLog.actorMemberId],
      references: [member.id],
    }),
  }),
);

export const invitationRelations = relations(invitation, ({ one, many }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [invitation.inviterId],
    references: [user.id],
  }),
  labAccountSetupTokens: many(labAccountSetupToken),
}));

export const labAccountSetupTokenRelations = relations(
  labAccountSetupToken,
  ({ one }) => ({
    user: one(user, {
      fields: [labAccountSetupToken.userId],
      references: [user.id],
    }),
    organization: one(organization, {
      fields: [labAccountSetupToken.organizationId],
      references: [organization.id],
    }),
    invitation: one(invitation, {
      fields: [labAccountSetupToken.invitationId],
      references: [invitation.id],
    }),
    createdByUser: one(user, {
      fields: [labAccountSetupToken.createdByUserId],
      references: [user.id],
    }),
  }),
);

export const ssoProviderRelations = relations(ssoProvider, ({ one }) => ({
  organization: one(organization, {
    fields: [ssoProvider.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [ssoProvider.userId],
    references: [user.id],
  }),
}));

export const organizationCustomDomainRelations = relations(
  organizationCustomDomain,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationCustomDomain.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationCustomDomain.createdBy],
      references: [user.id],
    }),
  }),
);

export const organizationEmailDomainRelations = relations(
  organizationEmailDomain,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationEmailDomain.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationEmailDomain.createdBy],
      references: [user.id],
    }),
  }),
);

export const issuedCertificateSnapshotRelations = relations(
  issuedCertificateSnapshot,
  ({ one }) => ({
    organization: one(organization, {
      fields: [issuedCertificateSnapshot.organizationId],
      references: [organization.id],
    }),
    job: one(calibrationJob, {
      fields: [issuedCertificateSnapshot.jobId],
      references: [calibrationJob.id],
    }),
    issuedByUser: one(user, {
      fields: [issuedCertificateSnapshot.issuedBy],
      references: [user.id],
      relationName: "issuedCertificateIssuer",
    }),
    supersededBy: one(issuedCertificateSnapshot, {
      fields: [issuedCertificateSnapshot.supersededById],
      references: [issuedCertificateSnapshot.id],
      relationName: "issuedCertificateSupersession",
    }),
    voidedByUser: one(user, {
      fields: [issuedCertificateSnapshot.voidedBy],
      references: [user.id],
      relationName: "issuedCertificateVoider",
    }),
  }),
);

export const organizationApiKeyRelations = relations(
  organizationApiKey,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationApiKey.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationApiKey.createdBy],
      references: [user.id],
    }),
    revokedByUser: one(user, {
      fields: [organizationApiKey.revokedBy],
      references: [user.id],
    }),
    auditLogs: many(organizationApiKeyAuditLog),
  }),
);

export const organizationApiKeyAuditLogRelations = relations(
  organizationApiKeyAuditLog,
  ({ one }) => ({
    apiKey: one(organizationApiKey, {
      fields: [organizationApiKeyAuditLog.apiKeyId],
      references: [organizationApiKey.id],
    }),
    organization: one(organization, {
      fields: [organizationApiKeyAuditLog.organizationId],
      references: [organization.id],
    }),
    performedByUser: one(user, {
      fields: [organizationApiKeyAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const organizationIntegrationRelations = relations(
  organizationIntegration,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationIntegration.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationIntegration.createdBy],
      references: [user.id],
      relationName: "organizationIntegrationCreator",
    }),
    updatedByUser: one(user, {
      fields: [organizationIntegration.updatedBy],
      references: [user.id],
      relationName: "organizationIntegrationUpdater",
    }),
    connection: one(integrationConnection, {
      fields: [organizationIntegration.id],
      references: [integrationConnection.integrationId],
    }),
    runs: many(integrationSyncRun),
    syncItems: many(integrationSyncItem),
    cursors: many(integrationSyncCursor),
    events: many(integrationEventLog),
    objectLinks: many(integrationObjectLink),
  }),
);

export const integrationConnectionRelations = relations(
  integrationConnection,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationConnection.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationConnection.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [integrationConnection.createdBy],
      references: [user.id],
      relationName: "integrationConnectionCreator",
    }),
    updatedByUser: one(user, {
      fields: [integrationConnection.updatedBy],
      references: [user.id],
      relationName: "integrationConnectionUpdater",
    }),
  }),
);

export const integrationObjectLinkRelations = relations(
  integrationObjectLink,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationObjectLink.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationObjectLink.organizationId],
      references: [organization.id],
    }),
  }),
);

export const integrationSyncRunRelations = relations(
  integrationSyncRun,
  ({ one, many }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationSyncRun.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationSyncRun.organizationId],
      references: [organization.id],
    }),
    initiatedByUser: one(user, {
      fields: [integrationSyncRun.initiatedBy],
      references: [user.id],
      relationName: "integrationRunInitiator",
    }),
    events: many(integrationEventLog),
    syncItems: many(integrationSyncItem),
  }),
);

export const integrationSyncItemRelations = relations(
  integrationSyncItem,
  ({ one }) => ({
    run: one(integrationSyncRun, {
      fields: [integrationSyncItem.runId],
      references: [integrationSyncRun.id],
    }),
    integration: one(organizationIntegration, {
      fields: [integrationSyncItem.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationSyncItem.organizationId],
      references: [organization.id],
    }),
  }),
);

export const integrationSyncCursorRelations = relations(
  integrationSyncCursor,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationSyncCursor.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationSyncCursor.organizationId],
      references: [organization.id],
    }),
  }),
);

export const integrationEventLogRelations = relations(
  integrationEventLog,
  ({ one }) => ({
    integration: one(organizationIntegration, {
      fields: [integrationEventLog.integrationId],
      references: [organizationIntegration.id],
    }),
    organization: one(organization, {
      fields: [integrationEventLog.organizationId],
      references: [organization.id],
    }),
    run: one(integrationSyncRun, {
      fields: [integrationEventLog.runId],
      references: [integrationSyncRun.id],
    }),
  }),
);

export const customerRelations = relations(customer, ({ one, many }) => ({
  organization: one(organization, {
    fields: [customer.authOrganizationId],
    references: [organization.id],
  }),
  group: one(customerGroup, {
    fields: [customer.groupId],
    references: [customerGroup.id],
  }),
  auditLogs: many(customerAuditLog),
  assets: many(asset),
}));

export const customerGroupRelations = relations(
  customerGroup,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [customerGroup.authOrganizationId],
      references: [organization.id],
    }),
    branches: many(customer),
  }),
);

export const customerAuditLogRelations = relations(
  customerAuditLog,
  ({ one }) => ({
    customer: one(customer, {
      fields: [customerAuditLog.customerId],
      references: [customer.id],
    }),
    performedByUser: one(user, {
      fields: [customerAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// ASSET RELATIONS
// =============================================================================

export const assetTypeRelations = relations(assetType, ({ many }) => ({
  assets: many(asset),
}));

export const assetRelations = relations(asset, ({ one, many }) => ({
  unit: one(organizationUnit, {
    fields: [asset.unitId],
    references: [organizationUnit.id],
  }),
  customer: one(customer, {
    fields: [asset.customerId],
    references: [customer.id],
  }),
  assetType: one(assetType, {
    fields: [asset.assetTypeId],
    references: [assetType.id],
  }),
  auditLogs: many(assetAuditLog),
}));

export const assetAuditLogRelations = relations(assetAuditLog, ({ one }) => ({
  asset: one(asset, {
    fields: [assetAuditLog.assetId],
    references: [asset.id],
  }),
  performedByUser: one(user, {
    fields: [assetAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// CALIBRATION METHOD RELATIONS
// =============================================================================

export const calibrationMethodRelations = relations(
  calibrationMethod,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationMethod.organizationId],
      references: [organization.id],
    }),
    assetType: one(assetType, {
      fields: [calibrationMethod.assetTypeId],
      references: [assetType.id],
    }),
    parent: one(calibrationMethod, {
      fields: [calibrationMethod.parentId],
      references: [calibrationMethod.id],
      relationName: "versionChain",
    }),
    versions: many(calibrationMethod, { relationName: "versionChain" }),
    createdByUser: one(user, {
      fields: [calibrationMethod.createdBy],
      references: [user.id],
      relationName: "methodCreator",
    }),
    technicalReviewedByUser: one(user, {
      fields: [calibrationMethod.technicalReviewedBy],
      references: [user.id],
      relationName: "methodTechnicalReviewer",
    }),
    publishedByUser: one(user, {
      fields: [calibrationMethod.publishedBy],
      references: [user.id],
      relationName: "methodPublisher",
    }),
    approvedByUser: one(user, {
      fields: [calibrationMethod.approvedBy],
      references: [user.id],
      relationName: "methodQualityApprover",
    }),
    auditLogs: many(methodAuditLog),
  }),
);

export const methodAuditLogRelations = relations(methodAuditLog, ({ one }) => ({
  method: one(calibrationMethod, {
    fields: [methodAuditLog.methodId],
    references: [calibrationMethod.id],
  }),
  performedByUser: one(user, {
    fields: [methodAuditLog.performedBy],
    references: [user.id],
  }),
}));

// =============================================================================
// SERVICE RELATIONS
// =============================================================================

export const serviceRelations = relations(service, ({ one, many }) => ({
  organization: one(organization, {
    fields: [service.organizationId],
    references: [organization.id],
  }),
  unit: one(organizationUnit, {
    fields: [service.unitId],
    references: [organizationUnit.id],
  }),
  method: one(calibrationMethod, {
    fields: [service.methodId],
    references: [calibrationMethod.id],
  }),
  assetType: one(assetType, {
    fields: [service.assetTypeId],
    references: [assetType.id],
  }),
  auditLogs: many(serviceAuditLog),
}));

export const serviceAuditLogRelations = relations(
  serviceAuditLog,
  ({ one }) => ({
    service: one(service, {
      fields: [serviceAuditLog.serviceId],
      references: [service.id],
    }),
    performedByUser: one(user, {
      fields: [serviceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const materialRelations = relations(material, ({ one }) => ({
  organization: one(organization, {
    fields: [material.organizationId],
    references: [organization.id],
  }),
  unit: one(organizationUnit, {
    fields: [material.unitId],
    references: [organizationUnit.id],
  }),
}));

// =============================================================================
// REFERENCE STANDARD RELATIONS
// =============================================================================

export const referenceStandardRelations = relations(
  referenceStandard,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [referenceStandard.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [referenceStandard.unitId],
      references: [organizationUnit.id],
    }),
    createdByUser: one(user, {
      fields: [referenceStandard.createdBy],
      references: [user.id],
    }),
    auditLogs: many(referenceStandardAuditLog),
    certificateDocuments: many(referenceStandardCertificateDocument),
  }),
);

export const referenceStandardCertificateDocumentRelations = relations(
  referenceStandardCertificateDocument,
  ({ one }) => ({
    standard: one(referenceStandard, {
      fields: [referenceStandardCertificateDocument.standardId],
      references: [referenceStandard.id],
    }),
    organization: one(organization, {
      fields: [referenceStandardCertificateDocument.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [referenceStandardCertificateDocument.unitId],
      references: [organizationUnit.id],
    }),
    uploadedByUser: one(user, {
      fields: [referenceStandardCertificateDocument.uploadedBy],
      references: [user.id],
    }),
  }),
);

export const referenceStandardAuditLogRelations = relations(
  referenceStandardAuditLog,
  ({ one }) => ({
    standard: one(referenceStandard, {
      fields: [referenceStandardAuditLog.standardId],
      references: [referenceStandard.id],
    }),
    performedByUser: one(user, {
      fields: [referenceStandardAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const serviceOrderEmailLogRelations = relations(
  serviceOrderEmailLog,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderEmailLog.serviceOrderId],
      references: [serviceOrder.id],
    }),
  }),
);

export const serviceOrderEmailOutboxRelations = relations(
  serviceOrderEmailOutbox,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderEmailOutbox.serviceOrderId],
      references: [serviceOrder.id],
    }),
    organization: one(organization, {
      fields: [serviceOrderEmailOutbox.organizationId],
      references: [organization.id],
    }),
  }),
);

// =============================================================================
// CALIBRATION JOB RELATIONS
// =============================================================================

export const calibrationJobRelations = relations(
  calibrationJob,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationJob.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [calibrationJob.unitId],
      references: [organizationUnit.id],
    }),
    customer: one(customer, {
      fields: [calibrationJob.customerId],
      references: [customer.id],
    }),
    asset: one(asset, {
      fields: [calibrationJob.assetId],
      references: [asset.id],
    }),
    service: one(service, {
      fields: [calibrationJob.serviceId],
      references: [service.id],
    }),
    technician: one(user, {
      fields: [calibrationJob.technicianId],
      references: [user.id],
      relationName: "jobTechnician",
    }),
    createdByUser: one(user, {
      fields: [calibrationJob.createdBy],
      references: [user.id],
      relationName: "jobCreator",
    }),
    approvedByUser: one(user, {
      fields: [calibrationJob.approvedBy],
      references: [user.id],
      relationName: "jobApprover",
    }),
    rejectedByUser: one(user, {
      fields: [calibrationJob.rejectedBy],
      references: [user.id],
      relationName: "jobRejecter",
    }),
    auditLogs: many(jobAuditLog),
    issuedCertificateSnapshot: one(issuedCertificateSnapshot, {
      fields: [calibrationJob.id],
      references: [issuedCertificateSnapshot.jobId],
    }),
    // Amendment tracking - ISO 17025:2017 Clause 7.8.8
    // The job that this one supersedes (original certificate being corrected)
    supersedes: one(calibrationJob, {
      fields: [calibrationJob.supersedesId],
      references: [calibrationJob.id],
      relationName: "amendmentChain",
    }),
    // The job that superseded this one (the corrected certificate)
    supersededBy: one(calibrationJob, {
      fields: [calibrationJob.supersededById],
      references: [calibrationJob.id],
      relationName: "amendmentChainReverse",
    }),
  }),
);

export const jobAuditLogRelations = relations(jobAuditLog, ({ one }) => ({
  job: one(calibrationJob, {
    fields: [jobAuditLog.jobId],
    references: [calibrationJob.id],
  }),
  performedByUser: one(user, {
    fields: [jobAuditLog.performedBy],
    references: [user.id],
  }),
}));

export const serviceOrderRelations = relations(
  serviceOrder,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [serviceOrder.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [serviceOrder.unitId],
      references: [organizationUnit.id],
    }),
    customer: one(customer, {
      fields: [serviceOrder.customerId],
      references: [customer.id],
    }),
    asset: one(asset, {
      fields: [serviceOrder.assetId],
      references: [asset.id],
    }),
    openedByUser: one(user, {
      fields: [serviceOrder.openedByUserId],
      references: [user.id],
      relationName: "serviceOrderOpenedBy",
    }),
    responsibleTechnician: one(user, {
      fields: [serviceOrder.responsibleTechnicianId],
      references: [user.id],
      relationName: "serviceOrderResponsibleTechnician",
    }),
    billingDocument: one(billingDocument, {
      fields: [serviceOrder.billingDocumentId],
      references: [billingDocument.id],
    }),
    assetSnapshot: one(serviceOrderAssetSnapshot),
    intakeDocuments: many(serviceOrderIntakeDocument),
    tags: many(serviceOrderTag),
    deliveryDocuments: many(serviceOrderDeliveryDocument),
    evaluations: many(serviceOrderEvaluation),
    quotes: many(serviceOrderQuote),
    execution: one(serviceOrderExecution),
    events: many(serviceOrderEventLog),
    attachments: many(serviceOrderAttachment),
    certificateLinks: many(serviceOrderCertificateLink),
  }),
);

export const serviceOrderAssetSnapshotRelations = relations(
  serviceOrderAssetSnapshot,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderAssetSnapshot.serviceOrderId],
      references: [serviceOrder.id],
    }),
    asset: one(asset, {
      fields: [serviceOrderAssetSnapshot.assetId],
      references: [asset.id],
    }),
  }),
);

export const serviceOrderDeliveryDocumentRelations = relations(
  serviceOrderDeliveryDocument,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderDeliveryDocument.serviceOrderId],
      references: [serviceOrder.id],
    }),
    issuedByUser: one(user, {
      fields: [serviceOrderDeliveryDocument.issuedByUserId],
      references: [user.id],
    }),
  }),
);

export const serviceOrderQuoteRelations = relations(
  serviceOrderQuote,
  ({ one, many }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderQuote.serviceOrderId],
      references: [serviceOrder.id],
    }),
    createdByUser: one(user, {
      fields: [serviceOrderQuote.createdByUserId],
      references: [user.id],
    }),
    items: many(serviceOrderQuoteItem),
  }),
);

export const serviceOrderQuoteItemRelations = relations(
  serviceOrderQuoteItem,
  ({ one }) => ({
    quote: one(serviceOrderQuote, {
      fields: [serviceOrderQuoteItem.quoteId],
      references: [serviceOrderQuote.id],
    }),
  }),
);

export const serviceOrderExecutionRelations = relations(
  serviceOrderExecution,
  ({ one, many }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderExecution.serviceOrderId],
      references: [serviceOrder.id],
    }),
    items: many(serviceOrderExecutionItem),
  }),
);

export const serviceOrderExecutionItemRelations = relations(
  serviceOrderExecutionItem,
  ({ one }) => ({
    execution: one(serviceOrderExecution, {
      fields: [serviceOrderExecutionItem.executionId],
      references: [serviceOrderExecution.id],
    }),
    quoteItem: one(serviceOrderQuoteItem, {
      fields: [serviceOrderExecutionItem.quoteItemId],
      references: [serviceOrderQuoteItem.id],
    }),
  }),
);

export const serviceOrderEventLogRelations = relations(
  serviceOrderEventLog,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderEventLog.serviceOrderId],
      references: [serviceOrder.id],
    }),
    organization: one(organization, {
      fields: [serviceOrderEventLog.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [serviceOrderEventLog.unitId],
      references: [organizationUnit.id],
    }),
  }),
);

export const serviceOrderCertificateLinkRelations = relations(
  serviceOrderCertificateLink,
  ({ one }) => ({
    serviceOrder: one(serviceOrder, {
      fields: [serviceOrderCertificateLink.serviceOrderId],
      references: [serviceOrder.id],
    }),
    certificateJob: one(calibrationJob, {
      fields: [serviceOrderCertificateLink.certificateJobId],
      references: [calibrationJob.id],
    }),
  }),
);

export const calibrationRequestRelations = relations(
  calibrationRequest,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [calibrationRequest.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [calibrationRequest.unitId],
      references: [organizationUnit.id],
    }),
    customer: one(customer, {
      fields: [calibrationRequest.customerId],
      references: [customer.id],
    }),
    authOrganization: one(organization, {
      fields: [calibrationRequest.authOrganizationId],
      references: [organization.id],
      relationName: "calibrationRequestAuthOrganization",
    }),
    submittedByUser: one(user, {
      fields: [calibrationRequest.submittedBy],
      references: [user.id],
      relationName: "calibrationRequestSubmitter",
    }),
    reviewedByUser: one(user, {
      fields: [calibrationRequest.reviewedBy],
      references: [user.id],
      relationName: "calibrationRequestReviewer",
    }),
    approvedByUser: one(user, {
      fields: [calibrationRequest.approvedBy],
      references: [user.id],
      relationName: "calibrationRequestApprover",
    }),
    rejectedByUser: one(user, {
      fields: [calibrationRequest.rejectedBy],
      references: [user.id],
      relationName: "calibrationRequestRejecter",
    }),
    convertedByUser: one(user, {
      fields: [calibrationRequest.convertedBy],
      references: [user.id],
      relationName: "calibrationRequestConverter",
    }),
    items: many(calibrationRequestItem),
    auditLogs: many(calibrationRequestAuditLog),
  }),
);

export const organizationUnitRelations = relations(
  organizationUnit,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [organizationUnit.organizationId],
      references: [organization.id],
    }),
    createdByUser: one(user, {
      fields: [organizationUnit.createdBy],
      references: [user.id],
    }),
    memberAssignments: many(memberUnitAssignment),
    services: many(service),
    standards: many(referenceStandard),
    jobs: many(calibrationJob),
    calibrationRequests: many(calibrationRequest),
    assets: many(asset),
    eventLogs: many(organizationEventLog),
  }),
);

export const calibrationRequestItemRelations = relations(
  calibrationRequestItem,
  ({ one }) => ({
    request: one(calibrationRequest, {
      fields: [calibrationRequestItem.requestId],
      references: [calibrationRequest.id],
    }),
    assetRecord: one(asset, {
      fields: [calibrationRequestItem.assetId],
      references: [asset.id],
    }),
    convertedJob: one(calibrationJob, {
      fields: [calibrationRequestItem.convertedJobId],
      references: [calibrationJob.id],
      relationName: "requestItemConvertedJob",
    }),
  }),
);

export const calibrationRequestAuditLogRelations = relations(
  calibrationRequestAuditLog,
  ({ one }) => ({
    request: one(calibrationRequest, {
      fields: [calibrationRequestAuditLog.requestId],
      references: [calibrationRequest.id],
    }),
    performedByUser: one(user, {
      fields: [calibrationRequestAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const visitRescheduleRequestRelations = relations(
  visitRescheduleRequest,
  ({ one }) => ({
    visit: one(calibrationVisit, {
      fields: [visitRescheduleRequest.visitId],
      references: [calibrationVisit.id],
    }),
    customerRecord: one(customer, {
      fields: [visitRescheduleRequest.customerId],
      references: [customer.id],
    }),
    requestedByUser: one(user, {
      fields: [visitRescheduleRequest.requestedBy],
      references: [user.id],
    }),
    resolvedByUser: one(user, {
      fields: [visitRescheduleRequest.resolvedBy],
      references: [user.id],
    }),
  }),
);

export const visitAuditLogRelations = relations(visitAuditLog, ({ one }) => ({
  visit: one(calibrationVisit, {
    fields: [visitAuditLog.visitId],
    references: [calibrationVisit.id],
  }),
  performedByUser: one(user, {
    fields: [visitAuditLog.performedBy],
    references: [user.id],
  }),
}));

export const environmentalLimitsRelations = relations(
  environmentalLimits,
  ({ one }) => ({
    organization: one(organization, {
      fields: [environmentalLimits.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [environmentalLimits.unitId],
      references: [organizationUnit.id],
    }),
    assetType: one(assetType, {
      fields: [environmentalLimits.assetTypeId],
      references: [assetType.id],
    }),
  }),
);

export const accreditedScopeLineRelations = relations(
  accreditedScopeLine,
  ({ one }) => ({
    organization: one(organization, {
      fields: [accreditedScopeLine.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [accreditedScopeLine.unitId],
      references: [organizationUnit.id],
    }),
  }),
);

export const accreditedScopeLineAuditLogRelations = relations(
  accreditedScopeLineAuditLog,
  ({ one }) => ({
    performedByUser: one(user, {
      fields: [accreditedScopeLineAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

// =============================================================================
// NOTIFICATION RELATIONS
// =============================================================================

export const notificationRelations = relations(notification, ({ one }) => ({
  recipient: one(user, {
    fields: [notification.recipientUserId],
    references: [user.id],
  }),
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id],
  }),
}));

export const notificationPreferenceRelations = relations(
  notificationPreference,
  ({ one }) => ({
    user: one(user, {
      fields: [notificationPreference.userId],
      references: [user.id],
    }),
  }),
);

export const scheduledNotificationRelations = relations(
  scheduledNotification,
  ({ one }) => ({
    organization: one(organization, {
      fields: [scheduledNotification.organizationId],
      references: [organization.id],
    }),
  }),
);

export const organizationSigningCertificateRelations = relations(
  organizationSigningCertificate,
  ({ one }) => ({
    organization: one(organization, {
      fields: [organizationSigningCertificate.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [organizationSigningCertificate.unitId],
      references: [organizationUnit.id],
    }),
    createdByUser: one(user, {
      fields: [organizationSigningCertificate.createdBy],
      references: [user.id],
      relationName: "signingCertCreator",
    }),
    revokedByUser: one(user, {
      fields: [organizationSigningCertificate.revokedBy],
      references: [user.id],
      relationName: "signingCertRevoker",
    }),
  }),
);

export const memberVisualSignatureRelations = relations(
  memberVisualSignature,
  ({ one }) => ({
    member: one(member, {
      fields: [memberVisualSignature.memberId],
      references: [member.id],
    }),
    organization: one(organization, {
      fields: [memberVisualSignature.organizationId],
      references: [organization.id],
    }),
  }),
);

// =============================================================================
// NON-CONFORMANCE & CAPA RELATIONS
// =============================================================================

export const correctiveActionRelations = relations(
  correctiveAction,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [correctiveAction.organizationId],
      references: [organization.id],
    }),
    responsible: one(user, {
      fields: [correctiveAction.responsibleId],
      references: [user.id],
      relationName: "capaResponsible",
    }),
    verifiedByUser: one(user, {
      fields: [correctiveAction.verifiedBy],
      references: [user.id],
      relationName: "capaVerifier",
    }),
    closedByUser: one(user, {
      fields: [correctiveAction.closedBy],
      references: [user.id],
      relationName: "capaCloser",
    }),
    createdByUser: one(user, {
      fields: [correctiveAction.createdBy],
      references: [user.id],
      relationName: "capaCreator",
    }),
    nonConformances: many(nonConformance),
    auditLogs: many(correctiveActionAuditLog),
  }),
);

export const correctiveActionAuditLogRelations = relations(
  correctiveActionAuditLog,
  ({ one }) => ({
    correctiveAction: one(correctiveAction, {
      fields: [correctiveActionAuditLog.capaId],
      references: [correctiveAction.id],
    }),
    performedByUser: one(user, {
      fields: [correctiveActionAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const nonConformanceRelations = relations(
  nonConformance,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [nonConformance.organizationId],
      references: [organization.id],
    }),
    job: one(calibrationJob, {
      fields: [nonConformance.jobId],
      references: [calibrationJob.id],
    }),
    detectedByUser: one(user, {
      fields: [nonConformance.detectedBy],
      references: [user.id],
      relationName: "ncDetector",
    }),
    dispositionApprovedByUser: one(user, {
      fields: [nonConformance.dispositionApprovedBy],
      references: [user.id],
      relationName: "ncDispositionApprover",
    }),
    resolvedByUser: one(user, {
      fields: [nonConformance.resolvedBy],
      references: [user.id],
      relationName: "ncResolver",
    }),
    capa: one(correctiveAction, {
      fields: [nonConformance.capaId],
      references: [correctiveAction.id],
    }),
    createdByUser: one(user, {
      fields: [nonConformance.createdBy],
      references: [user.id],
      relationName: "ncCreator",
    }),
    auditLogs: many(nonConformanceAuditLog),
  }),
);

export const nonConformanceAuditLogRelations = relations(
  nonConformanceAuditLog,
  ({ one }) => ({
    nonConformance: one(nonConformance, {
      fields: [nonConformanceAuditLog.ncId],
      references: [nonConformance.id],
    }),
    performedByUser: one(user, {
      fields: [nonConformanceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const jobStandardRelations = relations(jobStandard, ({ one }) => ({
  job: one(calibrationJob, {
    fields: [jobStandard.jobId],
    references: [calibrationJob.id],
  }),
  standard: one(referenceStandard, {
    fields: [jobStandard.standardId],
    references: [referenceStandard.id],
  }),
}));

export const ootImpactAssessmentRelations = relations(
  ootImpactAssessment,
  ({ one }) => ({
    organization: one(organization, {
      fields: [ootImpactAssessment.organizationId],
      references: [organization.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [ootImpactAssessment.ncId],
      references: [nonConformance.id],
    }),
    signedByUser: one(user, {
      fields: [ootImpactAssessment.signedBy],
      references: [user.id],
      relationName: "ootImpactAssessmentSigner",
    }),
    createdByUser: one(user, {
      fields: [ootImpactAssessment.createdBy],
      references: [user.id],
      relationName: "ootImpactAssessmentCreator",
    }),
  }),
);

export const ootNotificationRelations = relations(
  ootNotification,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [ootNotification.organizationId],
      references: [organization.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [ootNotification.ncId],
      references: [nonConformance.id],
    }),
    job: one(calibrationJob, {
      fields: [ootNotification.jobId],
      references: [calibrationJob.id],
    }),
    approvedByUser: one(user, {
      fields: [ootNotification.approvedBy],
      references: [user.id],
      relationName: "ootNotificationApprover",
    }),
    recall: one(standardRecall, {
      fields: [ootNotification.recallId],
      references: [standardRecall.id],
    }),
    outboxEntries: many(ootEmailOutbox),
  }),
);

export const standardRecallRelations = relations(
  standardRecall,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [standardRecall.organizationId],
      references: [organization.id],
    }),
    standard: one(referenceStandard, {
      fields: [standardRecall.standardId],
      references: [referenceStandard.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [standardRecall.ncId],
      references: [nonConformance.id],
    }),
    approvedByUser: one(user, {
      fields: [standardRecall.approvedBy],
      references: [user.id],
      relationName: "standardRecallApprover",
    }),
    createdByUser: one(user, {
      fields: [standardRecall.createdBy],
      references: [user.id],
      relationName: "standardRecallCreator",
    }),
    notifications: many(ootNotification),
  }),
);

export const ootEmailOutboxRelations = relations(ootEmailOutbox, ({ one }) => ({
  notification: one(ootNotification, {
    fields: [ootEmailOutbox.notificationId],
    references: [ootNotification.id],
  }),
  organization: one(organization, {
    fields: [ootEmailOutbox.organizationId],
    references: [organization.id],
  }),
}));

// =============================================================================
// PERSONNEL COMPETENCE & TRAINING RELATIONS
// =============================================================================

export const personnelCompetenceRelations = relations(
  personnelCompetence,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [personnelCompetence.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [personnelCompetence.userId],
      references: [user.id],
      relationName: "competenceUser",
    }),
    assetType: one(assetType, {
      fields: [personnelCompetence.assetTypeId],
      references: [assetType.id],
    }),
    requestedByUser: one(user, {
      fields: [personnelCompetence.requestedBy],
      references: [user.id],
      relationName: "competenceRequester",
    }),
    evaluatedByUser: one(user, {
      fields: [personnelCompetence.evaluatedBy],
      references: [user.id],
      relationName: "competenceEvaluator",
    }),
    approvedByUser: one(user, {
      fields: [personnelCompetence.approvedBy],
      references: [user.id],
      relationName: "competenceApprover",
    }),
    createdByUser: one(user, {
      fields: [personnelCompetence.createdBy],
      references: [user.id],
      relationName: "competenceCreator",
    }),
    trainingRecords: many(trainingRecord),
    auditLogs: many(personnelCompetenceAuditLog),
  }),
);

export const trainingRecordRelations = relations(
  trainingRecord,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [trainingRecord.organizationId],
      references: [organization.id],
    }),
    user: one(user, {
      fields: [trainingRecord.userId],
      references: [user.id],
      relationName: "trainingUser",
    }),
    competence: one(personnelCompetence, {
      fields: [trainingRecord.competenceId],
      references: [personnelCompetence.id],
    }),
    createdByUser: one(user, {
      fields: [trainingRecord.createdBy],
      references: [user.id],
      relationName: "trainingCreator",
    }),
    auditLogs: many(trainingRecordAuditLog),
  }),
);

export const personnelCompetenceAuditLogRelations = relations(
  personnelCompetenceAuditLog,
  ({ one }) => ({
    competence: one(personnelCompetence, {
      fields: [personnelCompetenceAuditLog.competenceId],
      references: [personnelCompetence.id],
    }),
    performedByUser: one(user, {
      fields: [personnelCompetenceAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const trainingRecordAuditLogRelations = relations(
  trainingRecordAuditLog,
  ({ one }) => ({
    trainingRecord: one(trainingRecord, {
      fields: [trainingRecordAuditLog.trainingRecordId],
      references: [trainingRecord.id],
    }),
    performedByUser: one(user, {
      fields: [trainingRecordAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const proficiencyTestRelations = relations(
  proficiencyTest,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [proficiencyTest.organizationId],
      references: [organization.id],
    }),
    unit: one(organizationUnit, {
      fields: [proficiencyTest.unitId],
      references: [organizationUnit.id],
    }),
    standard: one(referenceStandard, {
      fields: [proficiencyTest.standardId],
      references: [referenceStandard.id],
    }),
    capa: one(correctiveAction, {
      fields: [proficiencyTest.capaId],
      references: [correctiveAction.id],
    }),
    createdByUser: one(user, {
      fields: [proficiencyTest.createdBy],
      references: [user.id],
      relationName: "proficiencyTestCreator",
    }),
    auditLogs: many(proficiencyTestAuditLog),
  }),
);

export const proficiencyTestAuditLogRelations = relations(
  proficiencyTestAuditLog,
  ({ one }) => ({
    proficiencyTest: one(proficiencyTest, {
      fields: [proficiencyTestAuditLog.proficiencyTestId],
      references: [proficiencyTest.id],
    }),
    performedByUser: one(user, {
      fields: [proficiencyTestAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const ptPlanItemRelations = relations(ptPlanItem, ({ one }) => ({
  organization: one(organization, {
    fields: [ptPlanItem.organizationId],
    references: [organization.id],
  }),
  unit: one(organizationUnit, {
    fields: [ptPlanItem.unitId],
    references: [organizationUnit.id],
  }),
  createdByUser: one(user, {
    fields: [ptPlanItem.createdBy],
    references: [user.id],
    relationName: "ptPlanItemCreator",
  }),
}));

export const checkStandardReadingRelations = relations(
  checkStandardReading,
  ({ one }) => ({
    organization: one(organization, {
      fields: [checkStandardReading.organizationId],
      references: [organization.id],
    }),
    standard: one(referenceStandard, {
      fields: [checkStandardReading.standardId],
      references: [referenceStandard.id],
    }),
    createdByUser: one(user, {
      fields: [checkStandardReading.createdBy],
      references: [user.id],
      relationName: "checkStandardReadingCreator",
    }),
  }),
);

export const controlChartRelations = relations(
  controlChart,
  ({ one, many }) => ({
    organization: one(organization, {
      fields: [controlChart.organizationId],
      references: [organization.id],
    }),
    standard: one(referenceStandard, {
      fields: [controlChart.standardId],
      references: [referenceStandard.id],
    }),
    nonConformance: one(nonConformance, {
      fields: [controlChart.ncId],
      references: [nonConformance.id],
    }),
    capa: one(correctiveAction, {
      fields: [controlChart.capaId],
      references: [correctiveAction.id],
    }),
    createdByUser: one(user, {
      fields: [controlChart.createdBy],
      references: [user.id],
      relationName: "controlChartCreator",
    }),
    auditLogs: many(controlChartAuditLog),
  }),
);

export const controlChartAuditLogRelations = relations(
  controlChartAuditLog,
  ({ one }) => ({
    controlChart: one(controlChart, {
      fields: [controlChartAuditLog.controlChartId],
      references: [controlChart.id],
    }),
    performedByUser: one(user, {
      fields: [controlChartAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);

export const assetOotEventRelations = relations(
  assetOotEvent,
  ({ one, many }) => ({
    job: one(calibrationJob, {
      fields: [assetOotEvent.jobId],
      references: [calibrationJob.id],
    }),
    asset: one(asset, {
      fields: [assetOotEvent.assetId],
      references: [asset.id],
    }),
    customer: one(customer, {
      fields: [assetOotEvent.customerId],
      references: [customer.id],
    }),
    labOrganization: one(organization, {
      fields: [assetOotEvent.labOrganizationId],
      references: [organization.id],
    }),
    assessments: many(assetOotImpactAssessment),
  }),
);

export const assetOotImpactAssessmentRelations = relations(
  assetOotImpactAssessment,
  ({ one }) => ({
    event: one(assetOotEvent, {
      fields: [assetOotImpactAssessment.eventId],
      references: [assetOotEvent.id],
    }),
    portalUser: one(user, {
      fields: [assetOotImpactAssessment.portalUserId],
      references: [user.id],
      relationName: "assetOotAssessor",
    }),
  }),
);

export const assetOotAuditLogRelations = relations(
  assetOotAuditLog,
  ({ one }) => ({
    event: one(assetOotEvent, {
      fields: [assetOotAuditLog.eventId],
      references: [assetOotEvent.id],
    }),
    performedByUser: one(user, {
      fields: [assetOotAuditLog.performedBy],
      references: [user.id],
    }),
  }),
);
