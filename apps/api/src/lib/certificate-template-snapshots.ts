import { db } from "@calibra-facil/db";
import {
  calibrationMethod,
  certificateTemplate,
  certificateTemplateVersion,
} from "@calibra-facil/db/schema";
import { type CertificateTemplateSnapshot } from "@calibra-facil/shared/certificate-templates";
import { and, eq } from "drizzle-orm";

export function serializeCertificateTemplateSnapshot(
  snapshot: CertificateTemplateSnapshot,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot));
}

export type MethodCertificateTemplateResolution =
  | { ok: true; snapshot: CertificateTemplateSnapshot }
  | {
      ok: false;
      reason: "method_missing" | "template_missing" | "template_unpublished";
    };

/**
 * Resolve the certificate template a job will render with: the job's FROZEN
 * method (method_snapshot.methodId) owns one explicit template link — no
 * wildcards, no priority, no org-default fallback. `ok: false` means approval
 * must block, because issuance in the worker would fail the same way.
 */
export async function resolveMethodCertificateTemplate(params: {
  organizationId: string;
  methodId: number | null | undefined;
}): Promise<MethodCertificateTemplateResolution> {
  const methodId = params.methodId ?? null;
  if (methodId === null || !Number.isFinite(methodId) || methodId <= 0) {
    return { ok: false, reason: "method_missing" };
  }

  const [methodRow] = await db
    .select({ certificateTemplateId: calibrationMethod.certificateTemplateId })
    .from(calibrationMethod)
    .where(
      and(
        eq(calibrationMethod.id, methodId),
        eq(calibrationMethod.organizationId, params.organizationId),
      ),
    )
    .limit(1);
  if (!methodRow) {
    return { ok: false, reason: "method_missing" };
  }
  if (methodRow.certificateTemplateId === null) {
    return { ok: false, reason: "template_missing" };
  }

  const [templateRow] = await db
    .select({
      id: certificateTemplate.id,
      name: certificateTemplate.name,
      slug: certificateTemplate.slug,
      version: certificateTemplate.version,
    })
    .from(certificateTemplate)
    .where(
      and(
        eq(certificateTemplate.id, methodRow.certificateTemplateId),
        eq(certificateTemplate.organizationId, params.organizationId),
        eq(certificateTemplate.status, "ACTIVE"),
      ),
    )
    .limit(1);
  if (!templateRow) {
    return { ok: false, reason: "template_missing" };
  }

  const [publishedVersion] = await db
    .select({ id: certificateTemplateVersion.id })
    .from(certificateTemplateVersion)
    .where(
      and(
        eq(certificateTemplateVersion.templateId, templateRow.id),
        eq(certificateTemplateVersion.status, "PUBLISHED"),
      ),
    )
    .limit(1);
  if (!publishedVersion) {
    return { ok: false, reason: "template_unpublished" };
  }

  return {
    ok: true,
    snapshot: {
      id: templateRow.id,
      name: templateRow.name,
      slug: templateRow.slug,
      version: templateRow.version,
    },
  };
}
