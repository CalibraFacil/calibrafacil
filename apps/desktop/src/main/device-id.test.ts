import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installDeviceId } from "./device-id";

const dirs: string[] = [];
function tempDir() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "calibra-device-id-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("installDeviceId (roadmap 2 E2)", () => {
  it("creates one id per installation and keeps it across starts", () => {
    const dir = tempDir();
    const first = installDeviceId(dir);
    expect(first).toMatch(/^dev_[0-9a-f-]{36}$/);
    expect(installDeviceId(dir)).toBe(first);
    expect(readFileSync(path.join(dir, "device-id"), "utf8").trim()).toBe(
      first,
    );
  });

  it("two installations get different ids; a damaged file is replaced", () => {
    expect(installDeviceId(tempDir())).not.toBe(installDeviceId(tempDir()));
    const dir = tempDir();
    writeFileSync(path.join(dir, "device-id"), "local-dev-device\n");
    expect(installDeviceId(dir)).not.toBe("local-dev-device");
  });
});
