export { LabelHtml, type LabelData } from "./LabelHtml.js";
export {
  renderIntervalReportHtml,
  type IntervalReportData,
} from "./IntervalReportHtml.js";
export {
  renderFleetStatusReportHtml,
  classifyFleetDueStatus,
  FLEET_DUE_SOON_DAYS,
  type FleetStatusReportData,
  type FleetStatusAsset,
  type FleetDueStatus,
  type FleetStatusClassification,
} from "./FleetStatusReportHtml.js";
export {
  AccreditationSealSvg,
  ACCREDITATION_SEAL_VIEWBOX,
  type AccreditationSealEffect,
  type AccreditationSealProps,
} from "./AccreditationSeal.js";
export {
  ServiceOrderIntakeDocumentHtml,
  ServiceOrderDeliveryReceiptHtml,
  ServiceOrderQuoteHtml,
  ServiceOrderTagHtml,
  type ServiceOrderDeliveryReceiptData,
  type ServiceOrderDocumentData,
  type ServiceOrderQuoteData,
  type ServiceOrderTagData,
} from "./ServiceOrderHtml.js";
export {
  OotNotificationHtml,
  type OotNotificationDocumentData,
} from "./OotNotificationHtml.js";
export { CalibrationCertificateHtml } from "./certificate/CalibrationCertificateHtml.js";
export {
  CERTIFICATE_PAGE_STYLES,
  certificateFooterHtml,
  certificateHeaderHtml,
} from "./certificate/certificate-styles.js";
export type {
  CalibrationCertificateData,
  CertificateConformity,
  CertificateCustomer,
  CertificateDates,
  CertificateEccentricity,
  CertificateEnvironment,
  CertificateItem,
  CertificateLabIdentity,
  CertificateMethod,
  CertificateResultRow,
  CertificateRepeatability,
  CertificateResultTable,
  CertificateSignatory,
  CertificateStandard,
} from "./certificate/types.js";
