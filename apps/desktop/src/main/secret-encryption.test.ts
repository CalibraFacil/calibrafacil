import { describe, expect, it, vi } from "vitest";
import { isSecretEncryptionAvailable } from "./secret-encryption";

function storage(available: boolean, backend: string) {
  return {
    isEncryptionAvailable: () => available,
    getSelectedStorageBackend: vi.fn(() => backend),
  };
}

describe("isSecretEncryptionAvailable", () => {
  it.each(["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"])(
    "accepts the %s keyring on Linux",
    (backend) => {
      expect(isSecretEncryptionAvailable(storage(true, backend), "linux")).toBe(
        true,
      );
    },
  );

  it.each(["basic_text", "unknown", "not_used", ""])(
    "refuses the %s backend on Linux even though Electron reports it available",
    (backend) => {
      expect(isSecretEncryptionAvailable(storage(true, backend), "linux")).toBe(
        false,
      );
    },
  );

  it("refuses when Electron says encryption is unavailable", () => {
    expect(
      isSecretEncryptionAvailable(storage(false, "gnome_libsecret"), "linux"),
    ).toBe(false);
    expect(isSecretEncryptionAvailable(storage(false, ""), "win32")).toBe(
      false,
    );
  });

  it.each(["win32", "darwin"] as const)(
    "does not ask %s for a Linux backend",
    (platform) => {
      const fake = storage(true, "basic_text");

      expect(isSecretEncryptionAvailable(fake, platform)).toBe(true);
      expect(fake.getSelectedStorageBackend).not.toHaveBeenCalled();
    },
  );
});
