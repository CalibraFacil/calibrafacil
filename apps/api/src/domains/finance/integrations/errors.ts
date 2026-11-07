export class ContaAzulReconnectRequiredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContaAzulReconnectRequiredError";
  }
}

export function isContaAzulReconnectRequiredError(
  error: unknown,
): error is ContaAzulReconnectRequiredError {
  return error instanceof ContaAzulReconnectRequiredError;
}
