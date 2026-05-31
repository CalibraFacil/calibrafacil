import { db } from "@calibra-facil/db";
import { certificateTemplate } from "@calibra-facil/db/schema";
import { type CertificateTemplateSnapshot } from "@calibra-facil/shared/certificate-templates";
import { and, eq } from "drizzle-orm";

export function serializeCertificateTemplateSnapshot(
  snapshot: CertificateTemplateSnapshot,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(snapshot));
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
    };
  }

  return {
    id: null,
    name: "Padrão do Sistema",
    slug: "padrao-sistema",
    version: 1,
  };
}
