import { renderToHTMLString } from "@tiptap/static-renderer/pm/html-string";
import QRCode from "qrcode";

import {
  UnknownPlaceholderError,
  findUnknownPlaceholderPaths,
  resolvePlaceholder,
} from "./catalog.js";
import { sha256Hex } from "./canonical-json.js";
import {
  type CertificateDocument,
  type CertificateDocumentIssue,
  type LockedBlockKey,
  LOCKED_BLOCK_KEYS,
  OPTIONAL_BLOCK_KEYS,
  validateCertificateDocument,
} from "./document-schema.js";
import {
  type LockedBlockRenderContext,
  escapeHtml,
  renderLockedBlockInner,
} from "./blocks.js";
import {
  embedCertificatePageFooter,
  renderBandPageFooterTemplate,
  renderBandTopIdentityInner,
} from "./bands.js";
import { certificateEditorExtensions } from "./extensions.js";
import { buildCertificateFontCss } from "./fonts.js";
import {
  CERTIFICATE_PRINT_CSS,
  certificateStyleTokenOverrides,
  certificateThemeClass,
  certificateThemeTokens,
} from "./print-css.js";
import { CERT_HTML_COMPILER_VERSION } from "./version.js";

/**
 * The compiler (spec 02 §3): documentJson + frozen input data -> deterministic
 * HTML + sha256. Backend-only (Hono/worker); pure except for the QR pre-step
 * (async, deterministic for equal input). No DOM, no React, no clock, no
 * randomness — the sha256 of the output is the determinism evidence stored on
 * `issued_certificate_snapshot.compiled_html_sha256`.
 */

export class CertificateDocumentInvalidError extends Error {
  readonly issues: readonly CertificateDocumentIssue[];
  constructor(issues: readonly CertificateDocumentIssue[]) {
    super(
      `certificate template document is invalid:\n${issues
        .map((issue) => `  ${issue.path}: ${issue.message}`)
        .join("\n")}`,
    );
    this.name = "CertificateDocumentInvalidError";
    this.issues = issues;
  }
}

export type CompileCertificateOptions = {
  /**
   * Resolved URLs for org-media images referenced by `mediaId`. The CALLER
   * resolves ids (and tenant-checks them); pass stable URLs/keys — presigned
   * URLs would break determinism. A referenced id missing here is fail-loud.
   */
  mediaUrls?: Record<number, string>;
};

export type CompiledCertificate = {
  html: string;
  sha256: string;
  compilerVersion: string;
};

function isLockedBlockKey(value: unknown): value is LockedBlockKey {
  return (
    typeof value === "string" &&
    ((LOCKED_BLOCK_KEYS as readonly string[]).includes(value) ||
      (OPTIONAL_BLOCK_KEYS as readonly string[]).includes(value))
  );
}

export class CertificateImageUnresolvedError extends Error {
  readonly mediaId: number;
  constructor(mediaId: number) {
    super(`image mediaId ${mediaId} was not resolved by the caller (options.mediaUrls)`);
    this.name = "CertificateImageUnresolvedError";
    this.mediaId = mediaId;
  }
}

/**
 * Validate a template document WITHOUT rendering: Zod structure + placeholder
 * catalog membership. Used by draft-save and publish routes (T7); the same
 * checks run again inside `compileCertificateHtml` (defense in depth).
 */
export function validateCertificateTemplateDocument(
  documentJson: unknown,
):
  | { ok: true; document: CertificateDocument }
  | { ok: false; issues: CertificateDocumentIssue[] } {
  const structural = validateCertificateDocument(documentJson);
  if (!structural.ok) return structural;
  const unknownPaths = findUnknownPlaceholderPaths(structural.document);
  if (unknownPaths.length > 0) {
    return {
      ok: false,
      issues: unknownPaths.map((path) => ({
        path: "placeholders",
        message: `unknown placeholder path: ${path}`,
      })),
    };
  }
  return structural;
}

