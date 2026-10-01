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
`pnpm dev`. Everything runs locally with Docker; no cloud account is needed.

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
   (`fix(portal): …`, `feat(math-engine): …`).
6. Open a pull request describing **what** changed, **why**, and **how you tested it**.
   Include screenshots (light and dark mode) for UI changes.

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
  it to `drizzle/meta/_journal.json`. Migrations must be forward-only and safe on existing
  data.

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
