/**
 * IP address classification for outbound-request safety. Pure (no `node:*`
 * imports) so the schemas that validate a configured URL at save time and the
 * server-side fetch that re-checks it at call time agree on what "private"
 * means.
 *
 * An address is `public` only when it is a globally routable unicast address.
 * Everything else is refused: loopback, RFC 1918, link-local (cloud metadata
 * lives at 169.254.169.254), carrier-grade NAT, unique-local IPv6, multicast,
 * the unspecified address, documentation and benchmarking ranges, and every
 * IPv6 form that wraps an IPv4 address (mapped, NAT64, 6to4), judged by the
 * IPv4 address it carries.
 */

export type IpFamily = 4 | 6;

export interface ParsedIp {
  readonly family: IpFamily;
  readonly value: bigint;
}

export type IpClassification =
  | { readonly kind: "public" }
  | { readonly kind: "blocked"; readonly reason: string };

const V4_BITS = 32;
const V6_BITS = 128;

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    // Decimal only, no leading zeros: "010" is octal to some parsers and
    // decimal to others, so it is never trusted.
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    value = (value << 8n) | BigInt(octet);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  if (text.includes("%")) return null; // zone ids are never a public target
  const doubleColon = text.indexOf("::");
  if (doubleColon !== text.lastIndexOf("::")) return null;

  const toGroups = (side: string): number[] | null => {
    if (side === "") return [];
    const pieces = side.split(":");
    const groups: number[] = [];
    for (const [index, piece] of pieces.entries()) {
      if (piece.includes(".")) {
        // An embedded IPv4 address closes the address.
        if (index !== pieces.length - 1) return null;
        const v4 = parseIpv4(piece);
        if (v4 === null) return null;
        groups.push(Number(v4 >> 16n), Number(v4 & 0xffffn));
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(piece)) return null;
      groups.push(Number.parseInt(piece, 16));
    }
    return groups;
  };

  let groups: number[];
  if (doubleColon === -1) {
    const all = toGroups(text);
    if (all === null || all.length !== 8) return null;
    groups = all;
  } else {
    const head = toGroups(text.slice(0, doubleColon));
    const tail = toGroups(text.slice(doubleColon + 2));
    if (head === null || tail === null) return null;
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array.from({ length: missing }, () => 0), ...tail];
  }

  let value = 0n;
  for (const group of groups) value = (value << 16n) | BigInt(group);
  return value;
}

/** Parses an IPv4 or IPv6 literal (brackets allowed); `null` when it is neither. */
export function parseIp(text: string): ParsedIp | null {
  const bare =
    text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
  if (bare.includes(":")) {
    const value = parseIpv6(bare);
    return value === null ? null : { family: 6, value };
  }
  const value = parseIpv4(bare);
  return value === null ? null : { family: 4, value };
}

interface Range {
  readonly family: IpFamily;
  readonly base: bigint;
  readonly prefix: number;
  readonly reason: string;
}

function v4Range(cidr: string, reason: string): Range {
  const [address = "", prefix = ""] = cidr.split("/");
  return {
    family: 4,
    base: parseIpv4(address) ?? 0n,
    prefix: Number(prefix),
    reason,
  };
}

function v6Range(cidr: string, reason: string): Range {
  const [address = "", prefix = ""] = cidr.split("/");
  return {
    family: 6,
    base: parseIpv6(address) ?? 0n,
    prefix: Number(prefix),
    reason,
  };
}

function inRange(ip: ParsedIp, range: Range): boolean {
  if (ip.family !== range.family) return false;
  const bits = ip.family === 4 ? V4_BITS : V6_BITS;
  const shift = BigInt(bits - range.prefix);
  return ip.value >> shift === range.base >> shift;
}

const BLOCKED_V4: readonly Range[] = [
  v4Range("0.0.0.0/8", "unspecified / this-network address"),
  v4Range("10.0.0.0/8", "private network (10.0.0.0/8)"),
  v4Range("100.64.0.0/10", "carrier-grade NAT (100.64.0.0/10)"),
  v4Range("127.0.0.0/8", "loopback"),
  v4Range("169.254.0.0/16", "link-local / cloud metadata"),
  v4Range("172.16.0.0/12", "private network (172.16.0.0/12)"),
  v4Range("192.0.0.0/24", "IETF protocol assignments"),
  v4Range("192.0.2.0/24", "documentation range"),
  v4Range("192.88.99.0/24", "6to4 relay anycast"),
  v4Range("192.168.0.0/16", "private network (192.168.0.0/16)"),
  v4Range("198.18.0.0/15", "benchmarking range"),
  v4Range("198.51.100.0/24", "documentation range"),
  v4Range("203.0.113.0/24", "documentation range"),
  v4Range("224.0.0.0/4", "multicast"),
  v4Range("240.0.0.0/4", "reserved / broadcast"),
];

