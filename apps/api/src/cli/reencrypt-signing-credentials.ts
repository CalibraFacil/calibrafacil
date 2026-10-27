/**
 * Re-encrypt the signing credentials under the current key encryption key:
 *
 *   docker compose exec api bun src/cli/reencrypt-signing-credentials.ts --dry-run
 *   docker compose exec api bun src/cli/reencrypt-signing-credentials.ts
 *   pnpm --dir apps/api reencrypt-signing-credentials [--dry-run]
 *
 * Moves every laboratory's signing credential (P12 + password) to the envelope
 * format under the CURRENT key (`SIGNING_MASTER_KEY` / `SIGNING_MASTER_KEY_ID`),
 * migrating the legacy rows and re-sealing the ones still under a previous key
 * (`SIGNING_MASTER_KEY_PREVIOUS`). Idempotent: a row already under the current
 * key is left alone. `--dry-run` opens every credential, prints what it would
 * change and writes nothing. Exits non-zero when any credential cannot be opened
 * (it is left untouched). See DEPLOYMENT.md, "Signing certificate custody".
 *
 * An operator tool: it sweeps every laboratory, so it runs on the owner
 * connection (`systemDb`, DATABASE_OWNER_URL). It reads the same environment as
 * the API. Nothing it prints is secret: ids, serials and outcomes only.
 */
import { readSigningConfig } from "@calibra-facil/config";

import { reencryptSigningCredentials } from "../lib/reencrypt-signing-credentials";
import { runReencryptCli } from "../lib/reencrypt-signing-credentials-cli";

runReencryptCli(process.argv.slice(2), {
  readSigning: readSigningConfig,
  reencrypt: reencryptSigningCredentials,
  log: (line) => console.log(line),
  error: (line) => console.error(line),
})
  .then((code) => process.exit(code))
  .catch(() => {
    console.error("reencrypt-signing-credentials failed unexpectedly.");
    process.exit(1);
  });
