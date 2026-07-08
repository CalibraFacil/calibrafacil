import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { FEATURES, getFeature } from "@/lib/features";
import { DocPage } from "@/components/doc-page";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return FEATURES.map((feature) => ({ slug: feature.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) return {};

  const url = absoluteUrl(`/recursos/${feature.slug}`);
  return {
    title: feature.metaTitle,
    description: feature.description,
    alternates: { canonical: url },
    openGraph: {
      title: feature.metaTitle,
      description: feature.description,
      url,
    },
  };
}

export default async function FeaturePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const feature = getFeature(slug);
  if (!feature) notFound();

  return (
    <DocPage eyebrow="Recursos" eyebrowHref="/recursos" content={feature} />
  );
}
