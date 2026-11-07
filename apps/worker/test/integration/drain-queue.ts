import {
  processQueueBatch,
  type QueueRuntimeConfig,
  type WorkerEnv,
} from "../../src/queue-runtime";

// "Run to empty": what the poller does one batch per tick, repeated until a tick
// finds nothing. `maxBatches` is a runaway guard. Returns the jobs processed.
export async function drainQueue(
  env: WorkerEnv,
  config: QueueRuntimeConfig,
  maxBatches = 1_000,
  isStopping: () => boolean = () => false,
): Promise<number> {
  let processed = 0;
  for (let batch = 0; batch < maxBatches && !isStopping(); batch += 1) {
    const count = await processQueueBatch(env, config, isStopping);
    if (count === 0) break;
    processed += count;
  }

  return processed;
}
