/**
 * Typed wrapper over the Resend Domains API, parameterized by API key so the
 * same code serves `byok` mode (lab key) today and `managed` mode (platform
 * key) later (issue #584).
 *
 * The Resend SDK resolves with `{ data, error }` instead of throwing on API
 * rejections; network failures DO throw. Both are normalized into the
 * discriminated `ResendDomainsResult` with a `failureClass` the send layer
 * and routes share for fallback decisions.
 */

import { Resend, type DomainStatus } from "resend";

/**
 * How a Resend API failure should be treated by callers:
 *  - invalid_key      → credential is dead (revoked/typo/insufficient scope);
 *                       flip keyStatus and fall back to the platform sender NOW.
 *  - quota_exhausted  → free-tier daily/monthly cap; fall back NOW and flag the
 *                       key as rate_limited so the settings UI can warn the lab.
 *  - rate_limited     → per-second API throttle; fall back NOW, no status flip.
 *  - sender_config    → from-address/domain rejected; fall back NOW, no flip.
 *  - transient        → network/5xx; retry later (the platform send would ride
 *                       the same failing path, so no immediate fallback).
 */
export type ResendFailureClass =
  | "invalid_key"
  | "quota_exhausted"
  | "rate_limited"
  | "sender_config"
  | "transient";

export function classifyResendErrorName(name: string): ResendFailureClass {
  switch (name) {
    case "invalid_api_key":
    case "missing_api_key":
    case "restricted_api_key":
    case "invalid_access":
      return "invalid_key";
    case "daily_quota_exceeded":
    case "monthly_quota_exceeded":
      return "quota_exhausted";
    case "rate_limit_exceeded":
      return "rate_limited";
    case "invalid_from_address":
    case "validation_error":
    case "not_found":
      return "sender_config";
    default:
      return "transient";
  }
}

export interface ResendDomainSummary {
  id: string;
  name: string;
  status: DomainStatus;
}

export interface ResendDomainDetails extends ResendDomainSummary {
  records: Record<string, unknown>[];
}

export type ResendDomainsResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      errorName: string;
      message: string;
      failureClass: ResendFailureClass;
    };

function failure<T>(error: {
  name: string;
  message: string;
}): ResendDomainsResult<T> {
  return {
    ok: false,
    errorName: error.name,
    message: error.message,
    failureClass: classifyResendErrorName(error.name),
  };
}

function thrownFailure<T>(error: unknown): ResendDomainsResult<T> {
  const message =
    error instanceof Error ? error.message : "Unknown Resend transport error";
  return {
    ok: false,
    errorName: "transport_error",
    message,
    failureClass: "transient",
  };
}

function toRecordArray(records: object[]): Record<string, unknown>[] {
  return records.map((record) => Object.fromEntries(Object.entries(record)));
}

/**
 * Create a sending domain in the account that owns `apiKey`.
 *
 * In managed mode that account is ours, so the laboratory never signs up for
 * anything: we create the domain here and hand back the DNS records for it to
 * publish. The returned `records` are Resend's own and we display them
 * verbatim, because inventing or reformatting them is how a lab ends up
 * publishing something that never verifies.
 *
 * `region` is deliberately São Paulo. The mail is Brazilian laboratory to
 * Brazilian customer, and the return path lives under the domain the lab
 * publishes, so keeping the sending region close is free.
 */
export async function createResendDomain(
  apiKey: string,
  hostname: string,
): Promise<ResendDomainsResult<ResendDomainDetails>> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.domains.create({
      name: hostname,
      region: "sa-east-1",
    });
    if (error) return failure(error);
    if (!data) {
      return {
        ok: false,
        errorName: "not_created",
        message: "Resend did not return the created domain",
        failureClass: "sender_config",
      };
    }
    return {
      ok: true,
      data: {
        id: data.id,
        name: data.name,
        status: data.status,
        records: toRecordArray(data.records ?? []),
      },
    };
  } catch (error) {
    return thrownFailure(error);
  }
}

/** List the domains registered in the account that owns `apiKey`. */
export async function listResendDomains(
  apiKey: string,
): Promise<ResendDomainsResult<ResendDomainSummary[]>> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.domains.list();
    if (error) return failure(error);
    const domains = (data?.data ?? []).map((domain) => ({
      id: domain.id,
      name: domain.name,
      status: domain.status,
    }));
    return { ok: true, data: domains };
  } catch (error) {
    return thrownFailure(error);
  }
}

/** Fetch one domain (status + generated DNS records) by Resend domain id. */
export async function getResendDomain(
  apiKey: string,
  domainId: string,
): Promise<ResendDomainsResult<ResendDomainDetails>> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.domains.get(domainId);
    if (error) return failure(error);
    if (!data) {
      return {
        ok: false,
        errorName: "not_found",
        message: "Domain not found",
        failureClass: "sender_config",
      };
    }
    return {
      ok: true,
      data: {
        id: data.id,
        name: data.name,
        status: data.status,
        records: toRecordArray(data.records ?? []),
      },
    };
  } catch (error) {
    return thrownFailure(error);
  }
}

/** Ask Resend to (re-)verify a domain's DNS records. */
export async function verifyResendDomain(
  apiKey: string,
  domainId: string,
): Promise<ResendDomainsResult<{ id: string }>> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.domains.verify(domainId);
    if (error) return failure(error);
    if (!data) {
      return {
        ok: false,
        errorName: "not_found",
        message: "Domain not found",
        failureClass: "sender_config",
      };
    }
    return { ok: true, data: { id: data.id } };
  } catch (error) {
    return thrownFailure(error);
  }
}

/**
 * Live-validate a pasted API key by listing its domains (requires at least
 * domain-read permission — exactly what the BYOK flow needs).
 */
export async function validateResendApiKey(
  apiKey: string,
): Promise<
  | { valid: true; domains: ResendDomainSummary[] }
  | { valid: false; failureClass: ResendFailureClass; message: string }
> {
  const result = await listResendDomains(apiKey);
  if (result.ok) {
    return { valid: true, domains: result.data };
  }
  return {
    valid: false,
    failureClass: result.failureClass,
    message: result.message,
  };
}

/** Delete only a domain whose provider ID belongs to the caller's organization. */
export async function deleteResendDomain(
  apiKey: string,
  domainId: string,
): Promise<ResendDomainsResult<{ id: string }>> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.domains.remove(domainId);
    // A prior attempt may have removed the provider domain before a DB failure.
    if (error?.name === "not_found")
      return { ok: true, data: { id: domainId } };
    if (error) return failure(error);
    if (!data?.deleted) {
      return {
        ok: false,
        errorName: "not_deleted",
        message: "Resend did not confirm domain deletion",
        failureClass: "transient",
      };
    }
    return { ok: true, data: { id: domainId } };
  } catch (error) {
    return thrownFailure(error);
  }
}
