import { SERVICE_ORDER_STATUS } from "@calibra-facil/shared/service-orders";
import { describe, expect, it } from "vitest";
import { getServiceOrderStatus } from "./status-labels";

describe("getServiceOrderStatus", () => {
  it("reads every known status from the shared vocabulary", () => {
    for (const status of SERVICE_ORDER_STATUS.states) {
      expect(getServiceOrderStatus(status)).toEqual({
        label: SERVICE_ORDER_STATUS.label(status),
        tone: SERVICE_ORDER_STATUS.tone(status),
      });
    }
  });

  it("shows an unknown status as unknown instead of as a plausible state", () => {
    expect(getServiceOrderStatus("ARCHIVED")).toEqual({
      label: "Status desconhecido (ARCHIVED)",
      tone: "warning",
    });
  });
});
