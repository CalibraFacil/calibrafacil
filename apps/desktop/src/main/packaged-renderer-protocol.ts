import path from "node:path";
import { readFile } from "node:fs/promises";
import { protocol } from "electron";
import {
  buildContentSecurityPolicy,
  rendererResponseHeaders,
} from "./content-security-policy";
import { formatErrorMessage } from "./renderer-diagnostics";

/** The scheme and host a packaged build serves its UI from. */
export const desktopAppScheme = "app";
export const desktopAppHost = "calibra-facil";

/**
 * Declare the app scheme privileged. Has to run before the app is ready, which
 * is why it is separate from {@link registerPackagedRendererProtocol}.
 */
export function declarePackagedRendererScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: desktopAppScheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ]);
}

/** Serve the built web app from `app://calibra-facil/`, with the CSP attached. */
export function registerPackagedRendererProtocol(options: {
  /** Directory holding the built web app (`index.html` and its assets). */
  rendererRoot: string;
  localServerHost: string;
  cloudApiUrls: string[];
}) {
  const { rendererRoot } = options;
  const contentSecurityPolicy = buildContentSecurityPolicy({
    localServerHost: options.localServerHost,
    cloudApiUrls: options.cloudApiUrls,
  });

  protocol.handle(desktopAppScheme, async (request) => {
    const url = new URL(request.url);
    if (url.hostname !== desktopAppHost) {
      return new Response("Not found", { status: 404 });
    }

    const requestedPath =
      url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
    const filePath = path.resolve(rendererRoot, `.${requestedPath}`);

    if (!isPathInside(rendererRoot, filePath)) {
      return new Response("Not found", { status: 404 });
    }

    try {
      const bytes = await readFile(filePath);
      return new Response(bytes, {
        headers: rendererResponseHeaders(
          contentTypeForPath(filePath),
          contentSecurityPolicy,
        ),
      });
    } catch (error) {
      if (!isRendererNavigationRequest(request, requestedPath)) {
        console.error("[desktop-renderer] packaged asset not found", {
          requestedPath,
          filePath,
          error: formatErrorMessage(error),
        });
        return new Response("Not found", { status: 404 });
      }

      try {
        const indexHtml = await readFile(path.join(rendererRoot, "index.html"));
        return new Response(indexHtml, {
          headers: rendererResponseHeaders(
            "text/html; charset=utf-8",
            contentSecurityPolicy,
          ),
        });
      } catch (indexError) {
        console.error("[desktop-renderer] packaged index not found", {
          rendererRoot,
          error: formatErrorMessage(indexError),
        });
        return new Response("Renderer not found", { status: 500 });
      }
    }
  });
}

function isPathInside(parentPath: string, childPath: string) {
  const relativePath = path.relative(parentPath, childPath);
  return (
    relativePath.length === 0 ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function isRendererNavigationRequest(request: Request, requestedPath: string) {
  if (requestedPath === "/index.html") return true;

  const acceptHeader = request.headers.get("accept") ?? "";
  return acceptHeader.includes("text/html");
}

function contentTypeForPath(filePath: string) {
  switch (path.extname(filePath)) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".svg":
      return "image/svg+xml";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".woff":
      return "font/woff";
    case ".woff2":
      return "font/woff2";
    default:
      return "application/octet-stream";
  }
}
