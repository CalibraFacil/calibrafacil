import { describe, expect, it } from "vitest";

import { integrationEndpoints } from "./integrations";
import {
  buildContaAzulAppSaveResponse,
  buildContaAzulAppSummary,
  buildContaAzulCatalogResponse,
  buildContaAzulPollResult,
  buildContaAzulScheduleResponse,
  buildIntegrationDriftQueueResponse,
  buildIntegrationRunItemsResponse,
  buildIntegrationsResponse,
  buildSyncPreviewResponse,
} from "./integrations.fixtures";

describe("integration endpoint fixtures", () => {
  it("are valid against the response schemas of their endpoints", () => {
    const cases = [
      [integrationEndpoints.list, buildIntegrationsResponse()],
      [integrationEndpoints.getContaAzulApp, buildContaAzulAppSummary()],
      [integrationEndpoints.saveContaAzulApp, buildContaAzulAppSaveResponse()],
      [
        integrationEndpoints.listContaAzulCatalog,
        buildContaAzulCatalogResponse(),
      ],
      [integrationEndpoints.pollContaAzul, buildContaAzulPollResult()],
      [
        integrationEndpoints.getContaAzulSchedule,
        buildContaAzulScheduleResponse(),
      ],
      [integrationEndpoints.previewSync, buildSyncPreviewResponse()],
      [integrationEndpoints.listRunItems, buildIntegrationRunItemsResponse()],
      [integrationEndpoints.listDrift, buildIntegrationDriftQueueResponse()],
    ] as const;

    for (const [def, fixture] of cases) {
      expect(def.response.safeParse(fixture).success).toBe(true);
    }
  });
});
