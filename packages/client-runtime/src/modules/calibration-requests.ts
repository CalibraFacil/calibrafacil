import { calibrationRequestEndpoints } from "@calibra-facil/contracts";
import type { ResponseValidationOptions } from "@calibra-facil/contracts";

import {
  endpointClient,
  type EndpointClient,
  type EndpointTransport,
} from "../transport/endpoint-client";

/** The calibration requests client is its endpoint group (`calibrationRequestEndpoints` in `@calibra-facil/contracts`). */
export type CalibrationRequestsApi = EndpointClient<
  typeof calibrationRequestEndpoints
>;

export function createCalibrationRequestsApi(
  transport: EndpointTransport,
  options: ResponseValidationOptions,
): CalibrationRequestsApi {
  return endpointClient(calibrationRequestEndpoints, transport, options);
}
