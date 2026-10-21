// Stand-in for `react/jsx-dev-runtime` inside this package (wired up by the
// `paths` entry in ./tsconfig.json).
//
// Every template pins `@jsxImportSource react` so it keeps compiling with React
// even when it is imported from apps/api, whose tsconfig sets
// `jsxImportSource: "hono/jsx"` (Bun applies the entrypoint's tsconfig to
// imported files). That pragma also bypasses the JSX runtime react-email
// injects. `email build` compiles templates with `jsxDev: true`, so they call
// `jsxDEV` from `react/jsx-dev-runtime` — but `next build` runs with
// NODE_ENV=production, where React's production `jsxDEV` is `undefined`, and
// every preview page failed to prerender with "jsxDEV is not a function".
//
// `jsx` / `jsxs` are what the production transform emits, so a template renders
// to the same elements (and the same HTML) as before. The dev-only source
// metadata is dropped, which only the `email dev` preview used.
import { Fragment, jsx, jsxs } from "react/jsx-runtime";

type JsxArgs = Parameters<typeof jsx>;

export { Fragment };

export function jsxDEV(
  type: JsxArgs[0],
  props: JsxArgs[1],
  key: JsxArgs[2],
  isStaticChildren: boolean,
): ReturnType<typeof jsx> {
  return isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key);
}

// react-email bundles its own runtime shim from the project root, so the path
// mapping above also reaches its `import ReactJSXDevRuntime from
// 'react/jsx-dev-runtime'` (a default import). Keep that bundle building.
export default { Fragment, jsxDEV };
