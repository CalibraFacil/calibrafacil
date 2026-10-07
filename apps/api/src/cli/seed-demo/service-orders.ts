import { db } from "@calibra-facil/db";
import { calibrationJob, serviceOrder } from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, isRecord, numberField, recordOf, stringField } from "./api";
import type { SeededAsset } from "./assets";
import type { SeedContext } from "./context";
import { DEMO_CUSTOMERS } from "./customers";
import type { CustomerIds } from "./customers";

const DAY_MS = 86_400_000;

/** Service-order routes wrap their payload as `{ data }`. */
function payload(body: unknown): unknown {
  const record = recordOf(body, "response");
  return isRecord(record.data) ? record.data : record;
}

type OrderSpec = {
  typeSlug: string;
  customerCode?: string;
  /** How far the order goes: each stage includes the previous ones. */
  stage: "opened" | "evaluating" | "quoted" | "repairing" | "delivered";
  openedDaysAgo: number;
  claimedDefect: string;
  intakeCondition: string;
  priority?: "normal" | "urgent";
  diagnosis?: string;
  quoteItems?: Array<{
    type: "service" | "part";
    description: string;
    quantity: number;
    unitPriceCents: number;
  }>;
};

const ORDERS: readonly OrderSpec[] = [
  {
    typeSlug: "balanca-digital",
    stage: "opened",
    openedDaysAgo: 0,
    claimedDefect:
      "O display oscila e a leitura não estabiliza com carga sobre o prato.",
    intakeCondition:
      "Recebida limpa, sem avarias aparentes; acompanha cabo de força e prato.",
  },
  {
    typeSlug: "manometro",
    stage: "evaluating",
    openedDaysAgo: 2,
    claimedDefect: "O ponteiro não retorna ao zero depois de despressurizar.",
    intakeCondition:
      "Vidro do mostrador íntegro; conexão com sinais de corrosão.",
    diagnosis:
      "Mecanismo Bourdon com fadiga e engrenagem do setor desgastada; zero deslocado.",
  },
  {
    typeSlug: "balanca-digital",
    stage: "quoted",
    openedDaysAgo: 5,
    priority: "urgent",
    claimedDefect:
      "A balança indica valores diferentes para a mesma massa em posições distintas do prato.",
    intakeCondition:
      "Estrutura em bom estado; um dos pés niveladores quebrado.",
    diagnosis:
      "Célula de carga com desvio de excentricidade; pé nivelador danificado.",
    quoteItems: [
      {
        type: "service",
        description: "Ajuste de excentricidade e linearidade",
        quantity: 1,
        unitPriceCents: 28000,
      },
      {
        type: "part",
        description: "Pé nivelador",
        quantity: 1,
        unitPriceCents: 3500,
      },
      {
        type: "service",
        description: "Calibração pós-reparo",
        quantity: 1,
        unitPriceCents: 21000,
      },
    ],
  },
  {
    typeSlug: "termometro-digital",
    stage: "repairing",
    openedDaysAgo: 9,
    claimedDefect: "Leitura trava em -- e o sensor não responde.",
    intakeCondition:
      "Sonda com cabo parcialmente descascado; carcaça sem trincas.",
    diagnosis: "Cabo da sonda rompido próximo ao conector.",
    quoteItems: [
      {
        type: "part",
        description: "Sonda PT100 de reposição",
        quantity: 1,
        unitPriceCents: 14500,
      },
      {
        type: "service",
        description: "Troca de sonda e verificação",
        quantity: 1,
        unitPriceCents: 9000,
      },
    ],
  },
  {
    typeSlug: "paquimetro",
    stage: "delivered",
    openedDaysAgo: 26,
    claimedDefect: "Cursor travando no meio do curso.",
    intakeCondition: "Recebido com poeira de usinagem; escala legível.",
    diagnosis: "Resíduo de cavaco no trilho e mola do cursor desregulada.",
    quoteItems: [
      {
        type: "service",
        description: "Limpeza, lubrificação e regulagem",
        quantity: 1,
        unitPriceCents: 7500,
      },
    ],
  },
];

/**
 * Service orders in the states a counter and a bench produce: just received,
 * under evaluation, waiting for the customer's approval, being repaired, and one
 * that was delivered weeks ago. Each goes through the real commands up to its
 * stage; the opening dates are then spread over the last month.
 */
