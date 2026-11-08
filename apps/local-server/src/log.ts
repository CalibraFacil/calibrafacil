import { createLogger } from "@calibra-facil/shared/telemetry";

/** The package's structured logger: Error fields are written scrubbed. */
export const log = createLogger("local-server");
