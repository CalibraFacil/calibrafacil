import {
  trainingRecordEndpoints,
  type ResponseValidationOptions,
} from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The training-records client is its endpoint group (`trainingRecordEndpoints` in `@calibra-facil/contracts`). */
export type TrainingRecordsApi = EndpointClient<typeof trainingRecordEndpoints>;

export function createTrainingRecordsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): TrainingRecordsApi {
  return endpointClient(trainingRecordEndpoints, transport, options);
}
