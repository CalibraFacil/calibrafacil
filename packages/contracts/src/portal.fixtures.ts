import type {
  InvitationLookupResponse,
  MagicLinkPreviewResponse,
  SignatureVerificationResponse,
  VerificationMatchResponse,
  VerificationResponse,
} from "./public-access";
import type {
  PortalAuditPack,
  PortalAuditPackRequestedResponse,
  PortalAuditPacksResponse,
  PortalCertificateDetail,
  PortalCertificateListItem,
  PortalCertificatesResponse,
  PortalDownloadLinkResponse,
} from "./portal-certificates";
import type {
  PortalFinancialSummary,
  PortalNotificationFeedResponse,
  PortalNotificationPreferencesResponse,
  PortalOotNotificationsResponse,
  PortalRequestBatchResponse,
  PortalRequestDetail,
  PortalRequestsResponse,
  PortalServiceOrderDetail,
  PortalServiceOrdersResponse,
  PortalVisit,
  PortalVisitsResponse,
} from "./portal-engagement";
import type {
  PortalAssetDetail,
  PortalBrandingResponse,
  PortalCalendarResponse,
  PortalFleetAsset,
  PortalFleetAssetsResponse,
  PortalIntervalInsight,
  PortalOrganizationsResponse,
  PortalUnitsResponse,
  PortalUnitsSummaryResponse,
} from "./portal-fleet";
import type {
  PortalDriftSeriesResponse,
  PortalFleetAnalyticsResponse,
  PortalOotEvent,
  PortalOotEventsResponse,
} from "./portal-reliability";

/**
 * Contract-valid example payloads for the client-portal endpoints, for the
 * portal's unit tests (which run the response check strictly). Same rules as
 * `jobs.fixtures.ts`: values mirror what the handlers return, a test needing a
 * variation passes overrides, and `portal.fixtures.test.ts` parses every
 * builder against its schema so a fixture cannot drift from its contract.
 */

const NOW = "2026-06-15T12:00:00.000Z";

export function buildPortalBranding(
  overrides: Partial<PortalBrandingResponse> = {},
): PortalBrandingResponse {
  return { name: "Laboratório Exemplo", logo: null, ...overrides };
}

export function buildPortalOrganizations(): PortalOrganizationsResponse {
  return [
    {
      id: "org-a",
      name: "Cliente A",
      slug: "cliente-a",
      logo: null,
      type: "CLIENT",
      createdAt: "2026-01-01T00:00:00.000Z",
      memberRole: "CLIENT_ADMIN",
      kind: "unit",
    },
  ];
}

export function buildPortalUnits(): PortalUnitsResponse {
  return { mode: "single", units: [{ id: 1, name: "Matriz" }] };
}

export function buildPortalUnitsSummary(): PortalUnitsSummaryResponse {
  return {
    mode: "single",
    units: [{ id: 1, name: "Matriz", total: 10, overdue: 1, dueSoon: 2 }],
  };
}

export function buildPortalCalendar(): PortalCalendarResponse {
  return {
    data: [
      {
        id: 1,
        publicId: "AST-0001",
        name: "Balança A",
        tag: "EQ-A1",
        assetTypeName: "Balança",
        nextCalibrationDate: "2026-10-15T00:00:00.000Z",
        inLab: false,
        customerId: 4,
        customerName: "Cliente A",
      },
    ],
  };
}

