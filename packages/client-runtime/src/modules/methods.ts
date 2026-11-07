import {
  endpointLabel,
  methodEndpoints,
  validateResponsePayload,
  type EndpointClientInput,
  type MethodBuilderResponse,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";
import { isRecord } from "@calibra-facil/shared/record";

import { CalibraApiError } from "../transport/errors";
import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

type BuilderMethod = "compileDraft" | "previewDraft";

/**
 * The methods client is its endpoint group (`methodEndpoints` in
 * `@calibra-facil/contracts`) plus the one client-side rule of the builder: a
 * draft that does not compile is answered with 422 and its diagnostics, and
 * those are a result for the builder to show, not an error to raise.
 */
export type MethodsApi = Omit<
  EndpointClient<typeof methodEndpoints>,
  BuilderMethod
> & {
  compileDraft(
    input: EndpointClientInput<typeof methodEndpoints.compileDraft>,
  ): Promise<MethodBuilderResponse>;
  previewDraft(
    input: EndpointClientInput<typeof methodEndpoints.previewDraft>,
  ): Promise<MethodBuilderResponse>;
};

export function createMethodsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): MethodsApi {
  const client = endpointClient(methodEndpoints, transport, options);

  async function withDiagnostics(
    definition:
      | typeof methodEndpoints.compileDraft
      | typeof methodEndpoints.previewDraft,
    call: () => Promise<MethodBuilderResponse>,
  ): Promise<MethodBuilderResponse> {
    try {
      return await call();
    } catch (error) {
      if (
        error instanceof CalibraApiError &&
        isRecord(error.payload) &&
        Array.isArray(error.payload.diagnostics)
      ) {
        return validateResponsePayload(
          definition.response,
          error.payload,
          endpointLabel(definition),
          options,
        );
      }
      throw error;
    }
  }

  return {
    ...client,
    compileDraft: (input) =>
      withDiagnostics(methodEndpoints.compileDraft, () =>
        client.compileDraft(input),
      ),
    previewDraft: (input) =>
      withDiagnostics(methodEndpoints.previewDraft, () =>
        client.previewDraft(input),
      ),
  };
}
