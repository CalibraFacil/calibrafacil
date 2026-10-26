import { readOutboundConfig, readRuntimeConfig } from "@calibra-facil/config";
import {
  classifyParsedIp,
  isIpInCidr,
  parseCidr,
  parseIp,
  unwrapIpv4,
  type ParsedCidr,
} from "./ip-range";

/**
 * What the server may call when a laboratory configures a URL (webhooks, ERP
 * integrations). See `safeOutboundFetch`.
 */
export interface OutboundPolicy {
  /** `http:` targets allowed. Always on outside production. */
  readonly allowInsecureHttp: boolean;
  /** Exact host names the operator deliberately allows to resolve privately. */
  readonly allowedHosts: readonly string[];
  /** `*.suffix` wildcards, stored as `.suffix`. */
  readonly allowedHostSuffixes: readonly string[];
  /** IP literals and CIDR ranges the operator deliberately allows. */
  readonly allowedRanges: readonly ParsedCidr[];
}

export interface OutboundPolicyInput {
  readonly allowInsecureHttp?: boolean;
  /** The `OUTBOUND_ALLOW_PRIVATE_HOSTS` entries. */
  readonly allowPrivateHosts?: readonly string[];
}

/** Lower-cases a host and drops the trailing dot and the IPv6 brackets. */
export function normalizeHostname(hostname: string): string {
  const lower = hostname.trim().toLowerCase();
  const unbracketed =
    lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  return unbracketed.endsWith(".") ? unbracketed.slice(0, -1) : unbracketed;
}

/**
 * Builds a policy from the operator's allow list. An entry that is neither a
 * host name, a `*.suffix` wildcard, an IP address nor a CIDR range is ignored
 * (the policy only ever gets stricter) and reported through `onInvalidEntry`.
 */
export function buildOutboundPolicy(
  input: OutboundPolicyInput = {},
  onInvalidEntry: (entry: string) => void = () => {},
): OutboundPolicy {
  const allowedHosts: string[] = [];
  const allowedHostSuffixes: string[] = [];
  const allowedRanges: ParsedCidr[] = [];

  for (const raw of input.allowPrivateHosts ?? []) {
    const entry = normalizeHostname(raw);
    if (entry === "") continue;
    if (entry.startsWith("*.")) {
      const suffix = entry.slice(1);
      if (/^\.[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(suffix)) {
        allowedHostSuffixes.push(suffix);
      } else {
        onInvalidEntry(raw);
      }
      continue;
    }
    const range = parseCidr(entry);
    if (range) {
      allowedRanges.push(range);
      continue;
    }
    if (
      /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(entry) &&
      !/^[\d.]+$/.test(entry)
    ) {
      allowedHosts.push(entry);
      continue;
    }
    onInvalidEntry(raw);
  }

  return {
    allowInsecureHttp: input.allowInsecureHttp ?? false,
    allowedHosts,
    allowedHostSuffixes,
    allowedRanges,
  };
}

/** The policy of this deployment, from `OUTBOUND_*` and `NODE_ENV`. */
export function readOutboundPolicy(): OutboundPolicy {
  const config = readOutboundConfig();
  return buildOutboundPolicy(
    {
      allowInsecureHttp:
        config.allowInsecureHttp || !readRuntimeConfig().isProduction,
      allowPrivateHosts: config.allowPrivateHosts,
    },
    (entry) => {
      console.warn(
        `[outbound] ignoring unusable OUTBOUND_ALLOW_PRIVATE_HOSTS entry ${JSON.stringify(entry)}`,
      );
    },
  );
}

/** Whether the operator allowed this host name (or IP literal) outright. */
export function isHostAllowed(
  policy: OutboundPolicy,
  hostname: string,
): boolean {
  const host = normalizeHostname(hostname);
  if (policy.allowedHosts.includes(host)) return true;
  if (policy.allowedHostSuffixes.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  const ip = parseIp(host);
  return ip ? isAddressInAllowedRanges(policy, ip) : false;
}

function isAddressInAllowedRanges(
  policy: OutboundPolicy,
  ip: NonNullable<ReturnType<typeof parseIp>>,
): boolean {
  const inner = unwrapIpv4(ip);
  return policy.allowedRanges.some(
    (range) =>
      isIpInCidr(ip, range) || (inner !== null && isIpInCidr(inner, range)),
  );
}

export type OutboundAddressVerdict =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Whether a resolved address of `hostname` may be connected to: public
 * addresses always, a private one only when the operator allowed the host or a
 * range that contains it.
 */
export function judgeOutboundAddress(
  policy: OutboundPolicy,
  hostname: string,
  address: string,
): OutboundAddressVerdict {
  const ip = parseIp(address);
  if (!ip) return { allowed: false, reason: "not a valid IP address" };
  const classification = classifyParsedIp(ip);
  if (classification.kind === "public") return { allowed: true };
  if (isHostAllowed(policy, hostname) || isAddressInAllowedRanges(policy, ip)) {
    return { allowed: true };
  }
  return { allowed: false, reason: classification.reason };
}

export type OutboundUrlCheck =
  | { readonly ok: true; readonly url: URL }
  | {
      readonly ok: false;
      /** `blocked_address`: the host is a refused address; else the URL is unusable. */
      readonly code: "invalid_url" | "blocked_address";
      /** Safe to show the caller. */
      readonly reason: string;
      /** For the server log only: the class of address refused. */
      readonly detail?: string;
    };

/**
 * The checks that need no network: scheme, credentials, and a host that is an
 * IP literal in a refused range (or `localhost`). A host NAME is only judged
 * once it resolves, at call time. Used at save time (so a laboratory gets the
 * error when it configures the URL) and again at the start of every call.
 */
export function checkOutboundUrl(
  value: string | URL,
  policy: OutboundPolicy,
): OutboundUrlCheck {
  let url: URL;
  try {
    url = typeof value === "string" ? new URL(value) : new URL(value.href);
  } catch {
    return { ok: false, code: "invalid_url", reason: "URL inválida" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return {
      ok: false,
      code: "invalid_url",
      reason: "Somente URLs http(s) são permitidas",
    };
  }
  if (url.protocol === "http:" && !policy.allowInsecureHttp) {
    return { ok: false, code: "invalid_url", reason: "A URL deve usar https" };
  }
  if (url.username !== "" || url.password !== "") {
    return {
      ok: false,
      code: "invalid_url",
      reason: "A URL não pode conter credenciais",
    };
  }
  const host = normalizeHostname(url.hostname);
  if (host === "")
    return { ok: false, code: "invalid_url", reason: "URL sem host" };

  const ip = parseIp(host);
  if (ip) {
    const verdict = judgeOutboundAddress(policy, host, host);
    if (!verdict.allowed) {
      return {
        ok: false,
        code: "blocked_address",
        reason: "Endereço não permitido",
        detail: verdict.reason,
      };
    }
  } else if (
    (host === "localhost" || host.endsWith(".localhost")) &&
    !isHostAllowed(policy, host)
  ) {
    return {
      ok: false,
      code: "blocked_address",
      reason: "Endereço não permitido",
      detail: "loopback",
    };
  }
  return { ok: true, url };
}
