# ICP-Brasil trust store

This directory holds the **ICP-Brasil AC trust anchors** (AC-Raiz + intermediates)
used by `chain-validation.ts` to validate a signing certificate's path.

It is **populated by a script**, not committed by hand:

```bash
# run where gov.br is reachable (dev machine / CI — NOT the sandbox build env)
node scripts/fetch-icp-brasil-trust-store.mjs
```

The script downloads ITI's official consolidated bundle
(`ACcompactado.zip`), verifies it against the published `hashsha512.txt`,
extracts the `.crt` PEMs here, and writes `MANIFEST.txt`. Commit the resulting
`*.crt` files so chain validation has anchors at runtime.

> The bundle is refreshed periodically by ITI. A scheduled job (Vercel Cron) that
> re-fetches, re-verifies the hash, and opens a PR on change is a follow-up.

Source: <https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz>