export async function seedServiceOrders(
  ctx: SeedContext,
  assets: readonly SeededAsset[],
  customerIds: CustomerIds,
): Promise<void> {
  const calibrated = new Set(
    (
      await db
        .select({ assetId: calibrationJob.assetId })
        .from(calibrationJob)
        .where(eq(calibrationJob.organizationId, LAB_ID))
    ).map((row) => row.assetId),
  );
  const taken = new Set(
    (
      await db
        .select({ assetId: serviceOrder.assetId })
        .from(serviceOrder)
        .where(eq(serviceOrder.organizationId, LAB_ID))
    ).map((row) => row.assetId),
  );

  for (const spec of ORDERS) {
    // An order is recognised by its claimed defect, so a re-run resumes it.
    const [existing] = await db
      .select({ id: serviceOrder.id })
      .from(serviceOrder)
      .where(
        and(
          eq(serviceOrder.organizationId, LAB_ID),
          eq(serviceOrder.claimedDefect, spec.claimedDefect),
        ),
      )
      .limit(1);

    let orderId = existing?.id;
    let customerLabel = "";
    if (orderId === undefined) {
      const asset = assets.find(
        (candidate) =>
          candidate.typeSlug === spec.typeSlug &&
          candidate.status === "ACTIVE" &&
          !taken.has(candidate.id) &&
          !calibrated.has(candidate.id),
      );
      if (!asset)
        throw new Error(`No free ${spec.typeSlug} for a service order`);
      taken.add(asset.id);
      const customerId = customerIds.get(asset.customerCode);
      if (!customerId)
        throw new Error(`Unknown customer ${asset.customerCode}`);
      const contact = DEMO_CUSTOMERS.find(
        (entry) => entry.code === asset.customerCode,
      );
      customerLabel = contact?.tradeName ?? "Cliente";
      const created = await ctx.api.call(
        "owner",
        "POST",
        "/api/service-orders",
        {
          customerId,
          assetId: asset.id,
          intakeType: "counter",
          priority: spec.priority ?? "normal",
          claimedDefect: spec.claimedDefect,
          intakeCondition: spec.intakeCondition,
          accessories: "Sem acessórios",
          deliveryMethod: "pickup_at_lab",
          clientContactSnapshot: contact
            ? {
                name: contact.tradeName,
                email: contact.email,
                phone: contact.phone,
              }
            : undefined,
        },
      );
      orderId = numberField(payload(created), "id");
    }
    const base = `/api/service-orders/${orderId}`;
    const status = async () =>
      stringField(payload(await ctx.api.call("owner", "GET", base)), "status");

    let current = await status();
    if (current === "awaiting_tech_evaluation" && spec.stage !== "opened") {
      await ctx.api.call("owner", "POST", `${base}/assign-technician`, {
        technicianId: "demo-technician",
      });
      if (spec.stage === "evaluating") {
        // The technician has the instrument on the bench and has not reported yet.
        await ctx.api.call("owner", "PATCH", base, {
          status: "under_evaluation",
        });
      } else {
        await ctx.api.call("technician", "POST", `${base}/evaluations`, {
          diagnosis: spec.diagnosis ?? "Diagnóstico concluído.",
          recommendedAction: "repair",
          requiresQuote: true,
          requiresClientApproval: true,
          calibrationRecommended: spec.typeSlug === "balanca-digital",
        });
      }
      current = await status();
    }
    if (current === "awaiting_quote_approval" && spec.quoteItems) {
      let detail = recordOf(
        payload(await ctx.api.call("owner", "GET", base)),
        "service order",
      );
      if (!Array.isArray(detail.quotes) || detail.quotes.length === 0) {
        const quote = await ctx.api.call("owner", "POST", `${base}/quotes`, {
          validUntil: new Date(ctx.now.getTime() + 15 * DAY_MS).toISOString(),
          paymentTerms: "Pagamento em 28 dias após a entrega.",
          deliveryEstimate: "5 dias úteis após a aprovação.",
          clientMessage:
            "Segue o orçamento do reparo conforme avaliação técnica.",
          items: spec.quoteItems.map((item) => ({
            ...item,
            unit: "un",
            taxable: true,
          })),
        });
        await ctx.api.call(
          "owner",
          "POST",
          `${base}/quotes/${numberField(payload(quote), "id")}/send`,
          {},
        );
        detail = recordOf(
          payload(await ctx.api.call("owner", "GET", base)),
          "service order",
        );
      }
      if (spec.stage === "repairing" || spec.stage === "delivered") {
        const list = Array.isArray(detail.quotes) ? detail.quotes : [];
        await ctx.api.call(
          "owner",
          "POST",
          `${base}/quotes/${numberField(list[0], "id")}/approve-manually`,
          {
            approvedByName: customerLabel || "Responsável do cliente",
            manualApprovalEvidenceType: "email",
            manualApprovalEvidenceText:
              "Aprovação recebida por e-mail do responsável pela qualidade.",
          },
        );
        await ctx.api.call("technician", "POST", `${base}/execution/start`, {
          notes: "Reparo iniciado após aprovação do orçamento.",
        });
      }
      current = await status();
    }
    if (current === "repair_in_progress" && spec.stage === "delivered") {
      await ctx.api.call("technician", "POST", `${base}/execution/finish`, {
        servicePerformed:
          "Limpeza do trilho, lubrificação e regulagem da mola do cursor; verificado em bloco padrão.",
        result: "repaired",
        calibrationRequiredAfterRepair: false,
      });
      current = await status();
    }
    if (current === "awaiting_final_review" && spec.stage === "delivered") {
      await ctx.api.call("owner", "PATCH", base, {
        status: "ready_for_pickup",
      });
      current = await status();
    }
    if (current === "ready_for_pickup" && spec.stage === "delivered") {
      await ctx.api.call("owner", "POST", `${base}/deliver`, {
        deliveryMethod: "pickup_at_lab",
        deliveredToName: "Representante do cliente",
      });
      current = await status();
    }
    if (current === "delivered" && spec.stage === "delivered") {
      await ctx.api.call("owner", "POST", `${base}/close`, {
        closingReason: "completed_repaired",
        createBillingDocument: false,
      });
      current = await status();
    }

    // Spread the opening over the last month: the commands stamped "now".
    const opened = new Date(
      ctx.now.getTime() - spec.openedDaysAgo * DAY_MS - 3 * 3_600_000,
    );
    await db
      .update(serviceOrder)
      .set({
        createdAt: opened,
        updatedAt: new Date(
          opened.getTime() + Math.min(spec.openedDaysAgo, 1) * 6 * 3_600_000,
        ),
      })
      .where(eq(serviceOrder.id, orderId));
    ctx.log(`  service order #${orderId} -> ${current}`);
  }
}