export function buildPortalFleetAsset(
  overrides: Partial<PortalFleetAsset> = {},
): PortalFleetAsset {
  return {
    id: 1,
    publicId: "AST-0001",
    customerId: 4,
    customerName: "Cliente A",
    assetTypeId: 2,
    assetTypeName: "Balança",
    assetTypeSlug: "balanca",
    name: "Balança A",
    manufacturer: "Marca",
    model: "M1",
    serialNumber: "SN-A1",
    tag: "EQ-A1",
    status: "ACTIVE",
    specifications: null,
    lastCalibrationDate: "2026-01-10T00:00:00.000Z",
    nextCalibrationDate: "2027-01-10T00:00:00.000Z",
    inLab: false,
    lastCertificate: { id: 7, jobId: "CAL-0007", approvedAt: NOW },
    comments: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function buildPortalFleetAssetsResponse(
  data: PortalFleetAsset[] = [buildPortalFleetAsset()],
): PortalFleetAssetsResponse {
  return {
    data,
    pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 },
  };
}

export function buildPortalAssetDetail(
  overrides: Partial<PortalAssetDetail> = {},
): PortalAssetDetail {
  const { lastCertificate: _lastCertificate, ...fleet } =
    buildPortalFleetAsset();
  return {
    ...fleet,
    calibrationIntervalMonths: 12,
    intervalSetBy: "customer_confirmed",
    metrologyRegime: "INDUSTRIAL",
    regulatedInterval: null,
    nextLegalVerificationDate: null,
    certificates: [
      {
        id: 7,
        jobId: "CAL-0007",
        certificateName: null,
        status: "APPROVED",
        performedAt: NOW,
        approvedAt: NOW,
        certificateUrl: "/certificates/7.pdf",
        verificationToken: "6f1c1d1e-0000-4000-8000-000000000001",
        serviceName: "Calibração de massa",
        labName: "Laboratório Exemplo",
      },
    ],
    certificateCount: 1,
    ...overrides,
  };
}

export function buildPortalIntervalInsight(
  overrides: Partial<PortalIntervalInsight> = {},
): PortalIntervalInsight {
  return {
    classification: "STABLE",
    reliability: 0.95,
    coverage: 1,
    recommendation: {
      action: "extend",
      method: "S2",
      proposedIntervalMonths: 18,
      reliabilityBound: 0.9,
    },
    series: [{ approvedAt: NOW, conformity: "CONFORMING", minMargin: 0.4 }],
    engineVersion: "1.0.0",
    fingerprint: "fp-1",
    ...overrides,
  };
}

export function buildPortalCertificateListItem(
  overrides: Partial<PortalCertificateListItem> = {},
): PortalCertificateListItem {
  return {
    id: 7,
    jobId: "CAL-0007",
    certificateName: null,
    status: "APPROVED",
    performedAt: NOW,
    approvedAt: NOW,
    certificateUrl: "/certificates/7.pdf",
    verificationToken: "6f1c1d1e-0000-4000-8000-000000000001",
    amendmentNumber: null,
    assetId: 1,
    assetPublicId: "AST-0001",
    assetName: "Balança A",
    assetTag: "EQ-A1",
    assetManufacturer: null,
    assetModel: null,
    assetSerialNumber: "SN-A1",
    serviceName: "Calibração de massa",
    labName: "Laboratório Exemplo",
    releaseStatus: "RELEASED",
    certificateStatus: "ISSUED",
    withdrawnAt: null,
    isSuperseded: false,
    isAmendment: false,
    ...overrides,
  };
}

export function buildPortalCertificatesResponse(
  data: PortalCertificateListItem[] = [buildPortalCertificateListItem()],
): PortalCertificatesResponse {
  return {
    data,
    pagination: { page: 1, limit: 20, total: data.length, totalPages: 1 },
  };
}

export function buildPortalCertificateDetail(
  overrides: Partial<PortalCertificateDetail> = {},
): PortalCertificateDetail {
  return {
    id: 7,
    jobId: "CAL-0007",
    status: "APPROVED",
    performedAt: NOW,
    approvedAt: NOW,
    dueDate: "2027-01-10T00:00:00.000Z",
    certificateUrl: "/certificates/7.pdf",
    releaseStatus: "RELEASED",
    certificateStatus: "ISSUED",
    withdrawnAt: null,
    verificationToken: "6f1c1d1e-0000-4000-8000-000000000001",
    verdict: {
      conformity: "CONFORMING",
      pointsTotal: 4,
      pointsWithin: 4,
      expandedUncertainty: "0,01 g",
    },
    methodSnapshot: {
      methodName: "Método de massa",
      methodVersion: 2,
      formulas: [{ outputKey: "erro", label: "Erro", unit: "g" }],
    },
    results: { erro: 0.01 },
    assetId: 1,
    assetPublicId: "AST-0001",
    assetName: "Balança A",
    assetTag: "EQ-A1",
    assetManufacturer: null,
    assetModel: null,
    assetSerialNumber: "SN-A1",
    serviceName: "Calibração de massa",
    labName: "Laboratório Exemplo",
    labLogo: null,
    labEmail: null,
    labPhone: null,
    accreditation: { accredited: false, number: null },
    amendment: null,
    onSite: { executedOnSite: false, addressText: null },
    referenceStandards: [],
    ...overrides,
  };
}

export function buildPortalDownloadLink(): PortalDownloadLinkResponse {
  return {
    url: "https://signed-download.example.test/certificates/7.pdf",
    filename: "certificado-7.pdf",
  };
}

export function buildPortalAuditPack(
  overrides: Partial<PortalAuditPack> = {},
): PortalAuditPack {
  return {
    id: 3,
    status: "COMPLETED",
    dateFrom: "2026-01-01",
    dateTo: "2026-06-30",
    unitId: null,
    unitName: null,
    include: { certificates: true, fleetReport: true, verificationIndex: true },
    certificateCount: 12,
    fileSizeBytes: 2048,
    expiresAt: "2026-07-15T12:00:00.000Z",
    expired: false,
    completedAt: NOW,
    createdAt: NOW,
    ...overrides,
  };
}

export function buildPortalAuditPacksResponse(): PortalAuditPacksResponse {
  return { data: [buildPortalAuditPack()] };
}

export function buildPortalAuditPackRequested(): PortalAuditPackRequestedResponse {
  return { id: 4, status: "PENDING" };
}

export function buildPortalNotificationFeed(): PortalNotificationFeedResponse {
  return {
    data: [
      {
        id: 1,
        type: "CERTIFICATE_READY",
        priority: "MEDIUM",
        status: "UNREAD",
        title: "Certificado disponível",
        message: "O certificado CAL-0007 está disponível.",
        actionUrl: "/certificates/CAL-0007",
        createdAt: NOW,
        readAt: null,
      },
    ],
    nextCursor: null,
  };
}

export function buildPortalNotificationPreferences(): PortalNotificationPreferencesResponse {
  return {
    digestFrequency: "NONE",
    emailEnabled: true,
    preferences: { CERTIFICATE_READY: { inApp: true, email: true } },
  };
}

export function buildPortalOotNotifications(): PortalOotNotificationsResponse {
  return {
    data: [
      {
        id: "ack-token-1",
        ncNumber: "NC-2026-0001",
        certificateNumber: "CAL-0007",
        affectedScope: null,
        status: "SENT",
        sentAt: NOW,
        acknowledgedAt: null,
        acknowledgedVia: null,
        createdAt: NOW,
        assetName: "Balança A",
        assetTag: "EQ-A1",
        unitName: "Matriz",
      },
    ],
    counts: { total: 1, pending: 1 },
  };
}

export function buildPortalVisit(
  overrides: Partial<PortalVisit> = {},
): PortalVisit {
  return {
    id: 9,
    status: "PROPOSED",
    scheduledAt: "2026-12-01T13:00:00.000Z",
    scheduledEndAt: null,
    address: null,
    customerName: "Cliente A",
    technicianName: "Ana",
    sourceRequestId: null,
    cancelReason: null,
    assetCount: 2,
    customerConfirmedAt: null,
    rescheduleRequest: null,
    ...overrides,
  };
}

export function buildPortalVisitsResponse(): PortalVisitsResponse {
  return { data: [buildPortalVisit()] };
}

export function buildPortalRequestsResponse(): PortalRequestsResponse {
  return {
    data: [
      {
        id: 12,
        status: "PENDING",
        observations: null,
        requestedDueDate: null,
        submittedAt: NOW,
        reviewedAt: null,
        approvedAt: null,
        convertedAt: null,
        customerName: "Cliente A",
        itemCount: 2,
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };
}

export function buildPortalRequestDetail(
  overrides: Partial<PortalRequestDetail> = {},
): PortalRequestDetail {
  return {
    id: 12,
    status: "PENDING",
    observations: null,
    requestedDueDate: null,
    deliveryMethod: "dropoff",
    invoiceRemittanceNumber: null,
    invoiceRemittanceKey: null,
    invoiceRemittanceIssuedAt: null,
    carrierName: null,
    onsiteAddress: null,
    preferredVisitDate: null,
    visit: null,
    submittedAt: NOW,
    reviewedAt: null,
    approvedAt: null,
    rejectedAt: null,
    rejectionReason: null,
    convertedAt: null,
    customerName: "Cliente A",
    items: [
      {
        id: 1,
        assetId: 1,
        assetName: "Balança A",
        assetTag: "EQ-A1",
        assetSerialNumber: "SN-A1",
        assetManufacturer: null,
        assetModel: null,
        assetTypeName: "Balança",
        convertedJobId: null,
        convertedJobCode: null,
        convertedJobStatus: null,
        convertedServiceName: null,
      },
    ],
    ...overrides,
  };
}

export function buildPortalRequestBatch(): PortalRequestBatchResponse {
  return {
    created: [
      { id: 12, status: "PENDING", customerId: 4, unitId: 1, itemCount: 2 },
    ],
  };
}

export function buildPortalServiceOrdersResponse(): PortalServiceOrdersResponse {
  return {
    data: [
      {
        id: 50,
        publicId: "so_abc",
        serviceOrderNumber: "OS-2026-0001",
        status: "awaiting_quote_approval",
        statusLabel: "Aguardando aprovação",
        openedAt: NOW,
        readyAt: null,
        assetName: "Balança A",
        assetSerialNumber: "SN-A1",
      },
    ],
    pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };
}

export function buildPortalServiceOrderDetail(
  overrides: Partial<PortalServiceOrderDetail> = {},
): PortalServiceOrderDetail {
  return {
    id: 50,
    serviceOrderNumber: "OS-2026-0001",
    status: "awaiting_quote_approval",
    openedAt: NOW,
    claimedDefect: "Display apagado",
    intakeCondition: "Sem avarias aparentes",
    accessories: null,
    clientVisibleNotes: null,
    evaluations: [],
    execution: null,
    quotes: [
      {
        id: 3,
        quoteNumber: "ORC-1",
        version: 1,
        status: "SENT",
        totalCents: 15000,
        validUntil: null,
        clientMessage: null,
        warrantyTerms: null,
        items: [],
      },
    ],
    ...overrides,
  };
}

export function buildPortalFinancialSummary(
  overrides: Partial<PortalFinancialSummary> = {},
): PortalFinancialSummary {
  return {
    state: "PAYMENT_PENDING",
    visible: true,
    dueDate: "2026-07-10T00:00:00.000Z",
    paidAt: null,
    openAmountCents: 15000,
    overdueAmountCents: 0,
    lastUpdatedAt: NOW,
    freshness: "fresh",
    documents: [
      { kind: "invoice", label: "Fatura", availableAt: NOW, href: null },
    ],
    ...overrides,
  };
}

export function buildPortalFleetAnalytics(
  overrides: Partial<PortalFleetAnalyticsResponse> = {},
): PortalFleetAnalyticsResponse {
  const rates = {
    jobs: 6,
    known: 5,
    conforming: 4,
    nonConforming: 1,
    unknown: 1,
    ootRatePct: 20,
    coveragePct: 83,
  };
  return {
    mode: "single",
    period: {
      from: "2024-07-01T00:00:00.000Z",
      to: "2026-07-01T00:00:00.000Z",
      bucket: "quarter",
    },
    totals: rates,
    legalExcluded: 0,
    trend: [{ bucket: "2026-T1", ...rates }],
    byAssetType: [],
    worstOffenders: [],
    attribution: "Pareceres do laboratório.",
    ...overrides,
  };
}

export function buildPortalDriftSeries(): PortalDriftSeriesResponse {
  return {
    assetId: 1,
    cycles: [{ approvedAt: NOW, conformity: "CONFORMING", minMargin: 0.4 }],
    points: [],
    coverage: { totalCycles: 1, cyclesWithMargins: 1 },
    attribution: "Margens conforme o certificado.",
  };
}

export function buildPortalOotEvent(
  overrides: Partial<PortalOotEvent> = {},
): PortalOotEvent {
  return {
    id: 1,
    status: "OPEN",
    detectedAt: NOW,
    customerId: 4,
    assetId: 5,
    assetPublicId: "AST-0005",
    assetTag: "MAN-001",
    assetName: "Manômetro linha 2",
    jobId: 99,
    jobIdentifier: "CAL-2026-0099",
    suggestedPeriodStart: "2026-01-10T12:00:00.000Z",
    assessmentDecision: null,
    assessmentRationale: null,
    assessmentPeriodStart: null,
    assessmentPeriodEnd: null,
    assessmentSuspectShipped: null,
    assessmentCustomerNotified: null,
    assessmentCreatedAt: null,
    assessmentBy: null,
    ...overrides,
  };
}

export function buildPortalOotEventsResponse(
  data: PortalOotEvent[] = [buildPortalOotEvent()],
): PortalOotEventsResponse {
  return { data };
}

export function buildVerificationResponse(
  overrides: Partial<VerificationResponse> = {},
): VerificationResponse {
  return {
    valid: true,
    certificateStatus: "ISSUED",
    withdrawnAt: null,
    jobId: "CAL-0007",
    status: "APPROVED",
    hasDocument: true,
    lab: "Laboratório Exemplo",
    accreditation: { accredited: false, number: null },
    customer: "Cliente A",
    asset: { name: "Balança A", tag: "EQ-A1" },
    service: "Calibração de massa",
    performedAt: NOW,
    approvedAt: NOW,
    digitalSignature: { signed: false },
    isSuperseded: false,
    isAmendment: false,
    amendmentNumber: null,
    amendmentReason: null,
    supersededAt: null,
    supersededBy: null,
    supersedes: null,
    ...overrides,
  };
}

export function buildSignatureVerification(): SignatureVerificationResponse {
  return { signed: false, source: null, computedAt: null, verdict: null };
}

export function buildVerificationMatch(): VerificationMatchResponse {
  return {
    match: true,
    expectedSha256: "a".repeat(64),
    uploadedSha256: "a".repeat(64),
    uploadedVerdict: {
      hashMatch: true,
      signatureCryptographicallyValid: true,
      chainValid: true,
      signerChainsToIcpRoot: true,
      certNotExpiredAtCheckDate: true,
      signaturePresent: true,
      signer: { commonName: "Lab", cpfCnpj: null, certificateSerial: null },
      overall: "VALID",
      details: [],
    },
  };
}

export function buildInvitationLookup(): InvitationLookupResponse {
  return {
    id: "inv-1",
    email: "ana@cliente.test",
    role: "client_admin",
    status: "pending",
    expiresAt: "2026-12-01T00:00:00.000Z",
    organizationId: "org-a",
    organizationName: "Cliente A",
    organizationSlug: "cliente-a",
    inviterEmail: "lab@lab.test",
  };
}

export function buildMagicLinkPreview(): MagicLinkPreviewResponse {
  return {
    found: true,
    name: "Ana",
    email: "ana@cliente.test",
    image: null,
    organizationName: "Cliente A",
    organizationLogo: null,
  };
}
