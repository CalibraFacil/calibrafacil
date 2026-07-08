import type { MetadataRoute } from "next";

import { FEATURES } from "@/lib/features";
import { SEGMENTS } from "@/lib/segments";
import { absoluteUrl } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const staticPaths = ["/precos", "/recursos", "/solucoes"];
  const featurePaths = FEATURES.map((feature) => `/recursos/${feature.slug}`);
  const segmentPaths = SEGMENTS.map((segment) => `/solucoes/${segment.slug}`);

  return [...staticPaths, ...featurePaths, ...segmentPaths].map((path) => ({
    url: absoluteUrl(path),
    lastModified: now,
    changeFrequency: "weekly",
    priority: path === "/precos" ? 0.9 : 0.7,
  }));
}
