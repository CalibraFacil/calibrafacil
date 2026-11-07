/**
 * A refusal the caller can act on: the request names something that does not
 * exist, or breaks a rule of the local data (a tag already in use). The local
 * server answers it with a 4xx and the message; any other error thrown under a
 * route is a bug of ours (a SQLite failure, a null dereference) and is a 500
 * whose message stays in the log.
 */
export class LocalDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalDomainError";
  }
}

/** The record a request is about is not in the local database (answered 404). */
export class LocalNotFoundError extends LocalDomainError {
  constructor(message: string) {
    super(message);
    this.name = "LocalNotFoundError";
  }
}

/**
 * A well-formed request that a business rule of the local data refuses (a
 * reference standard that is expired or not in the cache, a method execution
 * that does not compute). The local server answers 422 with the message, and
 * with `diagnostics` when the refusal carries them (the cloud's execute/submit
 * answer the same refusal with its method diagnostics).
 */
export class LocalUnprocessableError extends LocalDomainError {
  constructor(
    message: string,
    readonly diagnostics?: unknown,
  ) {
    super(message);
    this.name = "LocalUnprocessableError";
  }
}
