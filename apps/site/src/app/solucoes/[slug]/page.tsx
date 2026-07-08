import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SEGMENTS, getSegment } from "@/lib/segments";
import { DocPage } from "@/components/doc-page";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return SEGMENTS.map((segment) => ({ slug: segment.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const segment = getSegment(slug);
  if (!segment) return {};

  const url = absoluteUrl(`/solucoes/${segment.slug}`);
  return {
    title: segment.metaTitle,
    description: segment.description,
    alternates: { canonical: url },
    openGraph: {
      title: segment.metaTitle,
      description: segment.description,
      url,
    },
  };
}

export default async function SegmentPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const segment = getSegment(slug);
  if (!segment) notFound();

  return (
    <DocPage eyebrow="Soluções" eyebrowHref="/solucoes" content={segment} />
  );
}
