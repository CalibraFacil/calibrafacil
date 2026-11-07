import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Write JSON to disk without ever leaving a half-written file behind.
 *
 * Write to a temporary sibling, then rename — rename is atomic within a
 * filesystem, so a crash or a power cut mid-write leaves the previous file
 * intact rather than a truncated one. Every JSON store in the main process
 * (settings, secrets, window state, the partition store) writes through here,
 * so a hardening such as fsync before rename or retrying Windows `EPERM` is
 * made once.
 *
 * The temp name carries the pid and a timestamp so two processes, or two
 * writes racing within one, cannot collide on it.
 */
export async function writeJsonFileAtomically(
  filePath: string,
  value: unknown,
): Promise<void> {
  const directory = path.dirname(filePath);
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = `${JSON.stringify(value, null, 2)}\n`;

  await mkdir(directory, { recursive: true });
  await writeFile(tempPath, payload, "utf8");
  await rename(tempPath, filePath);
}
