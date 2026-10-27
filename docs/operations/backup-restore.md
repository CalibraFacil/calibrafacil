# Backup and restore

Runbook for the one-server Docker deployment (`deploy/`). It says what is backed up, how often,
how to get it back, and how to prove it works. For the compose hardening that goes with it (log
rotation, memory limits, healthchecks, database timeouts, proxy headers) see
[`compose-hardening.md`](./compose-hardening.md).

> A backup that has never been restored is a hope, not a backup. The restore drill below runs in CI
> every week and should be done by a person, on a clean machine, at least once a quarter.

## What is backed up

| State                                                           | Where it lives                                | How it is backed up                                                             |
| --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| The database (every laboratory, audit trails, certificate data) | `postgres-data` volume                        | `pg_dump` custom format, daily (the `backup` profile)                           |
| Stored files (issued certificate PDFs, uploads, logos)          | `s3-data` volume, or your hosted object store | Mirror of both buckets into `backups/files`, right after the dump               |
| **`deploy/.env`** (the master keys)                             | The host                                      | **Not automatic. Keep a copy off the machine, apart from the data (see below)** |
| HTTPS certificates (`caddy-data`)                               | Volume                                        | Not needed: Caddy gets new ones on start                                        |
| Container logs                                                  | Docker                                        | Not backed up (rotated, see `compose-hardening.md`)                             |

**The master keys.** `SIGNING_MASTER_KEY`, `INTEGRATIONS_MASTER_KEY`, `PUBLIC_API_MASTER_KEY` and
`EMAIL_DOMAIN_MASTER_KEY` in `.env` encrypt the laboratories' signing-certificate passwords and
integration tokens inside the database. A database backup restored with different keys loads, but
those secrets cannot be decrypted: no certificate can be signed until each laboratory uploads its
signing certificate again. Store `.env` in a password manager or an encrypted vault, not in the same
place as the dumps (an attacker who gets both reads everything).

### Why the dump comes first

`pg_dump` and the file mirror are taken at different instants. The order matters: the dump is taken
first, then the mirror, and the mirror never deletes. Every file a row of the dump points to was
uploaded before the dump, so it is in the mirror. A file uploaded between the two is in the mirror
but not referenced by the dump: an orphan, harmless. The opposite order could leave a row pointing
at a missing certificate PDF.

## Targets

|     | Target                                                 | Basis                                                                                                                                                                 |
| --- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RPO | **24 hours** (at most a day of work lost)              | One dump every day (`BACKUP_SCHEDULE`, default 02:30 UTC), plus one at every `docker compose up` (`BACKUP_ON_START`)                                                  |
| RTO | **4 hours** from the decision to restore to the app up | Provision a host (about 1 h), install Docker and restore `.env` (30 min), restore the dump and the files (minutes to an hour, depending on the size), verify (30 min) |

These are the defaults of the shipped configuration for a single-laboratory or small multi-laboratory
instance (database of a few GB). Measure your own RTO in the drill and write the number down. A
laboratory that cannot lose a day of records needs a tighter RPO:

### Tighter RPO: WAL archiving

`pg_dump` is a snapshot per day. Continuous archiving of the write-ahead log (WAL) gives
point-in-time recovery with an RPO of seconds to minutes. It is not part of the compose file because
it needs a decision about where to archive and how to monitor it. Two ways:

- **A managed PostgreSQL** (RDS, Cloud SQL, Neon, Supabase, Crunchy...). Turn on its automated
  backups and point-in-time recovery, and set `DATABASE_URL` and `DATABASE_OWNER_URL` to it
  (DEPLOYMENT.md, "Using hosted services instead"). Keep the dump job as a second, independent copy
  (the `backup` service works against any `DATABASE_OWNER_URL`).
- **WAL-G or pgBackRest** on the bundled PostgreSQL: a custom image with the tool, `archive_mode=on`,
  `archive_command` (`wal-g wal-push %p`) to an object-store bucket, a daily base backup, and
  restore with `recovery_target_time`. Archive to a different machine or provider than the host.
  Test the restore as described below: a WAL archive that has not been replayed is as unproven as a
  dump.

Whatever you choose, keep the object store protected too (next sections): PostgreSQL's recovery says
nothing about the files.

## Turn the backups on

The service is the `backup` profile of `deploy/compose.yaml`. It is built from `deploy/backup/`
(PostgreSQL 17 client tools, the AWS CLI and `age`: plain Alpine packages, nothing that phones home).

