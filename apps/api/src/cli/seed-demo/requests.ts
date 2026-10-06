import { db } from "@calibra-facil/db";
import {
  calibrationJob,
  calibrationRequest,
  customer,
  member,
  serviceOrder,
  user,
} from "@calibra-facil/db/schema";
import { and, eq } from "drizzle-orm";

import { LAB_ID, isRecord, numberField, recordOf } from "./api";
import type { SeededAsset } from "./assets";
import type { SeedContext } from "./context";
import { DEMO_CUSTOMERS, type CustomerIds } from "./customers";
import { isCalibratable } from "./job-plan";
import { DEMO_SERVICES, type ServiceIds } from "./services";
import { labTimeOnDay } from "./dates";

const DAY_MS = 86_400_000;

type RequestSpec = {
  key: string;
  assets: number;
  delivery: "dropoff" | "onsite";
  observations: string;
  outcome:
    | "pending"
    | "under_review"
    | "rejected"
    | "visit_confirmed"
    | "visit_proposed";
  createdDaysAgo: number;
};

const REQUESTS: readonly RequestSpec[] = [
  {
    key: "R1",
    assets: 2,
    delivery: "dropoff",
    observations:
      "Instrumentos da linha de produção; precisamos dos certificados antes da auditoria do cliente.",
    outcome: "pending",
    createdDaysAgo: 1,
  },
  {
    key: "R2",
    assets: 2,
    delivery: "dropoff",
    observations: "Recalibração periódica conforme o plano de metrologia.",
    outcome: "under_review",
    createdDaysAgo: 3,
  },
  {
    key: "R3",
    assets: 2,
    delivery: "onsite",
    observations:
      "Os instrumentos não podem sair da planta; solicitamos a calibração no local.",
    outcome: "visit_confirmed",
    createdDaysAgo: 6,
  },
  {
    key: "R4",
    assets: 1,
    delivery: "onsite",
    observations:
      "Calibração in loco do instrumento instalado na bancada de ensaios.",
    outcome: "visit_proposed",
    createdDaysAgo: 4,
  },
  {
    key: "R5",
    assets: 1,
    delivery: "dropoff",
    observations: "Calibração do instrumento reserva do almoxarifado.",
    outcome: "rejected",
    createdDaysAgo: 12,
  },
];

function serviceNameForType(typeSlug: string): string {
  const spec = DEMO_SERVICES.find((entry) => {
    if (!entry.templateKey) return false;
    return entry.assetTypeSlug === typeSlug;
  });
  if (!spec) throw new Error(`No calibration service for ${typeSlug}`);
  return spec.name;
}

/**
 * Customer requests, as they arrive from the portal: a portal user of the
 * customer files them (so their name shows up in the lab's queue), and the lab
 * triages them. Two stay pending/under review (the dashboard's intake tile), two
 * on-site requests are approved and converted into scheduled visits, one is
 * declined.
 */
