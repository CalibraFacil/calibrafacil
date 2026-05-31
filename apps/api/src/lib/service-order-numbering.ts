import { db } from "@calibra-facil/db";
import {
  organizationUnit,
  serviceOrder,
  serviceOrderNumberingSequence,
  serviceOrderSettings,
} from "@calibra-facil/db/schema";
import { and, eq, sql } from "drizzle-orm";

type ServiceOrderNumberingDbExecutor = Pick<
  typeof db,
  "insert" | "select" | "update"
>;

type ServiceOrderNumberingSettings = {
  numberingTemplate: string;
  numberingScope: "organization" | "unit";
};

export const DEFAULT_SERVICE_ORDER_NUMBERING_SETTINGS: ServiceOrderNumberingSettings =
  {
    numberingTemplate: "OS-{YYYY}-{SEQ}",
    numberingScope: "unit",
  };

function pad(value: number, length: number) {
  return String(value).padStart(length, "0");
}

function renderTemplate(template: string, tokens: Record<string, string>) {
  return template.replace(
    /\{([A-Z]+)\}/g,
    (match, token) => tokens[token] ?? match,
  );
}

async function getOrCreateServiceOrderSettings(
  organizationId: string,
  executor: ServiceOrderNumberingDbExecutor,
) {
  const [existing] = await executor
    .select()
    .from(serviceOrderSettings)
    .where(eq(serviceOrderSettings.organizationId, organizationId))
    .limit(1);

  if (existing) {
    return existing;
  }

  const [created] = await executor
    .insert(serviceOrderSettings)
    .values({
      organizationId,
      ...DEFAULT_SERVICE_ORDER_NUMBERING_SETTINGS,
    })
    .onConflictDoNothing({
      target: serviceOrderSettings.organizationId,
    })
    .returning();

  if (created) {
    return created;
  }

  const [createdByConcurrentRequest] = await executor
    .select()
    .from(serviceOrderSettings)
    .where(eq(serviceOrderSettings.organizationId, organizationId))
    .limit(1);

  if (!createdByConcurrentRequest) {
    throw new Error("Falha ao criar configuracoes de OS");
  }

  return createdByConcurrentRequest;
}

async function reserveNextSequence(params: {
  organizationId: string;
  unitId: number | null;
  sequenceKey: string;
  executor: ServiceOrderNumberingDbExecutor;
}) {
  const [sequence] = await params.executor
    .insert(serviceOrderNumberingSequence)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      sequenceKey: params.sequenceKey,
      currentValue: 1,
    })
    .onConflictDoUpdate({
      target: [
        serviceOrderNumberingSequence.organizationId,
        serviceOrderNumberingSequence.unitId,
        serviceOrderNumberingSequence.sequenceKey,
      ],
      set: {
        currentValue: sql`${serviceOrderNumberingSequence.currentValue} + 1`,
        updatedAt: new Date(),
      },
    })
    .returning();

  if (!sequence?.currentValue) {
    throw new Error("Falha ao reservar sequencia da OS");
  }

  return sequence.currentValue;
}

export async function generateServiceOrderNumber(
  context: {
    organizationId: string;
    unitId: number;
    generatedAt: Date;
  },
  executor?: ServiceOrderNumberingDbExecutor,
) {
  const run = async (tx: ServiceOrderNumberingDbExecutor) => {
    const settings = await getOrCreateServiceOrderSettings(
      context.organizationId,
      tx,
    );
    const [unit] = await tx
      .select({
        id: organizationUnit.id,
        slug: organizationUnit.slug,
        name: organizationUnit.name,
      })
      .from(organizationUnit)
      .where(eq(organizationUnit.id, context.unitId))
      .limit(1);

    if (!unit) {
      throw new Error("Unidade nao encontrada");
    }

    const year = context.generatedAt.getFullYear();
    const sequenceKey = `year:${year}`;
    const sequenceUnitId =
      settings.numberingScope === "unit" ? context.unitId : null;

    for (let attempt = 0; attempt < 25; attempt += 1) {
      const sequence = await reserveNextSequence({
        organizationId: context.organizationId,
        unitId: sequenceUnitId,
        sequenceKey,
        executor: tx,
      });

      const number = renderTemplate(settings.numberingTemplate, {
        YYYY: String(year),
        YY: String(year).slice(-2),
        UNIT: unit.slug.toUpperCase(),
        SEQ: pad(sequence, 6),
      });

      const [collision] = await tx
        .select({ id: serviceOrder.id })
        .from(serviceOrder)
        .where(
          and(
            eq(serviceOrder.organizationId, context.organizationId),
            eq(serviceOrder.serviceOrderNumber, number),
          ),
        )
        .limit(1);

      if (!collision) {
        return {
          number,
          sequence,
          sequenceKey,
          sequenceUnitId,
        };
      }
    }

    throw new Error("Nao foi possivel gerar um numero unico de OS");
  };

  return executor ? run(executor) : db.transaction(run);
}

export async function resetServiceOrderNextNumber(params: {
  organizationId: string;
  unitId: number | null;
  sequenceKey: string;
  nextNumber: number;
}) {
  const currentValue = Math.max(params.nextNumber - 1, 0);
  await db
    .insert(serviceOrderNumberingSequence)
    .values({
      organizationId: params.organizationId,
      unitId: params.unitId,
      sequenceKey: params.sequenceKey,
      currentValue,
    })
    .onConflictDoUpdate({
      target: [
        serviceOrderNumberingSequence.organizationId,
        serviceOrderNumberingSequence.unitId,
        serviceOrderNumberingSequence.sequenceKey,
      ],
      set: { currentValue, updatedAt: new Date() },
    });
}