export async function compileCertificateHtml(
  documentJson: unknown,
  inputData: Record<string, unknown>,
  options: CompileCertificateOptions = {},
): Promise<CompiledCertificate> {
  const validated = validateCertificateDocument(documentJson);
  if (!validated.ok) throw new CertificateDocumentInvalidError(validated.issues);
  const document = validated.document;

  const unknownPaths = findUnknownPlaceholderPaths(document);
  if (unknownPaths.length > 0) throw new UnknownPlaceholderError(unknownPaths);

  // Async pre-step: QR for the verification URL (deterministic per input).
  const verificationUrl = resolvePlaceholder(inputData, "certificate.verificationUrl");
  const qrDataUrl = await QRCode.toDataURL(verificationUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 160,
  });
  const context: LockedBlockRenderContext = {
    qrDataUrl,
    bilingual: document.attrs.bilingual === true,
  };

  const body = renderToHTMLString({
    content: document,
    extensions: certificateEditorExtensions(),
    options: {
      nodeMapping: {
        lockedBlock({ node }) {
          const blockKey: unknown = node.attrs.blockKey;
          if (!isLockedBlockKey(blockKey)) {
            // unreachable after Zod validation; fail loud regardless
            throw new CertificateDocumentInvalidError([
              { path: "content", message: `unknown locked blockKey: ${String(blockKey)}` },
            ]);
          }
          const rawLayout = node.attrs.layout;
          const layout =
            rawLayout && typeof rawLayout === "object" ? rawLayout : null;
          const layoutClasses = [
            layout && typeof Reflect.get(layout, "columns") === "number"
              ? ` cf-layout-cols-${Reflect.get(layout, "columns")}`
              : "",
            layout && Reflect.get(layout, "density") === "compact"
              ? " cf-layout-compact"
              : "",
          ].join("");
          return `<section data-locked-block="${blockKey}" class="cf-locked-block${layoutClasses}">${renderLockedBlockInner(blockKey, inputData, context, layout)}</section>`;
        },
        placeholder({ node }) {
          const path = String(node.attrs.path);
          return `<span class="cf-placeholder" data-placeholder-path="${escapeHtml(path)}">${escapeHtml(resolvePlaceholder(inputData, path))}</span>`;
        },
        image({ node }) {
          const mediaId = Number(node.attrs.mediaId);
          const url = options.mediaUrls?.[mediaId];
          if (!url) throw new CertificateImageUnresolvedError(mediaId);
          const alt = typeof node.attrs.alt === "string" ? node.attrs.alt : "";
          const width =
            typeof node.attrs.widthMm === "number"
              ? ` style="width:${node.attrs.widthMm}mm"`
              : "";
          return `<figure class="cf-image"><img src="${escapeHtml(url)}" alt="${escapeHtml(alt)}"${width} /></figure>`;
        },
        // Bands render OUTSIDE the flow (thead / footerTemplate below); the
        // static renderer must still know them so the flow skips them.
        bandTopIdentity() {
          return "";
        },
        bandPageFooter() {
          return "";
        },
      },
    },
  });

  // Bands are optional (free canvas): render them only when present.
  const first = document.content[0];
  const last = document.content[document.content.length - 1];
  const topBandNode = first?.type === "bandTopIdentity" ? first : null;
  const footerBandNode = last?.type === "bandPageFooter" ? last : null;
  const topBandInner = topBandNode
    ? renderBandTopIdentityInner(topBandNode.attrs, inputData)
    : "";
  const documentHeader =
    topBandInner === ""
      ? ""
      : `<thead class="cf-doc-header"><tr><td><div class="cf-band-top-identity">${topBandInner}</div></td></tr></thead>\n`;
  const footerTemplate = footerBandNode
    ? renderBandPageFooterTemplate(footerBandNode.attrs, inputData)
    : renderBandPageFooterTemplate(
        { enabled: true, showCertificateNumber: false, showLabName: false, showIssueDate: false, identitySide: "left" },
        inputData,
      );

  const certificateNumber = resolvePlaceholder(inputData, "certificate.number");
  const theme = document.attrs.theme;
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<title>Certificado ${escapeHtml(certificateNumber)}</title>
<style>${buildCertificateFontCss(theme)}
:root{${certificateThemeTokens(theme)}${certificateStyleTokenOverrides(document.attrs.styleTokens)}}
${CERTIFICATE_PRINT_CSS}</style>
</head>
<body class="cf-certificate ${certificateThemeClass(theme)}">
<table class="cf-doc">
${documentHeader}<tbody class="cf-doc-body"><tr><td>
${body}
</td></tr></tbody>
</table>
${embedCertificatePageFooter(footerTemplate)}
</body>
</html>`;

  return {
    html,
    sha256: sha256Hex(html),
    compilerVersion: CERT_HTML_COMPILER_VERSION,
  };
}
