/** The slice of Electron's `safeStorage` the availability check reads. */
export type SecretEncryptionBackend = {
  isEncryptionAvailable(): boolean;
  /** Linux only. */
  getSelectedStorageBackend(): string;
};

/**
 * Linux password stores that actually protect a secret. On Linux Electron
 * reports encryption as "available" even with the `basic_text` backend, which
 * encrypts with a hard-coded key and so protects nothing; `unknown` means the
 * choice could not be read. Neither is accepted.
 */
const linuxProtectedBackends: ReadonlySet<string> = new Set([
  "gnome_libsecret",
  "kwallet",
  "kwallet5",
  "kwallet6",
]);

export function isSecretEncryptionAvailable(
  storage: SecretEncryptionBackend,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (!storage.isEncryptionAvailable()) return false;
  if (platform !== "linux") return true;

  return linuxProtectedBackends.has(storage.getSelectedStorageBackend());
}