```bash
cd deploy
# in .env (settings and defaults: .env.example, section "Backups")
COMPOSE_PROFILES=backup          # add to mailpit if you use it: mailpit,backup
docker compose up -d             # builds and starts the backup service
docker compose logs backup       # "dump written: dumps/calibra-<time>.dump", "backup finished"
sudo ls -l backups/dumps         # root owns it: the dumps are readable by root only (mode 0600)
```

| Setting                                     | Default     | Meaning                                                                     |
| ------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `BACKUP_DIR`                                | `./backups` | Where the dumps (`dumps/`) and the file mirror (`files/`) go                |
| `BACKUP_SCHEDULE`                           | `02:30`     | Daily time, UTC                                                             |
| `BACKUP_ON_START`                           | `true`      | Also back up 30 seconds after the service starts (every `up`, every update) |
| `BACKUP_RETENTION_DAYS` / `BACKUP_KEEP_MIN` | `14` / `3`  | Dumps older than the first are deleted, but the newest three always stay    |
| `BACKUP_AGE_RECIPIENT`                      | empty       | age public key(s): dumps are encrypted (below)                              |
| `BACKUP_FILES`                              | `true`      | Mirror the buckets                                                          |
| `BACKUP_OFFSITE_*`                          | empty       | Copy `BACKUP_DIR` to an S3-compatible bucket (below)                        |

Each run writes a dump to a temporary name, checks that `pg_restore --list` can read it, optionally
encrypts it, then renames it and writes a `.sha256` file next to it; `dumps/latest` points at the
newest. A run that fails leaves no half-written dump, logs `ERROR: ...`, and the service tries again
at the next schedule. The container is `healthy` while a backup finished in the last 36 hours;
`docker compose ps` shows `unhealthy` otherwise (alert on it; see "Is it working?").

A manual backup, for instance before an update or a risky change:

```bash
docker compose --profile backup run --rm backup once
```

### Encrypt the dumps (recommended)

The dumps hold every laboratory's data, including personal data under the LGPD. Encrypt them so that
a copy that leaves the machine, or a stolen disk, discloses nothing:

```bash
age-keygen -o calibra-backup.key          # on YOUR computer, not on the server
# Public key: age1xxxx...                 # goes into .env as BACKUP_AGE_RECIPIENT
```

Keep `calibra-backup.key` (the private key) in your password manager and on paper in a safe, **not on
the server**: the server can encrypt but must not be able to decrypt. Lose the key and the encrypted
dumps are unreadable. More than one recipient (`BACKUP_AGE_RECIPIENT=age1aaa...,age1bbb...`) lets
two people restore. Test the key now: `age -d -i calibra-backup.key backups/dumps/latest | head -c 5`
prints `PGDMP`.

The file mirror is not encrypted by this service (it holds the certificate PDFs, which the customers
receive anyway, and uploads). Protect it with the access rules of the place it lives, and encrypt the
disk or the off-site bucket.

### Move a copy off the machine

A backup on the same disk as the database does not survive the loss of the machine. Either point
`BACKUP_OFFSITE_URI` at an S3-compatible bucket in another provider or account (the service copies
`dumps/` and `files/` after each run, never deleting there) or run your own tool over `BACKUP_DIR`
(rsync, restic, borg, rclone). Give the off-site key write-only access if your provider allows it,
and expire old dumps with a bucket lifecycle rule (the copy never deletes).

```ini
BACKUP_OFFSITE_URI=s3://my-backups/calibra
BACKUP_OFFSITE_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # empty for AWS S3
BACKUP_OFFSITE_REGION=auto
BACKUP_OFFSITE_ACCESS_KEY_ID=...
BACKUP_OFFSITE_SECRET_ACCESS_KEY=...
```

### Is it working?

- `docker compose ps` shows `backup` as `healthy` (a backup finished in the last 36 h). Alert on
  `unhealthy`: `docker events --filter event=health_status --filter container=<project>-backup-1`
  feeds any watcher, or run `docker inspect -f '{{.State.Health.Status}}' <project>-backup-1` from
  your monitoring.
- `docker compose logs backup | grep ERROR` for the reason.
- `sudo ls -l backups/dumps` shows a dump from today and a plausible size (sudden shrinkage is a
  warning).
- The restore drill, below, is the only real answer.

### With a hosted database or object store

