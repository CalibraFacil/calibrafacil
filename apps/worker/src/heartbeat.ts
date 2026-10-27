// Liveness marker for the container healthcheck (deploy/compose.yaml). The
// worker has no HTTP port, so each poll tick touches a file and the check
// reads its age: a loop that stopped ticking (a wedged process, a dead database
// connection that never returns) turns the container unhealthy.
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const WORKER_HEARTBEAT_FILE = join(tmpdir(), "calibra-worker-heartbeat");

/** Records "alive now". A failure to write must never stop the queue loop. */
export async function touchHeartbeat(
  path: string = WORKER_HEARTBEAT_FILE,
  now: () => number = Date.now,
): Promise<void> {
  try {
    await writeFile(path, `${now()}\n`);
  } catch (error) {
    console.error("[Worker] could not write the heartbeat file", error);
  }
}
