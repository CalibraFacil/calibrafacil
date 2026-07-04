import { createHash } from "node:crypto";
import { Hono } from "hono";
import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationMethod,
  customer,
  asset,
  service,
  organization,
  issuedCertificateSnapshot,
} from "@calibra-facil/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import {
  normalizeAccreditationNumber,
  shouldRenderAccreditationSeal,
} from "@calibra-facil/shared";
import {
  verifyPdf,
  getIcpBrasilTrustAnchors,
  type VerifyPdfResult,
} from "@calibra-facil/signing";
import {
  createR2Client,
  generatePresignedUrl,
  extractKeyFromUrl,
  downloadFromR2,
  type R2Env,
} from "../lib/storage";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Per-instance, best-effort cache of live signature rechecks. The verdict is
// deterministic per signed-PDF hash, so caching by pdfHash keeps the public
// endpoint cheap and bounds the R2-download + crypto cost under repeated scans.
const LIVE_VERDICT_TTL_MS = 10 * 60 * 1000;
const liveVerdictCache = new Map<
  string,
  { verdict: VerifyPdfResult; expiresAt: number }
>();

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

/**
 * Public Verification Router - NO AUTH REQUIRED
 *
 * Allows auditors and clients to verify certificate authenticity
 * using an unguessable UUID token.
 *
 * URL: https://verify.calibrafacil.com/v/{verificationToken}
 */