The `backup` service reads `DATABASE_OWNER_URL` and the `R2_*` values from its own `environment`
block in `compose.yaml`: when you move PostgreSQL or the object store out of the compose file, change
them there as you do in the `x-app-env` block. The dump needs the table owner (row-level security
hides rows from `calibra_app`), and `pg_dump` needs the same major version as the server or newer:
change `FROM postgres:17-alpine` in `deploy/backup/Dockerfile` when the server is not 17.

## Restore

Disaster recovery on a new machine, from the dump and the file mirror. Allow the RTO above; the
steps take well under an hour once the host exists.

1. **A host** with Docker and the Compose plugin, the repository cloned (same release as the backup,
   or newer: `init` migrates forward, never back) and the **original `.env`** (same master keys,
   same `POSTGRES_PASSWORD`, `CALIBRA_APP_PASSWORD`, `S3_SECRET_KEY`), with `CALIBRA_VERSION`
   pinned. Point the DNS names at it.
2. **Bring the data stores up empty:**

   ```bash
   cd deploy
   docker compose up -d postgres s3
   ```

3. **Copy the backups** to `deploy/backups/` (from the off-site bucket, or from the old disk). Keep
   the layout: `backups/dumps/calibra-<time>.dump[.age]` with its `.sha256`, and `backups/files/`.
4. **Restore the database** (as root if the files are root-owned; an encrypted dump needs `age` on
   this machine and the private key):

   ```bash
   sudo ./restore.sh backups/dumps/latest                           # plain dump
   sudo ./restore.sh --identity ~/calibra-backup.key backups/dumps/latest   # encrypted dump
   ```

   `restore.sh` checks the checksum and that the archive is readable, **refuses to overwrite a
   database that already has tables** (exit 2: pass `--force` only when you mean to replace the
   data, for instance to roll an existing install back), restores in one transaction (all or
   nothing), then verifies: tables and rows are present, the migrations table and the row-level-
   security policies and `calibra_app` privileges came back, the migrations are applied
   (`docker compose run --rm init`, which also gives `calibra_app` its login from `.env`), and
   `verify-audit-chain` finds every laboratory's audit trail intact. It exits non-zero at the first
   failed check. It needs the `api` and `worker` services stopped.

5. **Restore the files** into the (empty) buckets, then start everything:

   ```bash
   docker compose --profile backup run --rm backup restore-files
   docker compose up -d
   ```

6. **Check it by hand:** sign in, open a recent certificate and download its PDF, open the portal's
   verification page for it. `docker compose exec -T api bun src/cli/check-storage.ts` proves the
   storage; the certificate-drift job (06:00 UTC) reports PDFs whose bytes differ from what was
   issued.

If `verify-audit-chain` reports a break, **stop and read the output**: it names the laboratory, the
position in the chain and the row. A break after a restore means the dump or the machine altered the
record; it is an incident for the quality manager, not something to repair (the daily
`audit-chain-verify` job runs the same check, DEPLOYMENT.md, "Scheduled jobs").

### Restoring into a managed PostgreSQL or another host

`restore.sh --target-url postgres://owner:password@host:5432/calibra DUMP` restores with the `psql`
and `pg_restore` on the machine you run it from (same major as the server or newer). The role must
own the database and be allowed to create the extensions (`pg_trgm`, `unaccent`); on a provider that
restricts that, create them first as an administrator. The migrations and the audit-chain check run
from this checkout (`pnpm db:migrate`, `pnpm --dir apps/api verify-audit-chain`, so `pnpm install`
first); pass `--migrate-cmd`/`--audit-cmd` to run other commands, or `--no-migrate`/`--no-audit` to
skip a check. Afterwards run `init` once so that `calibra_app` gets its login and the session
timeouts (`compose-hardening.md`).

### Restoring one laboratory

There is no per-laboratory restore: every table is shared by the laboratories. Restore the whole
dump into a **separate** scratch database (`--target-url`, a different database name) and extract
what is needed with SQL, rather than overwriting the live one.

## The restore drill

**In CI** ([`restore-drill.yml`](../../.github/workflows/restore-drill.yml)), weekly and on every
change to `deploy/**`: a throwaway PostgreSQL of the production image is built with the real
bootstrap and a laboratory created; the real backup image dumps it (plain and age-encrypted);
`restore.sh` restores each dump into a new database, runs the migrations and `verify-audit-chain`,
and the drill requires **every table to have exactly the source's row count**. It also checks the
refusals: an existing database is not overwritten without `--force`, a truncated or tampered dump is
rejected and leaves the target empty. A failure is a reason to stop and fix the backup chain before
the next dump is relied on. The same script runs by hand:
`deploy/backup/drill.sh postgres://calibra:calibra@localhost:5432/calibra`.