export async function seedRequests(
  ctx: SeedContext,
  assets: readonly SeededAsset[],
  customerIds: CustomerIds,
  serviceIds: ServiceIds,
): Promise<void> {
  const [existing] = await db
    .select({ id: calibrationRequest.id })
    .from(calibrationRequest)
    .where(eq(calibrationRequest.organizationId, LAB_ID))
    .limit(1);
  if (existing) {
    ctx.log("  requests: already seeded");
    return;
  }

  const busy = new Set<number>();
  for (const row of await db
    .select({ id: calibrationJob.assetId })
    .from(calibrationJob))
    busy.add(row.id);
  for (const row of await db
    .select({ id: serviceOrder.assetId })
    .from(serviceOrder))
    busy.add(row.id);
  const spareByCustomer = new Map<string, SeededAsset[]>();
  for (const asset of assets) {
    if (
      busy.has(asset.id) ||
      asset.status !== "ACTIVE" ||
      !isCalibratable(asset.typeSlug)
    )
      continue;
    const list = spareByCustomer.get(asset.customerCode) ?? [];
    list.push(asset);
    spareByCustomer.set(asset.customerCode, list);
  }

  for (const spec of REQUESTS) {
    // The customer with the most instruments still to place.
    const [code, pool] =
      [...spareByCustomer.entries()].sort(
        (a, b) => b[1].length - a[1].length,
      )[0] ?? [];
    if (!code || !pool || pool.length < spec.assets)
      throw new Error(`Not enough spare instruments for ${spec.key}`);
    const picked = pool.splice(0, spec.assets);
    const entry = DEMO_CUSTOMERS.find((candidate) => candidate.code === code);
    const customerId = customerIds.get(code);
    if (!entry || !customerId) throw new Error(`Unknown customer ${code}`);

    const [customerRow] = await db
      .select({ authOrganizationId: customer.authOrganizationId })
      .from(customer)
      .where(eq(customer.id, customerId))
      .limit(1);
    if (!customerRow) throw new Error(`Customer ${customerId} vanished`);
    const portalUserId = `portal-${code.toLowerCase()}`;
    await db
      .insert(user)
      .values({
        id: portalUserId,
        name: `Responsável da qualidade (${entry.tradeName})`,
        email: entry.email,
        emailVerified: true,
      })
      .onConflictDoNothing();
    await db
      .insert(member)
      .values({
        id: `member-${customerRow.authOrganizationId}-${portalUserId}`,
        organizationId: customerRow.authOrganizationId,
        userId: portalUserId,
        role: "client_user",
        createdAt: ctx.now,
      })
      .onConflictDoNothing();

    const filed = await ctx.api.portalCall(
      { userId: portalUserId, organizationId: customerRow.authOrganizationId },
      "POST",
      "/api/portal/requests",
      {
        assetIds: picked.map((asset) => asset.id),
        observations: spec.observations,
        deliveryMethod: spec.delivery,
        requestedDueDate: new Date(
          ctx.now.getTime() + 14 * DAY_MS,
        ).toISOString(),
        ...(spec.delivery === "onsite"
          ? {
              preferredVisitDate: new Date(
                ctx.now.getTime() + 5 * DAY_MS,
              ).toISOString(),
            }
          : {}),
      },
    );
    const body = recordOf(filed, "request");
    const requestId = numberField(isRecord(body.data) ? body.data : body, "id");
    const base = `/api/calibration-requests/${requestId}`;

    if (spec.outcome === "under_review") {
      await ctx.api.call("owner", "POST", `${base}/review`, {
        internalNotes: "Conferindo escopo e prazo com o cliente.",
      });
    } else if (spec.outcome === "rejected") {
      await ctx.api.call("owner", "POST", `${base}/reject`, {
        reason:
          "Instrumento reserva sem uso declarado; solicitar novamente quando for colocado em operação.",
      });
    } else if (
      spec.outcome === "visit_confirmed" ||
      spec.outcome === "visit_proposed"
    ) {
      await ctx.api.call("owner", "POST", `${base}/approve`, {
        internalNotes: "Visita técnica a agendar.",
      });
      const detail = recordOf(
        await ctx.api.call("owner", "GET", base),
        "request detail",
      );
      const items = Array.isArray(detail.items) ? detail.items : [];
      const confirmed = spec.outcome === "visit_confirmed";
      const visitDay = confirmed ? 2 : 8;
      const scheduledAt = labTimeOnDay(ctx.now, visitDay, 9);
      await ctx.api.call("owner", "POST", `${base}/convert`, {
        items: items.map((item, index) => {
          const asset = picked[index];
          if (!asset) throw new Error("Request item without a planned asset");
          const serviceId = serviceIds.get(serviceNameForType(asset.typeSlug));
          if (!serviceId)
            throw new Error(`Service missing for ${asset.typeSlug}`);
          return {
            itemId: numberField(item, "id"),
            serviceId,
            technicianId: "demo-technician",
            dueDate: labTimeOnDay(ctx.now, visitDay + 2, 17).toISOString(),
          };
        }),
        visit: {
          scheduledAt: scheduledAt.toISOString(),
          technicianId: "demo-technician",
        },
      });
      if (confirmed) {
        const visits = recordOf(
          await ctx.api.call("owner", "GET", `/api/visits?status=PROPOSED`),
          "visits",
        );
        const rows = Array.isArray(visits.data) ? visits.data : [];
        const visit = rows.find(
          (row) => isRecord(row) && row.sourceRequestId === requestId,
        );
        if (visit) {
          await ctx.api.call(
            "owner",
            "POST",
            `/api/visits/${numberField(visit, "id")}/confirm`,
            {
              scheduledAt: scheduledAt.toISOString(),
              technicianId: "demo-technician",
            },
          );
        }
      }
    }

    const filedAt = new Date(ctx.now.getTime() - spec.createdDaysAgo * DAY_MS);
    await db
      .update(calibrationRequest)
      .set({ createdAt: filedAt, updatedAt: filedAt })
      .where(and(eq(calibrationRequest.id, requestId)));
    ctx.log(
      `  request ${spec.key} #${requestId} (${entry.tradeName}) -> ${spec.outcome}`,
    );
  }
}
