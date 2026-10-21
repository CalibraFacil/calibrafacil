import { isApiErrorCode, type ApiErrorCode } from "@calibra-facil/contracts";

export class CalibraApiError extends Error {
  /**
   * Stable machine-readable error code from the API body (`{ error, code }`),
   * when the server sent one this client knows. Branch on this, not on the
   * pt-BR `message`. Undefined for bodies without a code.
   */
  readonly code: ApiErrorCode | undefined;

  constructor(
    message: string,
    public readonly status: number,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "CalibraApiError";
    this.code = readApiErrorCode(payload);
  }
}

function readApiErrorCode(payload: unknown): ApiErrorCode | undefined {
  if (typeof payload !== "object" || payload === null) return undefined;
  const code: unknown = Reflect.get(payload, "code");
  return isApiErrorCode(code) ? code : undefined;
}
