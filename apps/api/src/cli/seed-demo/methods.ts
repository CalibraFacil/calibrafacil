import {
  listTemplates,
  type TemplateModule,
} from "@calibra-facil/method-templates";
import { db } from "@calibra-facil/db";
import { calibrationMethod, type MethodStatus } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, numberField, recordOf, stringField } from "./api";
import type { SeedContext, SeedRefs } from "./context";

/**
 * Which catalog templates the demo lab adopts, and the asset type each adopted
 * method is bound to. Only methods whose certificate the worker can issue are
 * adopted: the `humidity-magnus` and `volume-glassware` templates are built on
 * GUM measurement models and cannot produce a certificate in this version, so a
 * demo job on them could never leave "issuing".
 */
export const DEMO_METHODS = [
  { templateKey: "weighing-instrument", assetTypeSlug: "balanca-digital" },
  { templateKey: "electrical-indication", assetTypeSlug: "multimetro-digital" },
  { templateKey: "force-indication", assetTypeSlug: "dinamometro" },
  { templateKey: "frequency-indication", assetTypeSlug: "tacometro" },
] as const;

export type DemoTemplateKey = (typeof DEMO_METHODS)[number]["templateKey"];

const METHOD_STATUSES: readonly MethodStatus[] = [
  "DRAFT",
  "PENDING_APPROVAL",
  "TECHNICAL_REVIEWED",
  "PUBLISHED",
  "ARCHIVED",
];

function toMethodStatus(value: string): MethodStatus {
  const match = METHOD_STATUSES.find((status) => status === value);
  if (!match) throw new Error(`Unexpected method status ${value}`);
  return match;
}

function findTemplate(key: string): TemplateModule {
  const template = listTemplates().find((candidate) => candidate.key === key);
  if (!template) throw new Error(`Method template not found: ${key}`);
  return template;
}

/** The laboratory's own procedure codes, printed under "Procedimento" on certificates. */
const PROCEDURE_CODES: Readonly<Record<DemoTemplateKey, string>> = {
  "weighing-instrument": "PO-CAL-001 rev. 03 (EURAMET cg-18 v4.0)",
  "electrical-indication": "PO-CAL-004 rev. 02 (EA-4/02 M:2022)",
  "force-indication": "PO-CAL-006 rev. 01 (EURAMET cg-4 v3.0)",
  "frequency-indication": "PO-CAL-007 rev. 01 (EA-4/02 M:2022)",
};

/**
 * A catalog template ships a placeholder where the laboratory's own procedure
 * code goes; adopting a method includes filling it in before review.
 */
async function setProcedureCode(
  ctx: SeedContext,
  methodId: number,
  key: DemoTemplateKey,
  template: TemplateModule,
): Promise<void> {
  // The update schema re-applies defaults to absent fields, so a partial body
  // would blank the formulas: send the whole draft back, as the editor does.
  const [row] = await db
    .select()
    .from(calibrationMethod)
    .where(eq(calibrationMethod.id, methodId))
    .limit(1);
  if (!row) throw new Error(`Method ${methodId} vanished`);
  const current = template.productDefinition.certificateContent;
  await ctx.api.call("owner", "PUT", `/api/methods/${methodId}`, {
    assetTypeId: row.assetTypeId,
    name: row.name,
    description: row.description,
    dataFields: row.dataFields,
    variableBindings: row.variableBindings,
    formulas: row.formulas,
    measurementModels: row.measurementModels,
    validations: row.validations,
    uncertaintyParams: row.uncertaintyParams,
    accreditedScope: row.accreditedScope,
    certificateContent: { ...current, procedureCode: PROCEDURE_CODES[key] },
  });
}

/** methodId by template key, after the method is PUBLISHED. */
export type MethodIds = Map<DemoTemplateKey, number>;

/**
 * Adopts each catalog template and walks it through the real publication
 * gates: draft -> request approval (owner) -> technical review (an admin who is
 * not the owner) -> quality approval (owner, a different person than the
 * reviewer). Re-running reuses methods that are already PUBLISHED.
 */
export async function seedMethods(
  ctx: SeedContext,
  refs: SeedRefs,
): Promise<MethodIds> {
  const ids: MethodIds = new Map();

  for (const entry of DEMO_METHODS) {
    const template = findTemplate(entry.templateKey);
    const name = template.defaultName;
    const assetTypeId = refs.assetTypeIds.get(entry.assetTypeSlug);
    if (!assetTypeId)
      throw new Error(`Unknown asset type ${entry.assetTypeSlug}`);

    const [existing] = await db
      .select({ id: calibrationMethod.id, status: calibrationMethod.status })
      .from(calibrationMethod)
      .where(
        and(
          eq(calibrationMethod.organizationId, LAB_ID),
          eq(calibrationMethod.name, name),
          eq(calibrationMethod.version, 1),
        ),
      )
      .limit(1);

    let methodId = existing?.id;
    let status = existing?.status;

    if (methodId === undefined) {
      const actionRefs = (template.governance?.verificarItems ?? [])
        .filter((item) => item.severity === "action")
        .map((item) => item.ref)
        .filter((ref): ref is string => typeof ref === "string");
      const created = await ctx.api.call(
        "owner",
        "POST",
        "/api/methods/from-template",
        {
          templateKey: template.key,
          assetTypeId,
          name,
          acknowledgements: {
            readVerificarAndOmitted: true,
            acceptsVerificationDuty: true,
            understandsDraftGate: true,
            acknowledgedAt: ctx.now.toISOString(),
            templateVersion: template.templateVersion,
            acceptedVerificarRefs: actionRefs,
          },
        },
      );
      methodId = numberField(created, "id");
      status = toMethodStatus(stringField(created, "status"));
    }

    if (status === "DRAFT") {
      await setProcedureCode(ctx, methodId, entry.templateKey, template);
      const sampleData = template.previewScenarios[0]?.inputs;
      await ctx.api.call(
        "owner",
        "POST",
        `/api/methods/${methodId}/request-approval`,
        { sampleData },
      );
      status = "PENDING_APPROVAL";
    }
    if (status === "PENDING_APPROVAL") {
      await ctx.api.call(
        "reviewer",
        "POST",
        `/api/methods/${methodId}/technical-review`,
        {},
      );
      status = "TECHNICAL_REVIEWED";
    }
    if (status === "TECHNICAL_REVIEWED") {
      const published = await ctx.api.call(
        "owner",
        "POST",
        `/api/methods/${methodId}/quality-approve`,
        {
          reasonForChange:
            "Adoção inicial do modelo da biblioteca para o laboratório de demonstração.",
        },
      );
      status = toMethodStatus(
        stringField(recordOf(published, "method"), "status"),
      );
    }
    if (status !== "PUBLISHED") {
      throw new Error(`Method ${name} ended as ${status}, expected PUBLISHED`);
    }
    ids.set(entry.templateKey, methodId);
    ctx.log(`  method ${entry.templateKey} -> #${methodId} PUBLISHED`);
  }

  return ids;
}
