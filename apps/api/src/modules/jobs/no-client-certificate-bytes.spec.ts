/**
 * REQ-P01-4 — no code path may publish client-rendered certificate bytes.
 *
 * Approval and certificates are online-only: the only way `certificate_url`
 * gets a value is the worker rendering and signing the PDF after
 * `approveJob`'s cloud completion. The desktop publish path
 * (`POST /sync/certificate-pdfs` -> `publish_desktop_certificate`) accepted
 * bytes whose hash/size were checked only against metadata from the same
 * client, so its absence is pinned here (a tripwire for re-introduction).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_SRC = path.resolve(__dirname, "../..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "node_modules" || entry.name === "__tests__"
        ? []
        : sourceFiles(full);
    }
    return /\.tsx?$/.test(entry.name) &&
      !/\.(spec|test|int\.spec)\.tsx?$/.test(entry.name) &&
      !entry.name.includes(".int.")
      ? [full]
      : [];
  });
}

describe("no client-rendered certificate publish path", () => {
  const files = sourceFiles(API_SRC);

  it("REQ-P01-4: the API source has no certificate-pdfs route, publish completion or desktop PDF key", () => {
    const forbidden = [
      "certificate-pdfs",
      "publish_desktop_certificate",
      "certificate_published_from_desktop",
      "desktopCertificatePdfKey",
    ];
    const offenders = files.flatMap((file) => {
      const text = readFileSync(file, "utf8");
      return forbidden
        .filter((token) => text.includes(token))
        .map((token) => `${path.relative(API_SRC, file)}: ${token}`);
    });

    expect(offenders).toEqual([]);
  });

  it("REQ-P01-2: approveJob has exactly one completion kind, the cloud one", () => {
    const text = readFileSync(
      path.join(API_SRC, "modules/jobs/approve-job.ts"),
      "utf8",
    );
    const union = text.slice(
      text.indexOf("export type ApprovalCompletion"),
      text.indexOf("export type FinanceSendResult"),
    );

    expect(
      [...union.matchAll(/kind:\s*"([a-z_]+)"/g)].map((m) => m[1]),
    ).toEqual(["generate_certificate_pdf"]);
  });
});
