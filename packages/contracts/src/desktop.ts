import { z } from "zod";

export const syncStateSchema = z.enum([
  "offline",
  "idle",
  "syncing",
  "error",
  "conflict",
]);

export const localEnvironmentBootstrapSchema = z.object({
  appVersion: z.string(),
  localServerVersion: z.string(),
  deviceId: z.string(),
  tenantId: z.string().nullable(),
  organizationId: z.string().nullable(),
  unitId: z.number().int().nullable(),
  userId: z.string().nullable(),
  dbSchemaVersion: z.number().int().nonnegative(),
  syncEnabled: z.boolean(),
  syncState: syncStateSchema,
  httpBaseUrl: z.string().url(),
  localApiToken: z.string().nullable(),
});

export const localServerBootstrapConfigSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive().max(65_535),
  appVersion: z.string().min(1),
  localServerVersion: z.string().min(1),
  dbPath: z.string().min(1),
  storageRoot: z.string().min(1),
  deviceId: z.string().min(1),
  tenantId: z.string().nullable(),
  organizationId: z.string().nullable(),
  unitId: z.number().int().nullable(),
  userId: z.string().nullable(),
  syncEnabled: z.boolean(),
  bootstrapToken: z.string().nullable(),
  cloudApiUrl: z.string().url().nullable(),
  cloudAuthToken: z.string().nullable(),
  cloudProxyToken: z.string().nullable(),
  desktopRunId: z.string().min(1),
  localServerRunId: z.string().min(1),
});

export const appInfoSchema = z.object({
  name: z.string(),
  version: z.string(),
  platform: z.string(),
  arch: z.string(),
  isPackaged: z.boolean(),
});

export const desktopSettingsSchema = z.object({
  autoStartSync: z.boolean(),
  updateChannel: z.enum(["stable", "beta"]).default("stable"),
});

export const desktopSettingsPatchSchema = desktopSettingsSchema.partial();

export const desktopSecretNameSchema = z.enum([
  "cloudAuthToken",
  "deviceSecret",
  "localEncryptionKey",
  "signingP12Password",
]);

export const desktopSecretStatusSchema = z.object({
  name: desktopSecretNameSchema,
  stored: z.boolean(),
  encryptionAvailable: z.boolean(),
  updatedAt: z.string().datetime().nullable(),
});

export const desktopSecretWriteSchema = z.object({
  name: desktopSecretNameSchema,
  value: z.string().min(1),
});

export const syncActionResultSchema = z.object({
  ok: z.boolean(),
  message: z.string().optional(),
});

export const syncStatusSnapshotSchema = z.object({
  state: syncStateSchema,
  pendingOutboxCount: z.number().int().nonnegative(),
  conflictCount: z.number().int().nonnegative(),
  lastSyncedAt: z.string().datetime().nullable(),
  activeRunId: z.string().nullable().optional(),
  lastRunId: z.string().nullable().optional(),
  lastError: z.string().nullable().optional(),
});

export const desktopUpdateStateSchema = z.object({
  status: z.enum([
    "idle",
    "checking",
    "available",
    "not-available",
    "downloading",
    "downloaded",
    "error",
  ]),
  version: z.string().optional(),
  message: z.string().optional(),
});

export const certificatePdfExportRequestSchema = z.object({
  jobId: z.union([z.string().min(1), z.number().int().positive()]),
});

export const desktopAuthFetchRequestSchema = z.object({
  url: z.string().url(),
  method: z.string().min(1),
  headers: z.array(z.tuple([z.string(), z.string()])),
  body: z
    .union([
      z.string(),
      z.object({
        encoding: z.literal("base64"),
        data: z.string(),
      }),
    ])
    .nullable(),
});

export const desktopAuthFetchResponseSchema = z.object({
  status: z.number().int().min(100).max(599),
  statusText: z.string(),
  headers: z.array(z.tuple([z.string(), z.string()])),
  body: z.string(),
});

export type SyncState = z.infer<typeof syncStateSchema>;
export type LocalEnvironmentBootstrap = z.infer<
  typeof localEnvironmentBootstrapSchema
>;
export type LocalServerBootstrapConfig = z.infer<
  typeof localServerBootstrapConfigSchema
>;
export type AppInfo = z.infer<typeof appInfoSchema>;
export type DesktopSettings = z.infer<typeof desktopSettingsSchema>;
export type DesktopSettingsPatch = z.infer<typeof desktopSettingsPatchSchema>;
export type DesktopSecretName = z.infer<typeof desktopSecretNameSchema>;
export type DesktopSecretStatus = z.infer<typeof desktopSecretStatusSchema>;
export type DesktopSecretWrite = z.infer<typeof desktopSecretWriteSchema>;
export type SyncActionResult = z.infer<typeof syncActionResultSchema>;
export type SyncStatusSnapshot = z.infer<typeof syncStatusSnapshotSchema>;
export type DesktopUpdateState = z.infer<typeof desktopUpdateStateSchema>;
export type CertificatePdfExportRequest = z.infer<
  typeof certificatePdfExportRequestSchema
>;
export type DesktopAuthFetchRequest = z.infer<
  typeof desktopAuthFetchRequestSchema
>;
export type DesktopAuthFetchResponse = z.infer<
  typeof desktopAuthFetchResponseSchema
>;

export interface CalibraBridge {
  authFetch(
    request: DesktopAuthFetchRequest,
  ): Promise<DesktopAuthFetchResponse>;
  getAppInfo(): Promise<AppInfo>;
  getLocalEnvironmentBootstrap(): Promise<LocalEnvironmentBootstrap | null>;
  getSettings(): Promise<DesktopSettings>;
  setSettings(patch: DesktopSettingsPatch): Promise<DesktopSettings>;
  getSecretStatuses(): Promise<DesktopSecretStatus[]>;
  setSecret(secret: DesktopSecretWrite): Promise<DesktopSecretStatus>;
  deleteSecret(name: DesktopSecretName): Promise<DesktopSecretStatus>;
  getSyncState(): Promise<SyncState>;
  getSyncStatus(): Promise<SyncStatusSnapshot>;
  onSyncStatus(listener: (status: SyncStatusSnapshot) => void): () => void;
  startSync(): Promise<SyncActionResult>;
  pauseSync(): Promise<SyncActionResult>;
  retrySync(): Promise<SyncActionResult>;
  pickFile(): Promise<string | null>;
  pickFolder(): Promise<string | null>;
  saveFile(): Promise<string | null>;
  saveCertificatePdf(
    input: CertificatePdfExportRequest,
  ): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  exportSupportBundle(): Promise<string | null>;
  getUpdateState(): Promise<DesktopUpdateState>;
  onUpdateState(listener: (state: DesktopUpdateState) => void): () => void;
  checkForUpdate(): Promise<DesktopUpdateState>;
  downloadUpdate(): Promise<DesktopUpdateState>;
  installUpdate(): Promise<DesktopUpdateState>;
}
