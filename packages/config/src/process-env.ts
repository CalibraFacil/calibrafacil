/**
 * The one sanctioned writer of `process.env`.
 *
 * A serverless runtime hands the app its settings as bindings per request, and
 * a CLI sets a variable for the code it is about to run; both mirror a value
 * into the process environment so the concern readers see it. Passing
 * `undefined` removes the variable.
 */
export function setProcessEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