const BLOCKED_V6: readonly Range[] = [
  v6Range("::/128", "unspecified address"),
  v6Range("::1/128", "loopback"),
  v6Range("100::/64", "discard-only range"),
  v6Range("2001::/23", "IETF protocol assignments / Teredo"),
  v6Range("2001:db8::/32", "documentation range"),
  v6Range("3fff::/20", "documentation range"),
  v6Range("fc00::/7", "unique-local network (fc00::/7)"),
  v6Range("fe80::/10", "link-local"),
  v6Range("fec0::/10", "site-local (deprecated)"),
  v6Range("ff00::/8", "multicast"),
];

const V6_MAPPED = v6Range("::ffff:0:0/96", "IPv4-mapped");
const V6_NAT64 = v6Range("64:ff9b::/96", "NAT64");
const V6_6TO4 = v6Range("2002::/16", "6to4");
const V6_IPV4_COMPATIBLE = v6Range("::/96", "IPv4-compatible");
const V6_GLOBAL_UNICAST = v6Range("2000::/3", "global unicast");

function low32(value: bigint): ParsedIp {
  return { family: 4, value: value & 0xffff_ffffn };
}

/** Classifies a parsed address. See the module comment for the policy. */
export function classifyParsedIp(ip: ParsedIp): IpClassification {
  if (ip.family === 4) {
    const hit = BLOCKED_V4.find((range) => inRange(ip, range));
    return hit ? { kind: "blocked", reason: hit.reason } : { kind: "public" };
  }

  // Wrapped IPv4: the address behind the wrapper decides.
  if (inRange(ip, V6_MAPPED) || inRange(ip, V6_NAT64)) {
    const inner = classifyParsedIp(low32(ip.value));
    return inner.kind === "public"
      ? inner
      : { kind: "blocked", reason: `IPv6-wrapped ${inner.reason}` };
  }
  if (inRange(ip, V6_6TO4)) {
    const inner = classifyParsedIp(low32(ip.value >> 80n));
    return inner.kind === "public"
      ? inner
      : { kind: "blocked", reason: `6to4-wrapped ${inner.reason}` };
  }
  const hit = BLOCKED_V6.find((range) => inRange(ip, range));
  if (hit) return { kind: "blocked", reason: hit.reason };
  if (inRange(ip, V6_IPV4_COMPATIBLE)) {
    return { kind: "blocked", reason: "IPv4-compatible address" };
  }
  if (!inRange(ip, V6_GLOBAL_UNICAST)) {
    return { kind: "blocked", reason: "not a global unicast address" };
  }
  return { kind: "public" };
}

/**
 * Classifies an IP literal. A string that is not an IP address is blocked: a
 * resolver that hands back something unparseable is never trusted.
 */
export function classifyIp(address: string): IpClassification {
  const parsed = parseIp(address);
  if (!parsed) return { kind: "blocked", reason: "not a valid IP address" };
  return classifyParsedIp(parsed);
}

export interface ParsedCidr {
  readonly family: IpFamily;
  readonly base: bigint;
  readonly prefix: number;
}

/** `10.0.0.0/24`, `fd00::/8`, or a bare address (a /32 or /128). Else `null`. */
export function parseCidr(text: string): ParsedCidr | null {
  const [address = "", prefixText, ...rest] = text.split("/");
  if (rest.length > 0) return null;
  const ip = parseIp(address);
  if (!ip) return null;
  const max = ip.family === 4 ? V4_BITS : V6_BITS;
  let prefix = max;
  if (prefixText !== undefined) {
    if (!/^\d{1,3}$/.test(prefixText)) return null;
    prefix = Number(prefixText);
    if (prefix > max) return null;
  }
  const shift = BigInt(max - prefix);
  return { family: ip.family, base: (ip.value >> shift) << shift, prefix };
}

export function isIpInCidr(ip: ParsedIp, cidr: ParsedCidr): boolean {
  if (ip.family !== cidr.family) return false;
  const max = ip.family === 4 ? V4_BITS : V6_BITS;
  const shift = BigInt(max - cidr.prefix);
  return ip.value >> shift === cidr.base >> shift;
}

/**
 * The IPv4 address an IPv6 address wraps (`::ffff:a.b.c.d`, NAT64, 6to4), so an
 * allowlist written for `10.0.0.0/24` also covers `::ffff:10.0.0.5`.
 */
export function unwrapIpv4(ip: ParsedIp): ParsedIp | null {
  if (ip.family === 4) return null;
  if (inRange(ip, V6_MAPPED) || inRange(ip, V6_NAT64)) return low32(ip.value);
  if (inRange(ip, V6_6TO4)) return low32(ip.value >> 80n);
  return null;
}
