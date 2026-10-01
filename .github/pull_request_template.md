## What and why

<!-- What does this change and why is it needed? Link the issue it closes. -->

## How it was tested

<!-- Commands run, scenarios checked. For UI changes, add screenshots (light and dark). -->

## Checklist

- [ ] `pnpm lint`, `pnpm check-types` and the affected tests pass
- [ ] No real customer data, certificates or credentials in code, fixtures or screenshots
- [ ] Math-engine numeric changes come with a new `ENGINE_VERSION` and dossier
- [ ] New migrations are hand-written SQL appended to `drizzle/meta/_journal.json`
