import { db } from "@calibra-facil/db";
import { service } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField } from "./api";
import type { SeedContext, SeedRefs } from "./context";
import type { DemoTemplateKey, MethodIds } from "./methods";

type ServiceSpec = {
  name: string;
  description: string;
  /** Catalog method backing the service; absent for repair/other services. */
  templateKey?: DemoTemplateKey;
  assetTypeSlug?: string;
  priceCents: number;
  turnaroundDays: number;
};

export const DEMO_SERVICES: readonly ServiceSpec[] = [
  {
    name: "Calibração de balança (instrumento de pesagem)",
    description:
      "Erro de indicação, repetibilidade e excentricidade conforme EURAMET cg-18.",
    templateKey: "weighing-instrument",
    assetTypeSlug: "balanca-digital",
    priceCents: 21000,
    turnaroundDays: 5,
  },
  {
    name: "Calibração de multímetro digital (tensão contínua)",
    description: "Erro de indicação em tensão contínua com padrão multifunção.",
    templateKey: "electrical-indication",
    assetTypeSlug: "multimetro-digital",
    priceCents: 26000,
    turnaroundDays: 7,
  },
  {
    name: "Calibração de dinamômetro",
    description: "Erro de indicação de força, tração e compressão.",
    templateKey: "force-indication",
    assetTypeSlug: "dinamometro",
    priceCents: 38000,
    turnaroundDays: 10,
  },
  {
    name: "Calibração de tacômetro",
    description: "Erro de indicação de rotação com padrão óptico.",
    templateKey: "frequency-indication",
    assetTypeSlug: "tacometro",
    priceCents: 16500,
    turnaroundDays: 5,
  },
  {
    name: "Manutenção e ajuste de balança",
    description: "Diagnóstico, limpeza, nivelamento e ajuste com pesos padrão.",
    assetTypeSlug: "balanca-digital",
    priceCents: 32000,
    turnaroundDays: 3,
  },
  {
    name: "Visita técnica para calibração em campo",
    description:
      "Deslocamento e calibração no local do cliente (calibração in loco).",
    priceCents: 45000,
    turnaroundDays: 2,
  },
];

/** service.id by service name. */
export type ServiceIds = Map<string, number>;

/** The commercial catalog: every adopted method sells as a service. */
export async function seedServices(
  ctx: SeedContext,
  refs: SeedRefs,
  methodIds: MethodIds,
): Promise<ServiceIds> {
  const ids: ServiceIds = new Map();
  for (const spec of DEMO_SERVICES) {
    const [existing] = await db
      .select({ id: service.id })
      .from(service)
      .where(
        and(eq(service.organizationId, LAB_ID), eq(service.name, spec.name)),
      )
      .limit(1);
    if (existing) {
      ids.set(spec.name, existing.id);
      continue;
    }
    const methodId = spec.templateKey
      ? methodIds.get(spec.templateKey)
      : undefined;
    const assetTypeId = spec.assetTypeSlug
      ? refs.assetTypeIds.get(spec.assetTypeSlug)
      : undefined;
    const created = await ctx.api.call("owner", "POST", "/api/services", {
      name: spec.name,
      description: spec.description,
      methodId,
      assetTypeId,
      price: spec.priceCents,
      currency: "BRL",
      tat: spec.turnaroundDays,
      isActive: true,
    });
    ids.set(spec.name, numberField(created, "id"));
  }
  ctx.log(`  services: ${ids.size}`);
  return ids;
}
