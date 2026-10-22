import { ConfigError } from "./define";

/**
 * Run a process's start-up. When it fails because the configuration is
 * invalid, print the aggregated message (no stack, no values) and exit
 * non-zero, so a bad deploy fails fast and readably; any other error
 * propagates untouched.
 */
export function failFast<T>(
  start: () => T,
  exit: (code: number) => never = (code) => process.exit(code),
): T {
  try {
    return start();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(error.message);
      return exit(1);
    }
    throw error;
  }
}
