// Runs after `vite build`: renders each page to static HTML inside the built
// index.html, so the site reads without JavaScript and crawlers see the
// content. main.tsx then hydrates the same markup in the browser.
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { createServer } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = new URL("../dist/", import.meta.url);

const vite = await createServer({
  root,
  appType: "custom",
  logLevel: "error",
  server: { middlewareMode: true },
});

try {
  const { render } = await vite.ssrLoadModule("/src/entry-server.tsx");
  const template = await readFile(new URL("index.html", dist), "utf8");
  if (!template.includes("<!--app-html-->")) {
    throw new Error("dist/index.html has no <!--app-html--> placeholder");
  }

  await writeFile(
    new URL("index.html", dist),
    template.replace("<!--app-html-->", render("home")),
  );

  // Served by Cloudflare for any unknown path (wrangler.jsonc).
  const notFound = template
    .replace('<div id="root">', '<div id="root" data-page="not-found">')
    .replace("<!--app-html-->", render("not-found"))
    .replace(
      /<title>[^<]*<\/title>/,
      '<title>Página não encontrada · CalibraFácil</title>\n    <meta name="robots" content="noindex" />',
    )
    .replace(/\s*<link rel="canonical"[^>]*>/, "");
  await writeFile(new URL("404.html", dist), notFound);
} finally {
  await vite.close();
}
