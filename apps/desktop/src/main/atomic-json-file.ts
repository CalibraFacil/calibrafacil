import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Write JSON to disk without ever leaving a half-written file behind.
 *
 * Write to a temporary sibling, then rename — rename is atomic within a
 * filesystem, so a crash or a power cut mid-write leaves the previous file
 * intact rather than a truncated one. Every store in the main process needs
 * this, and four of them had grown their own byte-identical copy; any future
 * hardening (fsync before rename, retrying Windows `EPERM`) now has one place
 * to land.
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
