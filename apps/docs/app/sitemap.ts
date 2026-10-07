import type { MetadataRoute } from "next";
import { source } from "@/lib/source";
import { site } from "@/lib/site";

// Written once at build time (output: "export"). The project site's
// robots.txt points crawlers here.
export const dynamic = "force-static";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return source.getPages().map((page) => ({
    url: `${site.docsUrl}${page.url}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: page.url === "/" ? 1 : 0.7,
  }));
}