CI cannot cover the file mirror, the real hosts, the keys or the time it takes.

**By a person, each quarter** (and after any change to the host, the object store or the key
custody): on a clean machine or VM, follow "Restore" with only what you would have in a disaster:
the off-site copy, the private age key and the stored `.env`. Time it from the start. Record: the
date, the dump used, the elapsed time against the 4 h RTO, anything that was unclear or missing, and
the result of the by-hand check. Fix the runbook where it was wrong.

## Protect the issued-certificate PDFs: object versioning or lock

The certificate PDFs in the documents bucket (`R2_BUCKET_NAME`, default `calibra-documents`) are
legal records under ISO/IEC 17025 (7.5, 8.4). The application never overwrites or deletes an issued
PDF, but a mistake in the store, a leaked access key or ransomware could. Make the **bucket** refuse
it too, and keep the mirror as a second line.

**Recommendation:** enable versioning (an overwrite or delete keeps the previous version) and, where
the store supports it, object lock in compliance or governance mode with a retention at least as
long as your records-retention period (for most accredited laboratories, 5 to 10 years). Retention
locks and the `records-purge` job (DEPLOYMENT.md, "Records retention") interact: a locked object
cannot be purged before its retention ends, so set the retention to what you must keep, not longer.
Use a separate key for the application with no permission to change versioning, lock or lifecycle
configuration.

**Amazon S3**

```bash
aws s3api put-bucket-versioning --bucket calibra-documents \
  --versioning-configuration Status=Enabled
# Object lock (needs versioning; for a NEW bucket set --object-lock-enabled-for-bucket at creation):
aws s3api put-object-lock-configuration --bucket calibra-documents \
  --object-lock-configuration '{"ObjectLockEnabled":"Enabled","Rule":{"DefaultRetention":{"Mode":"COMPLIANCE","Years":10}}}'
# Keep old versions for a year after they are replaced or deleted, then expire them:
aws s3api put-bucket-lifecycle-configuration --bucket calibra-documents \
  --lifecycle-configuration '{"Rules":[{"ID":"expire-noncurrent","Status":"Enabled","Filter":{},"NoncurrentVersionExpiration":{"NoncurrentDays":365}}]}'
```

Compliance mode cannot be shortened or removed by anyone, the account root included: test in
governance mode first.

**Cloudflare R2**

R2 has no object versioning. Use **bucket locks**: they keep objects from being deleted or overwritten
for a retention period. In the dashboard: R2, the bucket, Settings, Bucket lock rules, add a rule
(prefix empty for the whole bucket, retention in days or indefinite). With Wrangler:
`npx wrangler r2 bucket lock add calibra-documents --name issued-pdfs --retention-days 3650` (see
`npx wrangler r2 bucket lock --help` for the current flags). Without versioning, the file mirror and
the off-site copy are what restore an object damaged inside its retention window.

**MinIO** (and other S3-compatible servers)

```bash
mc version enable myminio/calibra-documents
# Object lock must be switched on when the bucket is created: mc mb --with-lock myminio/calibra-documents
mc retention set --default COMPLIANCE 10y myminio/calibra-documents
mc ilm rule add --noncurrent-expire-days 365 myminio/calibra-documents
```

**The bundled gateway (`s3` service, Versity)** keeps objects as plain files on the `s3-data` volume
and offers no object lock. The protection here is the mirror plus the off-site copy; put the off-site
bucket under one of the locks above, and consider a filesystem that snapshots (ZFS, btrfs, LVM) under
`s3-data`.

Object versioning protects against deletion and overwrite, not against an attacker with
configuration rights, and it grows the bucket: the lifecycle rule above bounds it.

## Reference

- Compose profile and settings: `deploy/compose.yaml` (service `backup`), `deploy/.env.example`.
- Scripts: `deploy/backup/backup.sh` (loop, `once`, `list`, `restore-files`), `deploy/restore.sh`,
  `deploy/backup/drill.sh`, `deploy/backup/row-counts.sql`.
- Audit-chain verification: `docker compose run --rm --no-deps api bun src/cli/verify-audit-chain.ts`.
