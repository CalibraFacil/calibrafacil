import { readFile } from "node:fs/promises";
import path from "node:path";

import { writeJsonFileAtomically } from "./atomic-json-file";
import {
  localDatabasePartitionSchema,
  type LocalDatabasePartition,
} from "@calibra-facil/contracts";
import { z } from "zod";

/**
 * The last identity this device authorized online.
 *
 * Exists for one reason: offline startup. A technician opening a laptop with
 * no signal has no way to prove who they are, so the host opens the partition
 * that was last authorized *here* and nothing else. Anything beyond that —
 * switching to a different account — waits for a connection.
 *
 * Remembering is not authenticating, and the activation policy treats it that
 * way: this record chooses which database may be opened offline, never whether
 * someone may open it.
 */
const rememberedPartitionSchema = z.object({
  partition: localDatabasePartitionSchema,
  authorizedAt: z.string(),
});

export type RememberedLocalPartition = z.infer<
  typeof rememberedPartitionSchema
>;

const storeDirectory = "settings";
const storeFileName = "local-partition.json";

export class LocalPartitionStore {
  private cached: RememberedLocalPartition | null = null;
  private loaded = false;
  private readonly filePath: string;

  constructor(userDataPath: string) {
    this.filePath = path.join(userDataPath, storeDirectory, storeFileName);
  }

  async load(): Promise<RememberedLocalPartition | null> {
    if (this.loaded) return this.cached;
    this.loaded = true;

    try {
      const parsed = rememberedPartitionSchema.safeParse(
        JSON.parse(await readFile(this.filePath, "utf8")),
      );
      this.cached = parsed.success ? parsed.data : null;
    } catch {
      // Missing or corrupt: fall back to "no offline access", which costs a
      // sign-in rather than opening a database on a damaged claim.
      this.cached = null;
    }

    return this.cached;
  }

  async remember(
    partition: LocalDatabasePartition,
    authorizedAt = new Date().toISOString(),
  ): Promise<RememberedLocalPartition> {
    const record = { partition, authorizedAt };
    this.cached = record;
    this.loaded = true;
    await this.persist(record);

    return record;
  }

  /**
   * Forget the offline-access grant. Deliberately does **not** touch the
   * database it points at: the account's queued field work stays where it is,
   * to be resumed when they authenticate again.
   */
  async forget(): Promise<void> {
    this.cached = null;
    this.loaded = true;
    await this.persist(null);
  }

  private async persist(record: RememberedLocalPartition | null) {
    await writeJsonFileAtomically(this.filePath, record);
  }
}
