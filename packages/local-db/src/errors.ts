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
