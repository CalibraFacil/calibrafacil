/**
 * Test fixtures for the signing credential tier (`@calibra-facil/signing/testing`).
 *
 * A fixture CA and the PKCS#12 files it issues, real ones, so the upload
 * validation (validity window, key usage, chain to a trust store) is exercised by
 * the production parser and validator instead of a stubbed certificate object.
 * NEVER imported by production code: the keys are generated on the fly and the
 * CA is trusted only where a test hands its PEM to `SIGNING_TRUST_STORE_FILE`.
 */
import forge from "node-forge";

export interface FixtureCa {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  /** PEM of the CA certificate: what a trust-store file contains. */
  pem: string;
}

export interface FixtureSignerOptions {
  password: string;
  notBefore?: Date;
  notAfter?: Date;
  /** Key usage extension; `null` omits it altogether. Default: digitalSignature + nonRepudiation. */
  keyUsage?: {
    digitalSignature?: boolean;
    nonRepudiation?: boolean;
    keyEncipherment?: boolean;
  } | null;
  /** Embed the CA in the P12 (default true). */
  includeChain?: boolean;
  commonName?: string;
}

export interface FixtureSigner {
  p12: Buffer;
  password: string;
  subjectCn: string;
  validFrom: Date;
  validUntil: Date;
}

const DAY_MS = 86_400_000;
let nextSerial = 1000 + Math.floor(Math.random() * 1_000_000);
let leafKeys: forge.pki.rsa.KeyPair | undefined;

function serial(): string {
  nextSerial += 1;
  return String(nextSerial);
}

export function makeFixtureCa(
  commonName = "Fixture ICP-Brasil Root",
): FixtureCa {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = new Date(Date.now() - 365 * DAY_MS);
  cert.validity.notAfter = new Date(Date.now() + 3650 * DAY_MS);
  const subject = [{ name: "commonName", value: commonName }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  return {
    cert,
    key: keys.privateKey,
    pem: forge.pki.certificateToPem(cert),
  };
}

/** A PKCS#12 holding a leaf issued by `ca`, with the shape the options ask for. */
export function makeFixtureSigner(
  ca: FixtureCa,
  options: FixtureSignerOptions,
): FixtureSigner {
  leafKeys ??= forge.pki.rsa.generateKeyPair(2048);
  const notBefore = options.notBefore ?? new Date(Date.now() - DAY_MS);
  const notAfter = options.notAfter ?? new Date(Date.now() + 365 * DAY_MS);
  const subjectCn = options.commonName ?? "LAB TESTE:12345678000195";

  const cert = forge.pki.createCertificate();
  cert.publicKey = leafKeys.publicKey;
  cert.serialNumber = serial();
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;
  cert.setSubject([{ name: "commonName", value: subjectCn }]);
  cert.setIssuer(ca.cert.subject.attributes);
  const usage =
    options.keyUsage === undefined
      ? { digitalSignature: true, nonRepudiation: true }
      : options.keyUsage;
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    ...(usage === null ? [] : [{ name: "keyUsage", ...usage }]),
  ]);
  cert.sign(ca.key, forge.md.sha256.create());

  const chain = options.includeChain === false ? [] : [ca.cert];
  const asn1 = forge.pkcs12.toPkcs12Asn1(
    leafKeys.privateKey,
    [cert, ...chain],
    options.password,
    { algorithm: "3des" },
  );
  return {
    p12: Buffer.from(forge.asn1.toDer(asn1).getBytes(), "binary"),
    password: options.password,
    subjectCn,
    validFrom: notBefore,
    validUntil: notAfter,
  };
}
