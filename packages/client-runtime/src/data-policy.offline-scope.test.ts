import { describe, expect, it } from "vitest";

import { listCalibraApiPolicyEntries } from "./data-policy";

/**
 * Audit decision Q13 narrows the offline mode to three things:
 *
 * 1. field capture: an assigned job's execution from a read-only pack of
 *    method and standards (readings, environment, attachments), saved as a
 *    draft and submitted (the cloud checks the submit on sync);
 * 2. intake: create a service order or a minimal asset stub;
 * 3. reference reads: customers, assets, standards, the job's method.
 *
 * Everything else is online-only. This list is the contract: adding a local
 * method to the registry without extending Q13 (and this list) fails here.
 */
const Q13_OFFLINE_METHODS = [
  // field capture
  "jobs.list",
  "jobs.get",
  "jobs.listStandards",
  "jobs.getEffectiveEnvironmentalLimits",
  "jobs.saveExecution",
  "jobs.submitExecution",
  "attachments.list",
  "attachments.upload",
  "environmentalLimits.list",
  "standards.listCompositionProfiles",
  // intake
  "serviceOrders.create",
  "assets.create",
  "assetTypes.list",
  // reference reads
  "customers.list",
  "customers.get",
  "assets.list",
  "assets.get",
  "standards.list",
  "standards.get",
  "methods.list",
  "methods.get",
  "serviceOrders.list",
  "serviceOrders.get",
  "serviceOrders.getByPublicId",
  // the sync/conflict machinery that field capture and intake depend on
  "sync.getSession",
  "sync.reconcile",
  "sync.listConflicts",
  "sync.resolveConflict",
  "sync.listDeadEvents",
  "sync.listBlockedEvents",
  "sync.discardDeadEvent",
  "sync.requeueDeadEvent",
] as const;

/** Methods that used to work offline and are online-only since Q13. */
const RECLASSIFIED_TO_CLOUD_ONLY = [
  "dashboard.getStats",
  "customers.create",
  "customers.update",
  "assets.update",
  "services.list",
  "services.get",
  "serviceOrders.createQuote",
  "serviceOrders.saveExecution",
  "serviceOrders.issueDeliveryDocument",
  "nonConformances.create",
] as const;

function qualified(entry: { namespace: string; method: string }) {
  return `${entry.namespace}.${entry.method}`;
}

describe("REQ-OFF-2: the policy registry matches the Q13 offline scope", () => {
  it("makes exactly the Q13 methods available offline", () => {
    const offline = listCalibraApiPolicyEntries()
      .filter((entry) => entry.policy !== "cloud-only")
      .map(qualified)
      .sort();

    expect(offline).toEqual([...Q13_OFFLINE_METHODS].sort());
  });

  it("keeps every reclassified method online-only", () => {
    const policies = new Map(
      listCalibraApiPolicyEntries().map((entry) => [
        qualified(entry),
        entry.policy,
      ]),
    );

    for (const method of RECLASSIFIED_TO_CLOUD_ONLY) {
      expect(policies.get(method), method).toBe("cloud-only");
    }
  });

  it.each([
    "jobs.approve",
    "jobs.reject",
    "jobs.getCertificateDownloadUrl",
    "jobs.amend",
    "jobs.withdrawCertificate",
    "signingCertificates.upload",
    "finance.getOverview",
    "organizationLifecycle.softDelete",
    "methods.create",
    "methods.publishDraft",
    "methods.technicalReview",
    "methods.qualityApprove",
    "methods.returnToDraft",
    "standards.uploadCertificateDocument",
    "standards.getCertificateDocumentDownloadUrl",
    "customers.updateCompliance",
    "capas.create",
    "nonConformances.get",
    "reports.getExecutiveOverview",
    "serviceOrders.deliver",
    "units.updateMemberRole",
  ])(
    "%s is online-only (approval, certificates, signing, finance, settings, authoring, quality)",
    (method) => {
      const entry = listCalibraApiPolicyEntries().find(
        (candidate) => qualified(candidate) === method,
      );

      expect(entry?.policy, method).toBe("cloud-only");
    },
  );

  it("never lists a local write other than field capture and intake", () => {
    const localWrites = listCalibraApiPolicyEntries()
      .filter((entry) => entry.policy === "local-command-sync")
      .map(qualified)
      .sort();

    expect(localWrites).toEqual([
      "assets.create",
      "attachments.upload",
      "jobs.saveExecution",
      "jobs.submitExecution",
      "serviceOrders.create",
    ]);
  });
});
