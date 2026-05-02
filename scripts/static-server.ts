const port = Number(process.env.PORT ?? 8080);
const staticDir = process.env.STATIC_DIR ?? "dist";
const spaFallback = process.env.SPA_FALLBACK === "true";

function getContentType(path: string) {
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".ico")) return "image/x-icon";
  if (path.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

function sanitizePath(pathname: string) {
  const decoded = decodeURIComponent(pathname);
  return decoded.replace(/^\/+/, "").replace(/\.\.(\/|\\)/g, "");
}

async function findFile(pathname: string) {
  const cleaned = sanitizePath(pathname);
  const candidatePath = cleaned === "" ? "index.html" : cleaned;
  const candidate = Bun.file(`${staticDir}/${candidatePath}`);
  if (await candidate.exists()) return { file: candidate, path: candidatePath };

  const indexCandidate = Bun.file(`${staticDir}/${candidatePath}/index.html`);
  if (await indexCandidate.exists()) {
    return { file: indexCandidate, path: `${candidatePath}/index.html` };
  }

  if (spaFallback) {
    const fallback = Bun.file(`${staticDir}/index.html`);
    if (await fallback.exists()) return { file: fallback, path: "index.html" };
  }

  return null;
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const result = await findFile(url.pathname);
    if (!result) return new Response("Not Found", { status: 404 });

    const headers = new Headers({
      "content-type": getContentType(result.path),
    });

    if (!result.path.endsWith("index.html")) {
      headers.set("cache-control", "public, max-age=31536000, immutable");
    } else {
      headers.set("cache-control", "no-cache");
    }

    return new Response(result.file, { headers });
  },
});

console.info(`Static server listening on :${port} from ${staticDir}`);
