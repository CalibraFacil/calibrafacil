import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { GRANDEZAS, getGrandeza } from "@/lib/grandezas";
import { ContentPage } from "@/components/content-page";
import { absoluteUrl } from "@/lib/site";

export function generateStaticParams() {
  return GRANDEZAS.map((grandeza) => ({ slug: grandeza.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const grandeza = getGrandeza(slug);
  if (!grandeza) return {};

  const url = absoluteUrl(`/calibracao/${grandeza.slug}`);
  return {
    title: grandeza.metaTitle,
    description: grandeza.description,
    alternates: { canonical: url },
    openGraph: {
      title: grandeza.metaTitle,
      description: grandeza.description,
      url,
    },
  };
}

export default async function GrandezaPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const grandeza = getGrandeza(slug);
  if (!grandeza) notFound();

  return (
    <ContentPage
      model={{
        parent: { label: "Recursos", href: "/recursos" },
        current: grandeza.heading,
        heading: grandeza.heading,
        intro: grandeza.intro,
        body: grandeza.body,
        method: { label: "Como o sistema conduz", steps: grandeza.method },
        points: { label: "No detalhe", items: grandeza.points },
        spec: { label: "Ficha técnica", items: grandeza.spec },
        faq: grandeza.faq,
        related: { label: "Veja também", items: grandeza.related },
      }}
    />
  );
}
