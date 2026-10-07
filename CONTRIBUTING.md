# Contributing to Calibra Fácil

Thanks for your interest! Calibra Fácil is maintained by volunteers in their spare time.
Contributions of every size are welcome — bug reports, fixes, calibration methods,
documentation and translations of the docs.

## Expectations

- **Best effort, no SLA.** Issues and pull requests are reviewed when maintainers have time.
  There is no commercial support and no help with individual deployments.
- **Questions go to [Discussions](https://github.com/CalibraFacil/calibrafacil/discussions)**,
  not issues. Issues are for reproducible bugs and concrete proposals.
- **Security problems** must be reported privately — see [`SECURITY.md`](./SECURITY.md).
- **Language.** The product UI is in Brazilian Portuguese. Code, comments, commit messages and
  technical docs are in English. Issues and discussions may be written in Portuguese or
  English.

## Getting started

Follow the [Quick start](./README.md#quick-start): `pnpm install`, `pnpm setup:dev`,
`pnpm dev`. Everything runs locally with Docker; no cloud account is needed. Or open the
repository in GitHub Codespaces (or any Dev Containers tool): [`.devcontainer/`](./.devcontainer)
sets all of it up.

Before your first change, skim [`CLAUDE.md`](./CLAUDE.md) and [`AGENTS.md`](./AGENTS.md):
several architecture rules are enforced by lint (no server imports in frontends, no `as`
assertions, no `useEffect`, thin route files).

## Making a change

1. Fork the repository and create a branch from `main`.
2. Keep the change focused: one fix or feature per pull request.
3. Add or update tests. Never weaken an existing test to make a change pass.
4. Run the checks locally:

   ```bash
   pnpm lint
   pnpm check-types
   TZ=UTC pnpm turbo test --filter="[origin/main...HEAD]"
   ```

5. Commit with [Conventional Commits](https://www.conventionalcommits.org/)
   (`fix(portal): …`, `feat(math-engine): …`). Releases are cut from these messages:
   `feat` and `fix` commits (and `!` for breaking changes) decide the next version and
   become the [changelog](./CHANGELOG.md).
6. Open a pull request describing **what** changed, **why**, and **how you tested it**.
   Include screenshots (light and dark mode) for UI changes.

CI runs lint, types and the unit tests on every pull request. The **Safety net** workflow
adds the checks that only a running system can fail, each one when the pull request touches
its inputs: the real-Postgres integration tests (`pnpm --dir apps/api test:integration`, same
for `apps/worker`), the development stack with the demo laboratory driven in a browser
(`pnpm --dir apps/web test:stack` against a running `pnpm dev`), the self-hosted stack built
from the Dockerfiles, the packaged desktop app, the web e2e suite and the site build.
Dependency, lockfile, toolchain and workflow changes run all of them, and so do pushes to
`main` and a nightly run.

## Releases

`release-please` keeps a release pull request open on `main` with the next version and its
changelog. Merging it tags `vX.Y.Z`, publishes the Docker images to GHCR (amd64 and arm64)
and attaches the Windows desktop installer to the GitHub release.

## Dependencies

[Dependabot](./.github/dependabot.yml) keeps GitHub Actions, the Dockerfiles' base images, the
Compose services and the dev container features current, and opens a pull request as soon as
a security advisory affects an npm package.

- Updates arrive on Mondays, one grouped pull request per kind. A release is proposed three
  days after it is published; security fixes do not wait. pnpm itself refuses anything
  published in the last 24 hours.
- Patch, minor and security pull requests merge themselves once CI, the dependency review and
  the Safety net pass. Major versions wait for a maintainer. Node.js and PostgreSQL majors are
  not proposed at all: moving to a new LTS, or dumping and restoring the database, is a
  deliberate change.
- npm version updates are made by hand: on this workspace a Dependabot version-update run
  regenerates the lockfile once per outdated package and runs out of time. Upgrade in a
  focused pull request (`pnpm outdated -r` lists what is behind) and let the Safety net check
  the result.
- A pull request that adds a dependency with a high or critical advisory fails the dependency
  review.
- Some versions are held on purpose, with the reason next to the override in
  `pnpm-workspace.yaml`. Lift a hold in its own pull request.

## Areas that need extra care

Calibra Fácil produces regulated records. Changes in these areas get a stricter review:

- **Math engine** (`packages/math-engine`): any change to a numeric result requires a new
  `ENGINE_VERSION` and a new validation dossier directory under
  [`validation/math-engine/`](./validation/math-engine/). The dossier gate test enforces it.
- **Calibration methods** (`packages/method-templates`): cite the guide or standard each
  model and uncertainty component comes from.
- **Approval, signing and certificates**: approved records are immutable; corrections go
  through the amendment flow.
- **Access control and tenancy**: preserve organization/unit scoping and the RBAC layer in
  `packages/auth`.
- **Database migrations**: add a hand-written SQL file in `packages/db/drizzle/` and append
  it to `drizzle/meta/_journal.json`, and keep `src/schema.ts` in sync (new databases are
  built from it). Objects schema.ts cannot express (extensions, partial or expression indexes,
  CHECK constraints) also go into `packages/db/sql/schema-extras.sql`. Migrations must be
  forward-only and safe on existing data.

## Historical references

Code comments sometimes cite issue or pull-request numbers (for example `#423`) or internal
design notes. Those refer to the project's tracker before it was open-sourced and are kept
as historical context; they do not match issues in this repository.

## AI-assisted contributions

Using coding assistants is fine. You are responsible for every line you submit: understand
it, test it and be ready to explain it during review.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](./LICENSE), the same license as the project.
