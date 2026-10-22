import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import * as asn1js from "asn1js";
import forge from "node-forge";
import * as pkijs from "pkijs";

// A mock RFC 3161 time-stamp authority for the worker integration tier: a real
// HTTP server that parses the TimeStampReq pdf-rfc3161 sends and answers with a
// genuine, signed TimeStampResp (granted, TSTInfo over the requested message
// imprint). Nothing about the worker or the signing package is mocked: only the
// network authority at the far end is.

const ID_CT_TSTINFO = "1.2.840.113549.1.9.16.1.4";
const ID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const ID_KP_TIME_STAMPING = "1.3.6.1.5.5.7.3.8";

export type TsaRequestRecord = {
  headers: IncomingHttpHeaders;
  /** Hex of the message imprint (the SHA-256 of the PDF's signed byte range). */
  imprintHex: string;
};

export type MockTsa = {
  url: string;
  requests: TsaRequestRecord[];
  close(): Promise<void>;
};

async function createTsaSigner() {
  const algorithm = {
    name: "RSASSA-PKCS1-v1_5",
    hash: "SHA-256",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
  };
  const keys = await globalThis.crypto.subtle.generateKey(algorithm, true, [
    "sign",
    "verify",
  ]);

  const certificate = new pkijs.Certificate();
  certificate.version = 2;
  certificate.serialNumber = new asn1js.Integer({ value: 1 });
  const name = new pkijs.RelativeDistinguishedNames({
    typesAndValues: [
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: "Mock TSA" }),
      }),
    ],
  });
  certificate.issuer = name;
  certificate.subject = name;
  certificate.notBefore.value = new Date(Date.now() - 86_400_000);
  certificate.notAfter.value = new Date(Date.now() + 86_400_000);
  certificate.extensions = [
    new pkijs.Extension({
      extnID: "2.5.29.37",
      critical: true,
      extnValue: new pkijs.ExtKeyUsage({
        keyPurposes: [ID_KP_TIME_STAMPING],
      })
        .toSchema()
        .toBER(false),
    }),
  ];
  await certificate.subjectPublicKeyInfo.importKey(keys.publicKey);
  await certificate.sign(keys.privateKey, "SHA-256");

  return { certificate, privateKey: keys.privateKey };
}

function portOf(server: Server): number {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("mock TSA: the server has no TCP port");
  }
  return address.port;
}

function hex(bytes: ArrayBuffer): string {
  return Buffer.from(bytes).toString("hex");
}

async function buildGrantedResponse(
  request: pkijs.TimeStampReq,
  signer: Awaited<ReturnType<typeof createTsaSigner>>,
  serial: number,
): Promise<Uint8Array> {
  const tstInfo = new pkijs.TSTInfo({
    version: 1,
    policy: "1.2.3.4.5",
    messageImprint: request.messageImprint,
    serialNumber: new asn1js.Integer({ value: serial }),
    genTime: new Date(),
    nonce: request.nonce,
  });

  const signedData = new pkijs.SignedData({
    version: 3,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: ID_CT_TSTINFO,
      eContent: new asn1js.OctetString({
        valueHex: tstInfo.toSchema().toBER(false),
      }),
    }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: signer.certificate.issuer,
          serialNumber: signer.certificate.serialNumber,
        }),
      }),
    ],
    certificates: [signer.certificate],
  });
  await signedData.sign(signer.privateKey, 0, "SHA-256");

  // pkijs always writes eContent as a constructed (chunked) OCTET STRING; real
  // authorities, and pdf-rfc3161's TSTInfo reader, use the primitive form.
  const signedDataSchema = signedData.toSchema(false);
  const encapContent = signedDataSchema.valueBlock.value[2];
  const explicitContent = encapContent?.valueBlock.value[1];
  if (!(explicitContent instanceof asn1js.Constructed)) {
    throw new Error("mock TSA: unexpected SignedData layout");
  }
  explicitContent.valueBlock.value = [
    new asn1js.OctetString({ valueHex: tstInfo.toSchema().toBER(false) }),
  ];

  const token = new pkijs.ContentInfo({
    contentType: ID_SIGNED_DATA,
    content: signedDataSchema,
  });
  const response = new pkijs.TimeStampResp({
    status: new pkijs.PKIStatusInfo({ status: pkijs.PKIStatus.granted }),
    timeStampToken: new pkijs.ContentInfo({ schema: token.toSchema() }),
  });
  return new Uint8Array(response.toSchema().toBER(false));
}

/** Starts the mock TSA on an ephemeral localhost port. */
export async function startMockTsa(): Promise<MockTsa> {
  const signer = await createTsaSigner();
  const requests: TsaRequestRecord[] = [];
  let serial = 0;

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      void (async () => {
        try {
          const body = Buffer.concat(chunks);
          const parsed = asn1js.fromBER(
            body.buffer.slice(
              body.byteOffset,
              body.byteOffset + body.byteLength,
            ),
          );
          const tsRequest = new pkijs.TimeStampReq({ schema: parsed.result });
          requests.push({
            headers: req.headers,
            imprintHex: hex(
              tsRequest.messageImprint.hashedMessage.valueBlock.valueHexView.slice()
                .buffer,
            ),
          });
          serial += 1;
          const response = await buildGrantedResponse(
            tsRequest,
            signer,
            serial,
          );
          res.writeHead(200, { "content-type": "application/timestamp-reply" });
          res.end(Buffer.from(response));
        } catch (error) {
          res.writeHead(500);
          res.end(String(error));
        }
      })();
    });
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );

  return {
    url: `http://127.0.0.1:${portOf(server)}/tsa`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}

/** An address nothing listens on: connecting is refused immediately. */
export async function unreachableTsaUrl(): Promise<string> {
  const probe = createServer();
  await new Promise<void>((resolve) =>
    probe.listen(0, "127.0.0.1", () => resolve()),
  );
  const port = portOf(probe);
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return `http://127.0.0.1:${port}/tsa`;
}

/**
 * A self-signed signer certificate as a PKCS#12 file, the shape the worker
 * decrypts and hands to the signer.
 */
export function makeSignerP12(password: string): {
  p12: Buffer;
  subjectCn: string;
  serialNumber: string;
  validFrom: Date;
  validUntil: Date;
} {
  const subjectCn = "Laboratorio Teste LTDA";
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  const validFrom = new Date(Date.now() - 86_400_000);
  const validUntil = new Date(Date.now() + 365 * 86_400_000);
  cert.validity.notBefore = validFrom;
  cert.validity.notAfter = validUntil;
  const subject = [{ name: "commonName", value: subjectCn }];
  cert.setSubject(subject);
  cert.setIssuer(subject);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, password, {
    algorithm: "3des",
  });
  const der = forge.asn1.toDer(asn1).getBytes();
  return {
    p12: Buffer.from(der, "binary"),
    subjectCn,
    serialNumber: "01",
    validFrom,
    validUntil,
  };
}

/**
 * A minimal but structurally valid one-page PDF (a real cross-reference table),
 * standing in for what Gotenberg returns so the real signer can sign it.
 */
export function makeMinimalPdf(): Uint8Array<ArrayBuffer> {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>",
  ];
  let body = "%PDF-1.7\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}
