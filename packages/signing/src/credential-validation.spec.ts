import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getIcpBrasilTrustAnchors,
  parsePemCertificates,
} from "./chain-validation.js";
import {
  resolveSigningTrustAnchors,
  validateSigningCredential,
} from "./credential-validation.js";
import { parsePkcs12 } from "./signer.js";
import {
  makeFixtureCa,
  makeFixtureSigner,
  type FixtureCa,
  type FixtureSignerOptions,
} from "./testing.js";

/**
 * REQ-B4A-3: a P12 is validated when it is uploaded. Real fixtures (a fixture CA
 * and leaves it issued, packed into genuine PKCS#12 files and parsed back with
 * the production `parsePkcs12`), never a stubbed certificate object.
 */

type LeafOptions = Omit<FixtureSignerOptions, "password">;

function makeLeafP12(ca: FixtureCa, options: LeafOptions = {}): Buffer {
  return makeFixtureSigner(ca, { ...options, password: "senha" }).p12;
}

const DAY = 86_400_000;

let ca: FixtureCa;
let otherCa: FixtureCa;
let anchors: ReturnType<typeof parsePemCertificates>;
let workDir: string;

beforeAll(() => {
  ca = makeFixtureCa("Fixture ICP Root");
  otherCa = makeFixtureCa("Some Other Root");
  anchors = parsePemCertificates(ca.pem);
  workDir = mkdtempSync(join(tmpdir(), "signing-trust-"));
}, 120_000);

afterAll(() => rmSync(workDir, { recursive: true, force: true }));

function parse(p12: Buffer) {
  return parsePkcs12(p12, "senha");
}

describe("REQ-B4A-3: validateSigningCredential", () => {
  it("accepts a current certificate that chains to the trust store and may sign", async () => {
    const result = await validateSigningCredential(parse(makeLeafP12(ca)), {
      trustAnchors: anchors,
    });
    expect(result).toEqual({ ok: true });
  });

  it("accepts a leaf that carries no chain when the trust store holds its issuer", async () => {
    const result = await validateSigningCredential(
      parse(makeLeafP12(ca, { includeChain: false })),
      { trustAnchors: anchors },
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects an expired certificate with a pt-BR message", async () => {
    const result = await validateSigningCredential(
      parse(
        makeLeafP12(ca, {
          notBefore: new Date(Date.now() - 400 * DAY),
          notAfter: new Date(Date.now() - 10 * DAY),
        }),
      ),
      { trustAnchors: anchors },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERTIFICATE_EXPIRED");
    expect(result.message).toMatch(
      /^Certificado expirado em \d{2}\/\d{2}\/\d{4}/,
    );
  });

  it("rejects a certificate that is not valid yet", async () => {
    const result = await validateSigningCredential(
      parse(
        makeLeafP12(ca, {
          notBefore: new Date(Date.now() + 30 * DAY),
          notAfter: new Date(Date.now() + 400 * DAY),
        }),
      ),
      { trustAnchors: anchors },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("CERTIFICATE_NOT_YET_VALID");
    expect(result.message).toMatch(/ainda não é válido/);
  });

  it("rejects a certificate whose key usage allows neither digitalSignature nor nonRepudiation", async () => {
    const result = await validateSigningCredential(
      parse(makeLeafP12(ca, { keyUsage: { keyEncipherment: true } })),
      { trustAnchors: anchors },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_KEY_USAGE");
    expect(result.message).toMatch(/assinatura digital|não repúdio/);
  });

  it("rejects a certificate with no key usage extension at all", async () => {
    const result = await validateSigningCredential(
      parse(makeLeafP12(ca, { keyUsage: null })),
      { trustAnchors: anchors },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_KEY_USAGE");
  });

  it("accepts either usage on its own (digitalSignature or nonRepudiation)", async () => {
    for (const keyUsage of [
      { digitalSignature: true },
      { nonRepudiation: true },
    ]) {
      const result = await validateSigningCredential(
        parse(makeLeafP12(ca, { keyUsage })),
        { trustAnchors: anchors },
      );
      expect(result, JSON.stringify(keyUsage)).toEqual({ ok: true });
    }
  });

  it("rejects a chain that does not build to the configured trust store", async () => {
    const result = await validateSigningCredential(
      parse(makeLeafP12(otherCa)),
      { trustAnchors: anchors },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("INVALID_CHAIN");
    expect(result.message).toMatch(/cadeia de certificação/i);
  });

  it("fails closed when the trust store is empty", async () => {
    const result = await validateSigningCredential(parse(makeLeafP12(ca)), {
      trustAnchors: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("TRUST_STORE_UNAVAILABLE");
  });
});

describe("REQ-B4A-3: the trust store is configurable and defaults to the bundled ICP-Brasil roots", () => {
  it("uses the bundled ICP-Brasil anchors when nothing is configured", () => {
    const anchorsOfDefault = resolveSigningTrustAnchors({});
    expect(anchorsOfDefault.length).toBeGreaterThan(0);
    expect(anchorsOfDefault.length).toBe(getIcpBrasilTrustAnchors().length);
  });

  it("SIGNING_TRUST_STORE_FILE replaces them with the PEM bundle at that path", () => {
    const file = join(workDir, "fixture-roots.pem");
    writeFileSync(file, ca.pem);
    const configured = resolveSigningTrustAnchors({
      SIGNING_TRUST_STORE_FILE: file,
    });
    expect(configured).toHaveLength(1);
  });

  it("a configured file with no certificate is an error, never a silent fall back", () => {
    const file = join(workDir, "empty.pem");
    writeFileSync(file, "not a certificate");
    expect(() =>
      resolveSigningTrustAnchors({ SIGNING_TRUST_STORE_FILE: file }),
    ).toThrow(/SIGNING_TRUST_STORE_FILE/);
    expect(() =>
      resolveSigningTrustAnchors({
        SIGNING_TRUST_STORE_FILE: join(workDir, "missing.pem"),
      }),
    ).toThrow(/SIGNING_TRUST_STORE_FILE/);
  });

  it("the bundled ICP-Brasil roots do not trust the fixture CA", async () => {
    const result = await validateSigningCredential(parse(makeLeafP12(ca)), {
      trustAnchors: getIcpBrasilTrustAnchors(),
    });
    expect(result.ok).toBe(false);
  });
});
