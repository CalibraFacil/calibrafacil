import fs from "node:fs";
import path from "node:path";
import DatabaseConstructor, { type Database } from "better-sqlite3";
import { currentLocalDbSchemaVersion, localDbMigrations } from "./migrations";

export type LocalDatabase = Database;

export type OpenLocalDatabaseOptions = {
  filePath: string;
  migrate?: boolean;
};

export class LocalDatabaseVersionError extends Error {
  constructor(
    readonly databaseVersion: number,
    readonly supportedVersion: number,
  ) {
    super(
      `Local database schema version ${databaseVersion} is newer than this app supports (${supportedVersion}).`,
    );
    this.name = "LocalDatabaseVersionError";
  }
}

export function openLocalDatabase(
  options: OpenLocalDatabaseOptions,
): LocalDatabase {
  fs.mkdirSync(path.dirname(options.filePath), { recursive: true });

  const database = new DatabaseConstructor(options.filePath);
  configureLocalDatabase(database);
  assertLocalSchemaCompatible(database);

  if (options.migrate !== false) {
    runLocalMigrations(database);
  }

  return database;
}

export function configureLocalDatabase(database: LocalDatabase) {
  database.pragma("journal_mode = WAL");
  database.pragma("foreign_keys = ON");
}

export function runLocalMigrations(database: LocalDatabase) {
  database.exec(`
CREATE TABLE IF NOT EXISTS local_schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
`);
  assertLocalSchemaCompatible(database);

  const hasMigration = database.prepare(
    "SELECT 1 FROM local_schema_migrations WHERE id = ?",
  );
  const insertMigration = database.prepare(
    "INSERT INTO local_schema_migrations (id, name, applied_at) VALUES (?, ?, ?)",
  );

  for (const migration of localDbMigrations) {
    if (hasMigration.get(migration.id)) continue;

    database.transaction(() => {
      database.exec(migration.sql);
      insertMigration.run(
        migration.id,
        migration.name,
        new Date().toISOString(),
      );
    })();
  }
}

export function assertLocalSchemaCompatible(database: LocalDatabase) {
  const version = getLocalSchemaVersion(database);
  if (version > currentLocalDbSchemaVersion) {
    throw new LocalDatabaseVersionError(version, currentLocalDbSchemaVersion);
  }
}

export function getLocalSchemaVersion(database: LocalDatabase) {
  const table = database
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_schema_migrations'",
    )
    .get();

  if (!table) return 0;

  const row = database
    .prepare<[], { version: number }>(
      "SELECT COALESCE(MAX(id), 0) AS version FROM local_schema_migrations",
    )
    .get();

  return row?.version ?? 0;
}
