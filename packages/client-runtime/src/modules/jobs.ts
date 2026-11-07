import {
  effectiveEnvironmentalLimitsResponseSchema,
  jobEndpoints,
  standardsListResponseSchema,
  validateResponsePayload,
  type EffectiveEnvironmentalLimitsResponse,
  type ResponseValidationOptions,
  type StandardsListResponse,
} from "@calibra-facil/contracts";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";
import { readApiError, readJsonResponse } from "../transport/response";
import { apiRouteParam } from "../transport/url";

/**
 * The jobs client is its endpoint group (`jobEndpoints` in
 * `@calibra-facil/contracts`) plus three methods that are client-side logic:
 * the label commands (plain text, not JSON) and the two reads of other domains'
 * routes a worksheet needs (the active standards and the effective
 * environmental limits).
 */
export type JobsApi = EndpointClient<typeof jobEndpoints> & {
  /** The active reference standards a worksheet can pick from. */
  listStandards(): Promise<StandardsListResponse>;
  getEffectiveEnvironmentalLimits(
    assetTypeId: string | number,
    input?: { unitId?: string | number | null },
  ): Promise<EffectiveEnvironmentalLimitsResponse>;
  /** Native printer commands (ZPL/TSPL) for direct thermal printing (text). */
  getLabelCommands(
    jobId: string | number,
    options?: { language?: "zpl" | "tspl"; dpi?: 203 | 300 },
  ): Promise<string>;
};

const JOB_ID_SEGMENT = /^(\/api\/jobs\/)([^/]+)/;
/** Static segments of `/api/jobs/...` that are not a job identifier. */
const STATIC_JOB_SEGMENTS = new Set(["technicians"]);

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * A job is addressed by its numeric id or its job code ("R-0001/2026"), which
 * the API reads from a doubly encoded segment. The endpoint client encodes a
 * path parameter once, so the job identifier is normalised here, the way
 * `apiRouteParam` always did (whether the caller holds the code decoded or
 * already encoded).
 */
function withNormalizedJobIds(transport: EndpointTransport): EndpointTransport {
  return (request) =>
    transport({
      ...request,
      path: request.path.replace(JOB_ID_SEGMENT, (match, prefix, segment) =>
        STATIC_JOB_SEGMENTS.has(segment)
          ? match
          : `${prefix}${apiRouteParam(safeDecode(segment))}`,
      ),
    });
}

export function createJobsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions = {},
): JobsApi {
  const client = endpointClient(
    jobEndpoints,
    withNormalizedJobIds(transport),
    options,
  );

  return {
    ...client,
    async listStandards() {
      const response = await transport({
        method: "GET",
        path: "/api/standards",
        query: new URLSearchParams({ status: "ACTIVE", limit: "100" }),
        body: undefined,
      });
      return validateResponsePayload(
        standardsListResponseSchema,
        await readJsonResponse<unknown>(response, "Falha ao carregar padrões"),
        "GET /api/standards",
        options,
      );
    },
    async getEffectiveEnvironmentalLimits(assetTypeId, input = {}) {
      const query = new URLSearchParams();
      if (input.unitId) query.set("unitId", String(input.unitId));
      const response = await transport({
        method: "GET",
        path: `/api/environmental-limits/effective/${encodeURIComponent(String(assetTypeId))}`,
        query,
        body: undefined,
      });

      if (!response.ok) {
        return { limits: null, source: null };
      }

      return validateResponsePayload(
        effectiveEnvironmentalLimitsResponseSchema,
        await response.json(),
        "GET /api/environmental-limits/effective/:assetTypeId",
        options,
      );
    },
    async getLabelCommands(jobId, labelOptions) {
      const query = new URLSearchParams();
      if (labelOptions?.language) query.set("lang", labelOptions.language);
      if (labelOptions?.dpi) query.set("dpi", String(labelOptions.dpi));
      const response = await transport({
        method: "GET",
        path: `/api/jobs/${apiRouteParam(jobId)}/label-commands`,
        query,
        body: undefined,
      });
      if (!response.ok) {
        throw new CalibraApiError(
          await readApiError(response, "Falha ao gerar comandos da etiqueta"),
          response.status,
          null,
        );
      }
      return response.text();
    },
  };
}
