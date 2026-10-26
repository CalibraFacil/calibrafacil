import { describe, expect, it } from "vitest";
import {
  classifyIp,
  isIpInCidr,
  parseCidr,
  parseIp,
  unwrapIpv4,
} from "./ip-range";

function blocked(address: string) {
  const verdict = classifyIp(address);
  return verdict.kind === "blocked";
}

describe("classifyIp: IPv4", () => {
  it.each([
    ["0.0.0.0", "unspecified"],
    ["0.1.2.3", "this-network 0/8"],
    ["10.0.0.1", "10/8"],
    ["10.255.255.255", "10/8 top"],
    ["100.64.0.1", "CGNAT low"],
    ["100.127.255.254", "CGNAT high"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback high"],
    ["169.254.169.254", "cloud metadata"],
    ["172.16.0.1", "172.16/12 low"],
    ["172.31.255.255", "172.16/12 high (docker bridge ranges)"],
    ["172.17.0.2", "docker bridge"],
    ["192.168.1.1", "192.168/16"],
    ["192.0.0.1", "IETF"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["239.255.255.250", "multicast high"],
    ["240.0.0.1", "reserved"],
    ["255.255.255.255", "broadcast"],
  ])("refuses %s (%s)", (address) => {
    expect(blocked(address)).toBe(true);
  });

  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "100.63.255.255",
    "100.128.0.1",
    "172.15.255.255",
    "172.32.0.1",
    "169.253.0.1",
    "192.167.255.255",
    "192.169.0.1",
    "223.255.255.255",
  ])("accepts the public address %s", (address) => {
    expect(classifyIp(address)).toEqual({ kind: "public" });
  });
});

describe("classifyIp: IPv6", () => {
  it.each([
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["0:0:0:0:0:0:0:1", "loopback, long form"],
    ["fc00::1", "unique-local fc00"],
    ["fd12:3456:789a::1", "unique-local fd"],
    ["fe80::1", "link-local"],
    ["febf::1", "link-local top of fe80::/10"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["ff00::", "multicast low"],
    ["2001:db8::1", "documentation"],
    ["2001::1", "Teredo / IETF"],
    ["100::1", "discard-only"],
    ["::ffff:10.0.0.1", "mapped 10/8"],
    ["::ffff:7f00:1", "mapped loopback, hex form"],
    ["::ffff:192.168.0.1", "mapped 192.168/16"],
    ["::ffff:169.254.169.254", "mapped metadata"],
    ["::ffff:172.17.0.2", "mapped docker bridge"],
    ["::ffff:100.64.0.1", "mapped CGNAT"],
    ["::ffff:0.0.0.0", "mapped unspecified"],
    ["64:ff9b::a00:1", "NAT64 of 10.0.0.1"],
    ["2002:7f00:1::", "6to4 of 127.0.0.1"],
    ["2002:c0a8:101::1", "6to4 of 192.168.1.1"],
    ["::10.0.0.1", "IPv4-compatible"],
    ["[::1]", "bracketed loopback"],
    ["4000::1", "outside global unicast"],
  ])("refuses %s (%s)", (address) => {
    expect(blocked(address)).toBe(true);
  });

  it.each([
    "2606:4700:4700::1111",
    "2001:4860:4860::8888",
    "2a00:1450:4001:81b::200e",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
    "2002:808:808::1",
  ])("accepts the public address %s", (address) => {
    expect(classifyIp(address)).toEqual({ kind: "public" });
  });
});

describe("classifyIp: malformed input is never trusted", () => {
  it.each([
    "",
    "not-an-ip",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "010.0.0.1",
    "1.2.3.04",
    "::g",
    "1::2::3",
    "fe80::1%eth0",
    "1:2:3:4:5:6:7:8:9",
    "12345::1",
  ])("treats %j as blocked", (address) => {
    expect(blocked(address)).toBe(true);
  });
});

describe("parseCidr / isIpInCidr / unwrapIpv4", () => {
  it("matches an address against a range", () => {
    const range = parseCidr("10.20.0.0/24");
    const inside = parseIp("10.20.0.77");
    const outside = parseIp("10.20.1.1");
    if (!range || !inside || !outside) throw new Error("fixture did not parse");
    expect(isIpInCidr(inside, range)).toBe(true);
    expect(isIpInCidr(outside, range)).toBe(false);
  });

  it("treats a bare address as a single-host range", () => {
    const range = parseCidr("192.168.1.5");
    const same = parseIp("192.168.1.5");
    const other = parseIp("192.168.1.6");
    if (!range || !same || !other) throw new Error("fixture did not parse");
    expect(isIpInCidr(same, range)).toBe(true);
    expect(isIpInCidr(other, range)).toBe(false);
  });

  it("never matches across families, and refuses nonsense", () => {
    const range = parseCidr("fd00::/8");
    const v4 = parseIp("10.0.0.1");
    if (!range || !v4) throw new Error("fixture did not parse");
    expect(isIpInCidr(v4, range)).toBe(false);
    expect(parseCidr("10.0.0.0/33")).toBeNull();
    expect(parseCidr("10.0.0.0/8/8")).toBeNull();
    expect(parseCidr("example.com")).toBeNull();
  });

  it("unwraps the IPv4 behind a mapped address", () => {
    const mapped = parseIp("::ffff:10.0.0.5");
    const plain = parseIp("10.0.0.5");
    if (!mapped || !plain) throw new Error("fixture did not parse");
    expect(unwrapIpv4(mapped)).toEqual(plain);
    expect(unwrapIpv4(plain)).toBeNull();
  });
});
