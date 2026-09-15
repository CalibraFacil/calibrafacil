import { describe, expect, it } from "vitest";
import {
  isLocalHostname,
  normalizeHostname,
  normalizeOrigin,
} from "./domain-utils";

// REQ-DOM-001: protocol + path → lowercase host only
describe("normalizeHostname — protocol and path stripping", () => {
  it("REQ-DOM-001: strips HTTPS protocol and path, lowercases the host", () => {
    expect(normalizeHostname("HTTPS://Lab.Example.com/x")).toBe(
      "lab.example.com",
    );
  });

  it("REQ-DOM-001: strips http protocol and path, lowercases", () => {
    expect(normalizeHostname("http://API.Internal.io/v1/ping")).toBe(
      "api.internal.io",
    );
  });
});

// REQ-DOM-002: trailing-dot FQDN → strip the dot
describe("normalizeHostname — trailing dot removal", () => {
  it("REQ-DOM-002: strips trailing dot from a plain FQDN", () => {
    expect(normalizeHostname("example.com.")).toBe("example.com");
  });

  it("REQ-DOM-002: strips trailing dot even after lowercasing", () => {
    expect(normalizeHostname("LAB.Example.COM.")).toBe("lab.example.com");
  });
});

// REQ-DOM-003: empty / whitespace-only → null
describe("normalizeHostname — empty input", () => {
  it("REQ-DOM-003: returns null for an empty string", () => {
    expect(normalizeHostname("")).toBeNull();
  });

  it("REQ-DOM-003: returns null for a whitespace-only string", () => {
    expect(normalizeHostname("   ")).toBeNull();
  });

  it("REQ-DOM-003: returns null for a tab-only string", () => {
    expect(normalizeHostname("\t")).toBeNull();
  });
});

// REQ-DOM-004: host contains ":" (port) → null
describe("normalizeHostname — port rejection", () => {
  it("REQ-DOM-004: returns null when the host includes a port", () => {
    expect(normalizeHostname("example.com:8080")).toBeNull();
  });

  it("REQ-DOM-004: returns null for localhost:3000", () => {
    expect(normalizeHostname("localhost:3000")).toBeNull();
  });
});

// REQ-DOM-005: characters outside [a-z0-9.-] → null
describe("normalizeHostname — invalid character rejection", () => {
  it("REQ-DOM-005: returns null for hostname with underscore", () => {
    expect(normalizeHostname("my_host.example.com")).toBeNull();
  });

  it("REQ-DOM-005: returns null for hostname with unicode character", () => {
    expect(normalizeHostname("café.example.com")).toBeNull();
  });

  it("REQ-DOM-005: returns null for hostname with space inside", () => {
    expect(normalizeHostname("my host.com")).toBeNull();
  });

  it("REQ-DOM-005: returns null for hostname with @ character", () => {
    expect(normalizeHostname("user@example.com")).toBeNull();
  });
});

// REQ-DOM-006: host starts or ends with "." → null
describe("normalizeHostname — leading/trailing dot rejection", () => {
  it("REQ-DOM-006: returns null when host starts with a dot", () => {
    expect(normalizeHostname(".example.com")).toBeNull();
  });

  it("REQ-DOM-006: returns null when host ends with dot after normalization strips protocol", () => {
    // After stripping protocol the raw path-split host still ends with "." only
    // if the triple-dot form is used — verify the leading-dot guard fires
    expect(normalizeHostname(".host")).toBeNull();
  });
});

// REQ-DOM-007: valid absolute URL → lowercased "<protocol>//<host>"
describe("normalizeOrigin — valid URL handling", () => {
  it("REQ-DOM-007: returns lowercased protocol+host for a simple https URL", () => {
    expect(normalizeOrigin("https://example.com/path?q=1#frag")).toBe(
      "https://example.com",
    );
  });

  it("REQ-DOM-007: preserves an explicit port in the origin", () => {
    expect(normalizeOrigin("http://localhost:3000/api/v1")).toBe(
      "http://localhost:3000",
    );
  });

  it("REQ-DOM-007: lowercases the host portion", () => {
    expect(normalizeOrigin("HTTPS://Lab.Example.com/x")).toBe(
      "https://lab.example.com",
    );
  });

  it("REQ-DOM-007: drops path and query, keeps protocol and host", () => {
    const result = normalizeOrigin(
      "https://api.calibrafacil.com/v2/jobs?foo=bar",
    );
    expect(result).toBe("https://api.calibrafacil.com");
  });
});

// REQ-DOM-008: non-URL string → null, no throw
describe("normalizeOrigin — invalid input", () => {
  it("REQ-DOM-008: returns null (not throws) for a bare hostname", () => {
    expect(normalizeOrigin("example.com")).toBeNull();
  });

  it("REQ-DOM-008: returns null for an empty string", () => {
    expect(normalizeOrigin("")).toBeNull();
  });

  it("REQ-DOM-008: returns null for a random non-URL string", () => {
    expect(normalizeOrigin("not a url at all")).toBeNull();
  });

  it("REQ-DOM-008: does not throw — wraps error internally", () => {
    expect(() => normalizeOrigin(":::bad:::")).not.toThrow();
    expect(normalizeOrigin(":::bad:::")).toBeNull();
  });
});

// REQ-DOM-009: "localhost", "*.local", dotted-quad IPv4 → true
describe("isLocalHostname — local host detection", () => {
  it("REQ-DOM-009: returns true for 'localhost'", () => {
    expect(isLocalHostname("localhost")).toBe(true);
  });

  it("REQ-DOM-009: returns true for a *.local hostname", () => {
    expect(isLocalHostname("mylab.local")).toBe(true);
  });

  it("REQ-DOM-009: returns true for a bare .local hostname", () => {
    expect(isLocalHostname("printer.local")).toBe(true);
  });

  it("REQ-DOM-009: returns true for a dotted-quad IPv4 (127.0.0.1)", () => {
    expect(isLocalHostname("127.0.0.1")).toBe(true);
  });

  it("REQ-DOM-009: returns true for a generic dotted-quad IPv4 (192.168.1.1)", () => {
    expect(isLocalHostname("192.168.1.1")).toBe(true);
  });

  it("REQ-DOM-009: returns true for another dotted-quad IPv4 (10.0.0.1)", () => {
    expect(isLocalHostname("10.0.0.1")).toBe(true);
  });
});

// REQ-DOM-010: public hostname → false
describe("isLocalHostname — public host rejection", () => {
  it("REQ-DOM-010: returns false for a normal public domain", () => {
    expect(isLocalHostname("example.com")).toBe(false);
  });

  it("REQ-DOM-010: returns false for a subdomain of a public domain", () => {
    expect(isLocalHostname("api.calibrafacil.com")).toBe(false);
  });

  it("REQ-DOM-010: returns false for a domain that merely contains 'local' as a substring", () => {
    // "localhosting.com" does NOT end with ".local" and is not "localhost"
    expect(isLocalHostname("localhosting.com")).toBe(false);
  });
});
