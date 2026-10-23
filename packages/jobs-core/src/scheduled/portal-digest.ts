import {
  sendPortalDueDigests,
  type PortalDigestRunResult,
} from "@calibra-facil/notifications";

/**
 * Client-portal due-calibration digest (PORTAL_DIGEST background job).
 * All selection and sending lives in @calibra-facil/notifications; the worker
 * just provides the runtime (process.env carries DATABASE_URL + Resend keys,
 * exactly like the notify* calls above).
 */
export async function processPortalDigest(): Promise<PortalDigestRunResult> {
  return sendPortalDueDigests();
}
