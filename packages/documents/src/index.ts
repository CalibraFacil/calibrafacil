export { LabelHtml, type LabelData } from "./LabelHtml.js";
export { renderIntervalReportHtml } from "./IntervalReportHtml.js";
export {
  renderFleetStatusReportHtml,
  classifyFleetDueStatus,
  type FleetStatusAsset,
} from "./FleetStatusReportHtml.js";
export { AccreditationSealSvg } from "@calibra-facil/accreditation-seal";
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
  certificateFooterHtml,
  certificateHeaderHtml,
} from "./certificate/certificate-styles.js";
export type {
  CalibrationCertificateData,
  CertificateResultRow,
  CertificateResultTable,
  CertificateStandard,
} from "./certificate/types.js";
