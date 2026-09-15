import type { MetadataRoute } from "next";

import { FEATURES } from "@/lib/features";
import { GRANDEZAS } from "@/lib/grandezas";
import { SEGMENTS } from "@/lib/segments";
import { TOOLS } from "@/lib/tools";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPaths = ["/", "/recursos", "/solucoes", "/ferramentas"];
  const featurePaths = FEATURES.map((feature) => `/recursos/${feature.slug}`);
  const segmentPaths = SEGMENTS.map((segment) => `/solucoes/${segment.slug}`);
  const grandezaPaths = GRANDEZAS.map(
    (grandeza) => `/calibracao/${grandeza.slug}`,
  );
  const toolPaths = TOOLS.map((tool) => `/ferramentas/${tool.slug}`);

  return [
    ...staticPaths,
    ...featurePaths,
    ...segmentPaths,
    ...grandezaPaths,
    ...toolPaths,
  ].map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: "weekly",
    priority:
      path === "/"
        ? 1
        : path.startsWith("/ferramentas")
          ? 0.9
          : path === "/recursos"
            ? 0.8
            : 0.7,
  }));
}
