import { db } from "@calibra-facil/db";
import { certificateTemplate } from "@calibra-facil/db/schema";
import {
  type CertificateTemplateSnapshot,
  DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  normalizeCertificateTemplateConfig,
} from "@calibra-facil/shared";
import { and, eq } from "drizzle-orm";

export function serializeCertificateTemplateSnapshot(
  snapshot: CertificateTemplateSnapshot,
): Record<string, unknown> {
  return snapshot as unknown as Record<string, unknown>;
}

export async function getEffectiveCertificateTemplateSnapshot(
  organizationId: string,
): Promise<CertificateTemplateSnapshot> {
  const [activeDefaultTemplate] = await db
    .select({
      id: certificateTemplate.id,
      name: certificateTemplate.name,
      slug: certificateTemplate.slug,
      version: certificateTemplate.version,
      config: certificateTemplate.config,
    })
    .from(certificateTemplate)
    .where(
      and(
        eq(certificateTemplate.organizationId, organizationId),
        eq(certificateTemplate.isDefault, true),
        eq(certificateTemplate.status, "ACTIVE"),
      ),
    )
    .limit(1);

  if (activeDefaultTemplate) {
    return {
      id: activeDefaultTemplate.id,
      name: activeDefaultTemplate.name,
      slug: activeDefaultTemplate.slug,
      version: activeDefaultTemplate.version,
      config: normalizeCertificateTemplateConfig(
        activeDefaultTemplate.config as any,
      ),
    };
  }

  return {
    id: null,
    name: "Padrão do Sistema",
    slug: "padrao-sistema",
    version: 1,
    config: DEFAULT_CERTIFICATE_TEMPLATE_CONFIG,
  };
}
