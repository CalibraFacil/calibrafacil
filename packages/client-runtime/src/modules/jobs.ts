import {
  jobEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";
import { readApiError } from "../transport/response";
import { apiRouteParam } from "../transport/url";

/**
 * The jobs client is its endpoint group (`jobEndpoints` in
 * `@calibra-facil/contracts`) plus one method that is client-side logic: the
 * label commands (plain text, not JSON).
 */
export type JobsApi = EndpointClient<typeof jobEndpoints> & {
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
