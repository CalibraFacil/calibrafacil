import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { truncateAll } from "../../../../test/integration/db";
import { seedOrg } from "../../../../test/integration/seed";
import { withOrg } from "../../../lib/org-context";
import { generateServiceOrderNumber } from "../../service-orders/service-order-numbering";
import { generateBillingDocumentNumber } from "../finance";

/**
 * REQ-NUM-YEAR: a document number is named after the LABORATORY's calendar year
 * (America/Sao_Paulo), not the server's. At 02:30 UTC on 1 January the lab is
 * still on 31 December: the number belongs to the old year; an hour later it
 * belongs to the new one.
 */
const LAB_STILL_LAST_YEAR = new Date("2027-01-01T02:30:00.000Z");
const LAB_NEW_YEAR = new Date("2027-01-01T03:30:00.000Z");

describe("document numbers follow the laboratory's year", () => {
  beforeEach(async () => {
    await truncateAll();
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("REQ-NUM-YEAR-1: a billing document number uses the lab's year, with its own sequence per year", async () => {
    const lab = await seedOrg({ orgId: "lab-year-fin", role: "admin" });
    const actor = { userId: lab.userId, ipAddress: null };
    const next = (at: Date) => {
      vi.setSystemTime(at);
      return withOrg(lab.orgId, actor, (ctx) =>
        generateBillingDocumentNumber(lab.orgId, ctx.tx),
      );
    };

    expect(await next(LAB_STILL_LAST_YEAR)).toBe("FIN-2026-0001");
    expect(await next(LAB_NEW_YEAR)).toBe("FIN-2027-0001");
  });

  it("REQ-NUM-YEAR-2: a service order number uses the lab's year", async () => {
    const lab = await seedOrg({ orgId: "lab-year-os", role: "admin" });
    const actor = { userId: lab.userId, ipAddress: null };
    const next = (generatedAt: Date) =>
      withOrg(lab.orgId, actor, (ctx) =>
        generateServiceOrderNumber(
          {
            organizationId: lab.orgId,
            unitId: lab.unitId,
            generatedAt,
          },
          ctx.o,
        ),
      );

    expect((await next(LAB_STILL_LAST_YEAR)).number).toBe("OS-2026-000001");
    expect((await next(LAB_NEW_YEAR)).number).toBe("OS-2027-000001");
  });
});
