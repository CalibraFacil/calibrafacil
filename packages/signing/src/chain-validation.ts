/**
 * ICP-Brasil certificate chain validation (PAdES / ISO 17025 §7.8.2.1(q)).
 *
 * Validates the signing certificate's path to an ICP-Brasil trust anchor
 * (AC-Raiz) with pkijs. Trust anchors are loaded from a vendored trust store
 * populated by `scripts/fetch-icp-brasil-trust-store.mjs` from the official ITI
 * bundle (ACcompactado.zip). Pure-JS (pkijs + asn1js) — runs in the serverless
 * worker; no native bindings.
 *
 * Phase 0 scope: chain-PATH validation + checking of any CRLs supplied by the
 * caller. Live OCSP/CRL fetching over the network is a follow-up — the engine is
 * already structured to accept pre-fetched revocation material via `crls`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import forge from "node-forge";

import { SigningError } from "./types.js";
import type { CertificateInfo } from "./types.js";

// pkijs resolves its crypto engine from globalThis.crypto (WebCrypto), which is
// present in Node 18+, Bun, and Cloudflare Workers — so no explicit setEngine is
// needed and we avoid the Node-webcrypto vs DOM-Crypto type mismatch.

function binaryStringToArrayBuffer(binary: string): ArrayBuffer {
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i) & 0xff;
  }
  return buffer;
}

function forgeCertificateToPkijs(
  certificate: forge.pki.Certificate,
): pkijs.Certificate {
  const der = forge.asn1
    .toDer(forge.pki.certificateToAsn1(certificate))
    .getBytes();
  return new pkijs.Certificate({
    schema: asn1js.fromBER(binaryStringToArrayBuffer(der)).result,
  });
}

/**
 * Parse a PEM string (one or more BEGIN CERTIFICATE blocks) into pkijs
 * certificates — used to load the vendored ICP-Brasil trust anchors.
 */
export function parsePemCertificates(pem: string): pkijs.Certificate[] {
  const blocks = pem.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );
  if (!blocks) return [];
  return blocks.map((block) => {
    const base64 = block
      .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
      .replace(/\s+/g, "");
    const der = Buffer.from(base64, "base64");
    const arrayBuffer = der.buffer.slice(
      der.byteOffset,
      der.byteOffset + der.byteLength,
    );
    return new pkijs.Certificate({
      schema: asn1js.fromBER(arrayBuffer).result,
    });
  });
}

/**
 * Load every `.crt`/`.cer`/`.pem` file in a directory into pkijs trust anchors.
 * Returns an empty array (rather than throwing) when the directory is missing or
 * unpopulated, so callers can decide whether chain validation is available.
 */
export function loadTrustStore(directory: string): pkijs.Certificate[] {
  let entries: string[];
  try {
    entries = readdirSync(directory);
  } catch {
    return [];
  }
  const anchors: pkijs.Certificate[] = [];
  for (const entry of entries) {
    if (!/\.(crt|cer|pem)$/i.test(entry)) continue;
    const content = readFileSync(join(directory, entry), "utf8");
    anchors.push(...parsePemCertificates(content));
  }
  return anchors;
}

export interface ChainValidationResult {
  valid: boolean;
  /** Set when invalid; maps onto the existing SigningErrorCode vocabulary. */
  errorCode?: "INVALID_CHAIN" | "CERTIFICATE_REVOKED";
  message?: string;
}

export interface ChainValidationOptions {
  /** ICP-Brasil trust anchors (AC-Raiz + intermediates) as pkijs certificates. */
  trustAnchors: pkijs.Certificate[];
  /** Intermediates accompanying the leaf (e.g. from the .p12 chain). */
  intermediates?: forge.pki.Certificate[];
  /** Pre-fetched CRLs to check (live OCSP/CRL fetching is a follow-up). */
  crls?: pkijs.CertificateRevocationList[];
  /** Validation reference time (default: now). */
  checkDate?: Date;
}

/**
 * Validate an end-entity certificate's chain to an ICP-Brasil trust anchor.
 */
export async function validateCertificateChain(
  certificate: forge.pki.Certificate,
  options: ChainValidationOptions,
): Promise<ChainValidationResult> {
  if (options.trustAnchors.length === 0) {
    throw new SigningError(
      "Nenhuma âncora de confiança ICP-Brasil carregada. Rode scripts/fetch-icp-brasil-trust-store.mjs.",
      "INVALID_CHAIN",
    );
  }

  const leaf = forgeCertificateToPkijs(certificate);
  const intermediates = (options.intermediates ?? []).map(
    forgeCertificateToPkijs,
  );

  const engine = new pkijs.CertificateChainValidationEngine({
    trustedCerts: options.trustAnchors,
    certs: [...intermediates, leaf],
    crls: options.crls ?? [],
    checkDate: options.checkDate ?? new Date(),
  });

  let verification: Awaited<ReturnType<typeof engine.verify>>;
  try {
    verification = await engine.verify();
  } catch (error) {
    return {
      valid: false,
      errorCode: "INVALID_CHAIN",
      message:
        error instanceof Error
          ? error.message
          : "Falha ao validar a cadeia de certificação",
    };
  }

  if (!verification.result) {
    const message =
      verification.resultMessage || "Cadeia de certificação inválida";
    const revoked = /revok/i.test(message);
    return {
      valid: false,
      errorCode: revoked ? "CERTIFICATE_REVOKED" : "INVALID_CHAIN",
      message,
    };
  }

  return { valid: true };
}

/**
 * Convenience: validate the chain carried by a parsed PKCS#12 (CertificateInfo).
 */
export async function validatePkcs12Chain(
  certInfo: CertificateInfo,
  options: Omit<ChainValidationOptions, "intermediates">,
): Promise<ChainValidationResult> {
  return validateCertificateChain(certInfo.certificate, {
    ...options,
    intermediates: certInfo.chain,
  });
}
