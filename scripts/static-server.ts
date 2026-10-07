// Serves a built frontend (apps/web or apps/portal dist/) for Dockerfile.static.
import { stat } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const port = Number(process.env.PORT ?? 8080);
const root = resolve(process.env.STATIC_DIR ?? "dist");
// Routes like /dashboard/clients only exist in the client-side router, so a
// navigation to an unknown path gets index.html. SPA_FALLBACK=false turns
// that into a 404.
const spaFallback = process.env.SPA_FALLBACK !== "false";

// The frontends read their VITE_* settings from /runtime-env.js before falling
// back to the values baked in at build time, so the container's VITE_*
// variables configure a prebuilt image (e.g. VITE_PORTAL_APP_URL).
const runtimeEnvScript = `window.calibraRuntimeEnv = ${JSON.stringify(
  Object.fromEntries(
    Object.entries(process.env).filter(([name]) => name.startsWith("VITE_")),
  ),
)};\n`;

/** The file a request path names, if it is inside the root and exists. */
async function findFile(pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const target = resolve(root, `.${decoded}`);
  if (target !== root && !target.startsWith(root + sep)) return null;

  for (const candidate of [target, resolve(target, "index.html")]) {
    const info = await stat(candidate).catch(() => null);
    if (info?.isFile()) return candidate;
  }
  return null;
}

// Vite fingerprints everything it emits under assets/, so those never change.
// Everything else (index.html, the service worker, theme-init.js, which
// index.html pins by an integrity hash) must be revalidated on every load.
function cacheControl(path: string): string {
  return relative(root, path).startsWith(`assets${sep}`)
    ? "public, max-age=31536000, immutable"
    : "no-cache";
}

Bun.serve({
  port,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/runtime-env.js") {
      return new Response(runtimeEnvScript, {
        headers: {
          "content-type": "text/javascript; charset=utf-8",
          "cache-control": "no-cache",
          "x-content-type-options": "nosniff",
        },
      });
    }

    let path = await findFile(pathname);

    // Only navigations fall back: a missing script or image stays a 404
    // instead of being answered with HTML.
    if (!path && spaFallback && extname(pathname) === "") {
      path = await findFile("/index.html");
    }
    if (!path) return new Response("Not Found", { status: 404 });

    // Bun sets Content-Type from the file extension.
    return new Response(Bun.file(path), {
      headers: {
        "cache-control": cacheControl(path),
        "x-content-type-options": "nosniff",
      },
    });
  },
});

console.info(`Static server listening on :${port} from ${root}`);
