import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const FILE_NAME = "device-id";
const PATTERN = /^dev_[0-9a-f-]{36}$/;

/**
 * This installation's device id (roadmap 2 E2, review 3.4): created once, at
 * the first start, and kept in the user-data directory. The cloud tells the
 * devices of one user apart by it (pushes, conflicts, the audit of offline
 * work); before, every installation reported "local-dev-device".
 */
export function installDeviceId(userDataDir: string): string {
  const file = path.join(userDataDir, FILE_NAME);
  try {
    const stored = readFileSync(file, "utf8").trim();
    if (PATTERN.test(stored)) return stored;
  } catch {
    // First start (or an unreadable file): a new id below.
  }
  const id = `dev_${randomUUID()}`;
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(file, `${id}\n`, { mode: 0o600 });
  return id;
}
