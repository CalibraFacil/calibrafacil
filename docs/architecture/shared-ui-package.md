# Shared UI Package (`@calibra-facil/ui`)

`packages/ui` is the single home of the shadcn/base-ui primitives, the
instrument-panel design system and the status-tone vocabulary that
`apps/web` and `apps/portal` share. Before it existed each app carried its own
`components/ui/*` copy (56 and 36 files, 34 of the shared names differing) and
`instrument-panel.tsx` was copied between them.

## Layout

```txt
packages/ui/src/
  components/   # one file per primitive: button, dialog, field, sidebar, ...
  lib/          # utils (cn), status-tone, panel-styles, button-variants, sidebar scroll-tap guard
  hooks/        # use-mobile, use-mount-effect (the sidebar's shortcut listener)
  styles/       # tokens.css (entry), shadcn.css (data-* variants, accordion keyframes)
```

Consumers import per-module subpaths, never a barrel, so a page only pays for
what it renders: `@calibra-facil/ui/button`, `@calibra-facil/ui/status-tone`,
`@calibra-facil/ui/panel-styles`, ... `panel-styles` and `button-variants` are
separate on purpose: the portal's router boundaries sit in the initial bundle
graph and must not pull in `instrument-panel` (motion, tooltip) or the base-ui
button.

The package runs from source like `packages/shared` (no build step) and has its
own Vitest setup; its component specs moved with the components.

## Theming

Nothing in the package hard-codes a colour. Components use the shadcn tokens
(`--primary`, `--destructive`, `--muted`, ...) the apps already define, plus the
tokens in `styles/tokens.css`:

- `--signal-ok*`, `--signal-warning*` — the two tones with no shadcn token, with
  light and dark values (emerald / amber steps by default);
- `--ink` — the neutral the console shadows and blueprint hairlines mix from.

Each app imports the entry once, after `@import "tailwindcss"`:

```css
@import "@calibra-facil/ui/tokens.css";
```

`tokens.css` registers `packages/ui/src` as a Tailwind v4 `@source` (the classes
live in a workspace dependency Tailwind would not scan) and imports
`shadcn.css`. An app re-themes the package by overriding the variables in its
own `:root` / `.dark`.

The portal narrows the scan with `@source not "…/components/{…}.tsx"` for the
components it never renders, which keeps ~30 KiB of unused utilities out of its
render-blocking CSS. The failure mode is silent (import an excluded component and
it renders unstyled), so `apps/portal/src/lib/ui-source-coverage.test.ts` fails
when the portal imports, directly or through a sibling, a component on that list.

## Status vocabulary

`SignalTone` (`ok | critical | warning | info | neutral`) maps to class tokens
through `STATUS_TONE` in `@calibra-facil/ui/status-tone`:

| slot      | use                                         |
| :-------- | :------------------------------------------ |
| `surface` | filled pill: tinted background + text       |
| `soft`    | same as `surface`, for timeline markers     |
| `text`    | text colour only                            |
| `dot`     | solid indicator dot                         |
| `tile`    | tinted tile background (SignalTile)         |
| `value`   | the large numeric value inside a tile       |
| `icon`    | icon glyph                                  |
| `alert`   | bordered, tinted callout with coloured icon |

`Alert`'s `info`, `success` and `warning` variants, `SignalTile`, the portal's
`StatusPill` and its timeline all read this map, so one tone is one colour
everywhere. Feature code must not reach for a palette step; see "Lint guards".

## Fields

`Field` is the one field system. Composable mode (`Field` + `FieldLabel` +
`FieldDescription` + `FieldError`) is the shadcn shape. Labelled mode
(`<Field label description error>{control}</Field>`) is the former
`shared/forms/form-field`: it wires the label's `htmlFor`, the control's `id`,
`aria-describedby` (description, then error), `aria-invalid`, and renders the
error with `role="alert"`. An `id` or aria attribute already on the control wins,
and the label then points at the control's own id.

## Icon-only buttons

`Button` is typed so `size="icon" | "icon-xs" | "icon-sm" | "icon-lg"` requires
`aria-label`. `button.test.tsx` pins this with `@ts-expect-error`, so loosening
the type fails `check-types`.

## Lint guards

- `calibra/no-app-ui-primitive-recreation` — an `apps/*/src/components/ui/<name>.tsx`
  whose name is a package component, or an import of `@/components/ui/<name>` for
  one, is an error. The name list is read from `packages/ui/src/components`.
  Components only one app renders (web: `currency-input`, `date-input`,
  `input-otp`, `masked-input`, `save-button`, `timeline`, `direction`) stay in
  that app.
- `calibra/no-raw-palette-color-classes` — ratchet on `text|bg|border|ring-<palette>-<step>`
  in `apps/web|portal/src/features` (tests exempt). Files that still use a palette
  step are listed with their exact count in
  `packages/oxlint-plugin-calibra/src/lib/palette-baseline.ts`; a file may never
  gain one. After migrating a file to `STATUS_TONE` or a theme token, run
  `pnpm --filter @calibra-facil/oxlint-plugin-calibra baseline:palette` so the
  allowance shrinks (the plugin's tests fail when a count is stale in either
  direction).

## Adding or changing a component

Change `packages/ui/src/components/<name>.tsx`; do not copy it into an app. Add a
spec next to it. If the portal starts rendering a component, make sure it is not
on the portal's `@source not` list.