export const verifyRouter = new Hono<{ Bindings: R2Env }>()
  // =========================================================================
  // GET /:token - Get certificate verification info
  // =========================================================================
  .get("/:token", async (c) => {
    const token = c.req.param("token");

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      return c.json({ error: "Token invalido" }, 400);
    }

    const [job] = await db
      .select({
        id: calibrationJob.id,
        jobId: calibrationJob.jobId,
        certificateName: calibrationJob.certificateName,
        status: calibrationJob.status,
        certificateUrl: calibrationJob.certificateUrl,
        performedAt: calibrationJob.performedAt,
        approvedAt: calibrationJob.approvedAt,
        // Digital signature metadata - ISO 17025 Clause 7.8.2.1(q)
        signatureMetadata: calibrationJob.signatureMetadata,
        // Amendment fields - ISO 17025 Clause 7.8.4.1
        supersedesId: calibrationJob.supersedesId,
        supersededById: calibrationJob.supersededById,
        amendmentNumber: calibrationJob.amendmentNumber,
        amendmentReason: calibrationJob.amendmentReason,
        supersededAt: calibrationJob.supersededAt,
        customerName: customer.name,
        assetName: asset.name,
        assetTag: asset.tag,
        serviceName: service.name,
        labName: organization.name,
        // Accreditation seal - frozen method flag with current-method fallback
        methodSnapshot: calibrationJob.methodSnapshot,
        serviceMethodAccreditedScope: calibrationMethod.accreditedScope,
        labAccreditationActive: organization.accreditationActive,
        labAccreditationNumber: organization.accreditationNumber,
      })
      .from(calibrationJob)
      .innerJoin(customer, eq(calibrationJob.customerId, customer.id))
      .innerJoin(asset, eq(calibrationJob.assetId, asset.id))
      .innerJoin(service, eq(calibrationJob.serviceId, service.id))
      .innerJoin(
        organization,
        eq(calibrationJob.organizationId, organization.id),
      )
      .leftJoin(calibrationMethod, eq(service.methodId, calibrationMethod.id))
      .where(
        and(
          eq(calibrationJob.verificationToken, token),
          inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json(
        {
          valid: false,
          error: "Certificado nao encontrado",
        },
        404,
      );
    }

    // If superseded, get the replacement job info — but only once the
    // replacement is itself publicly verifiable. When an amendment is opened
    // the replacement is created as DRAFT and supersededById is set on the
    // original immediately; /verify only serves APPROVED/SUPERSEDED jobs, so
    // surfacing a still-draft replacement would link auditors from a valid
    // superseded certificate to an "invalid" page labelled as the current one.
    let supersededByInfo = null;
    if (job.supersededById) {
      const [replacement] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          verificationToken: calibrationJob.verificationToken,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, job.supersededById),
            inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
          ),
        )
        .limit(1);

      if (replacement) {
        supersededByInfo = {
          id: replacement.id,
          jobId: replacement.jobId,
          verificationToken: replacement.verificationToken,
        };
      }
    }

    // If this is an amendment, get the original job info — same terminal-status
    // gate as supersededByInfo above, so a non-terminal original (e.g.
    // reopened for rework) never leaks its jobId/verificationToken through an
    // already-approved amendment's public verify page.
    let supersedesInfo = null;
    if (job.supersedesId) {
      const [original] = await db
        .select({
          id: calibrationJob.id,
          jobId: calibrationJob.jobId,
          verificationToken: calibrationJob.verificationToken,
        })
        .from(calibrationJob)
        .where(
          and(
            eq(calibrationJob.id, job.supersedesId),
            inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
          ),
        )
        .limit(1);

      if (original) {
        supersedesInfo = {
          id: original.id,
          jobId: original.jobId,
          verificationToken: original.verificationToken,
        };
      }
    }

    const accredited = shouldRenderAccreditationSeal({
      lab: {
        accreditationActive: job.labAccreditationActive,
        accreditationNumber: job.labAccreditationNumber,
      },
      methodAccreditedScope:
        job.methodSnapshot?.accreditedScope ??
        job.serviceMethodAccreditedScope ??
        false,
    });

    return c.json({
      valid: true,
      jobId: job.jobId,
      status: job.status,
      hasDocument: !!job.certificateUrl,
      lab: job.labName,
      accreditation: {
        accredited,
        number: accredited
          ? normalizeAccreditationNumber(job.labAccreditationNumber ?? "")
          : null,
      },
      customer: job.customerName,
      asset: {
        name: job.assetName,
        tag: job.assetTag,
      },
      service: job.serviceName,
      performedAt: job.performedAt,
      approvedAt: job.approvedAt,
      // Digital signature - ISO 17025 Clause 7.8.2.1(q)
      digitalSignature: job.signatureMetadata
        ? {
            signed: true,
            signedAt: job.signatureMetadata.signedAt,
            signerName: job.signatureMetadata.signerName,
            signerCpfCnpj: job.signatureMetadata.signerCpfCnpj,
            certificateSerial: job.signatureMetadata.signerCertificateSerial,
            pdfHash: job.signatureMetadata.pdfHash,
            ltvEnabled: job.signatureMetadata.ltvEnabled,
          }
        : { signed: false },
      // Amendment information - ISO 17025 Clause 7.8.4.1
      isSuperseded: !!job.supersededById,
      isAmendment: !!job.supersedesId,
      amendmentNumber: job.amendmentNumber,
      amendmentReason: job.amendmentReason,
      supersededAt: job.supersededAt,
      supersededBy: supersededByInfo,
      supersedes: supersedesInfo,
    });
  })

  // =========================================================================
  // GET /:token/signature - Signature-integrity verdict (public)
  //
  // Fast path: serve the at-issue verdict precomputed by the worker
  // (calibration_job.signature_verdict). Live path (no stored verdict, or
  // ?recheck=1): download the signed PDF and re-verify "now" — bounded by a
  // per-instance TTL cache. Degrades gracefully; never 500s.
  // =========================================================================
  .get("/:token/signature", async (c) => {
    const token = c.req.param("token");
    if (!UUID_REGEX.test(token)) {
      return c.json({ error: "Token invalido" }, 400);
    }

    const [job] = await db
      .select({
        signatureMetadata: calibrationJob.signatureMetadata,
        signatureVerdict: calibrationJob.signatureVerdict,
        certificateUrl: calibrationJob.certificateUrl,
      })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.verificationToken, token),
          inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: "Certificado nao encontrado" }, 404);
    }

    // Unsigned certificate — nothing to verify cryptographically.
    if (!job.signatureMetadata) {
      return c.json({
        signed: false,
        source: null,
        computedAt: null,
        verdict: null,
      });
    }

    const recheck = c.req.query("recheck") === "1";

    // Fast path: the at-issue verdict, with no R2 round-trip.
    if (job.signatureVerdict && !recheck) {
      const { computedAt, ...verdict } = job.signatureVerdict;
      return c.json({ signed: true, source: "issue", computedAt, verdict });
    }

    // Live recheck (legacy certs without a stored verdict, or ?recheck=1).
    const pdfHash = job.signatureMetadata.pdfHash;
    const nowMs = Date.now();
    const cached = liveVerdictCache.get(pdfHash);
    if (cached && cached.expiresAt > nowMs) {
      c.header("Cache-Control", "public, max-age=300");
      return c.json({
        signed: true,
        source: "live",
        computedAt: new Date(nowMs).toISOString(),
        verdict: cached.verdict,
      });
    }

    try {
      if (!job.certificateUrl) {
        throw new Error("Documento ainda nao disponivel");
      }
      const env = c.env;
      const key = extractKeyFromUrl(job.certificateUrl);
      const client = createR2Client(env);
      const bytes = await downloadFromR2(client, env.R2_BUCKET_NAME, key);
      const verdict = await verifyPdf(bytes, {
        expectedSha256: pdfHash,
        trustAnchors: getIcpBrasilTrustAnchors(),
        checkDate: new Date(),
      });

      if (liveVerdictCache.size > 1000) liveVerdictCache.clear();
      liveVerdictCache.set(pdfHash, {
        verdict,
        expiresAt: nowMs + LIVE_VERDICT_TTL_MS,
      });

      c.header("Cache-Control", "public, max-age=300");
      return c.json({
        signed: true,
        source: "live",
        computedAt: new Date(nowMs).toISOString(),
        verdict,
      });
    } catch {
      // Fall back to a stored verdict if present, else a minimal "couldn't
      // verify right now" result built from the signature metadata.
      if (job.signatureVerdict) {
        const { computedAt, ...verdict } = job.signatureVerdict;
        return c.json({ signed: true, source: "issue", computedAt, verdict });
      }
      const verdict: VerifyPdfResult = {
        hashMatch: null,
        signatureCryptographicallyValid: false,
        chainValid: false,
        signerChainsToIcpRoot: false,
        certNotExpiredAtCheckDate: false,
        signaturePresent: true,
        signer: {
          commonName: job.signatureMetadata.signerName,
          cpfCnpj: job.signatureMetadata.signerCpfCnpj,
          certificateSerial: job.signatureMetadata.signerCertificateSerial,
        },
        overall: "UNVERIFIABLE",
        details: ["Não foi possível verificar a assinatura no momento."],
      };
      return c.json({ signed: true, source: null, computedAt: null, verdict });
    }
  })

  // =========================================================================
  // POST /:token/match - Upload-to-verify (public, Phase 2)
  //
  // Hash an uploaded PDF and compare it to the SHA-256 recorded for this
  // certificate (tamper detection), and report whether the uploaded file is
  // itself a valid ICP-Brasil signature. Token-scoped — no enumeration.
  // =========================================================================
  .post("/:token/match", async (c) => {
    const token = c.req.param("token");
    if (!UUID_REGEX.test(token)) {
      return c.json({ error: "Token invalido" }, 400);
    }

    const [job] = await db
      .select({
        pdfSha256: issuedCertificateSnapshot.pdfSha256,
        signatureMetadata: calibrationJob.signatureMetadata,
      })
      .from(calibrationJob)
      .leftJoin(
        issuedCertificateSnapshot,
        eq(issuedCertificateSnapshot.jobId, calibrationJob.id),
      )
      .where(
        and(
          eq(calibrationJob.verificationToken, token),
          inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: "Certificado nao encontrado" }, 404);
    }

    const expectedSha256 =
      job.pdfSha256 ?? job.signatureMetadata?.pdfHash ?? null;
    if (!expectedSha256) {
      return c.json({ error: "Certificado sem registro de integridade" }, 409);
    }

    let file: FormDataEntryValue | null;
    try {
      file = (await c.req.formData()).get("file");
    } catch {
      return c.json({ error: "Envio invalido" }, 400);
    }
    if (!(file instanceof File)) {
      return c.json({ error: "Arquivo nao enviado" }, 400);
    }
    if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      return c.json(
        {
          error: `Arquivo invalido ou maior que ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB.`,
        },
        400,
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const uploadedSha256 = createHash("sha256").update(bytes).digest("hex");
    const match = uploadedSha256.toLowerCase() === expectedSha256.toLowerCase();

    // Also report whether the uploaded file is itself a valid ICP-Brasil
    // signature (catches "different but doctored" copies). verifyPdf never throws.
    const uploadedVerdict = await verifyPdf(bytes, {
      expectedSha256,
      trustAnchors: getIcpBrasilTrustAnchors(),
      checkDate: new Date(),
    });

    return c.json({ match, expectedSha256, uploadedSha256, uploadedVerdict });
  })

  // =========================================================================
  // GET /:token/download - Download certificate (public)
  // =========================================================================
  .get("/:token/download", async (c) => {
    const token = c.req.param("token");

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(token)) {
      return c.json({ error: "Token invalido" }, 400);
    }

    const [job] = await db
      .select({ certificateUrl: calibrationJob.certificateUrl })
      .from(calibrationJob)
      .where(
        and(
          eq(calibrationJob.verificationToken, token),
          inArray(calibrationJob.status, ["APPROVED", "SUPERSEDED"]),
        ),
      )
      .limit(1);

    if (!job) {
      return c.json({ error: "Certificado nao encontrado" }, 404);
    }

    if (!job.certificateUrl) {
      return c.json({ error: "Documento ainda nao disponivel" }, 400);
    }

    const env = c.env;
    const key = extractKeyFromUrl(job.certificateUrl);
    const client = createR2Client(env);
    const url = await generatePresignedUrl(client, env.R2_BUCKET_NAME, key);

    return c.json({ url });
  });
