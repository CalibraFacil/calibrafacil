import "./global.css";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter } from "next/font/google";
import type { Metadata, Viewport } from "next";
import { site } from "@/lib/site";
import { Analytics } from "@vercel/analytics/next";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(site.docsUrl),
  title: {
    default: site.docsName,
    template: `%s — ${site.docsName}`,
  },
  description: site.description,
  openGraph: {
    title: site.docsName,
    description: site.description,
    url: site.docsUrl,
    siteName: site.docsName,
    locale: site.locale,
    type: "website",
  },
  twitter: { card: "summary_large_image" },
  alternates: { canonical: site.docsUrl },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={site.locale} className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <RootProvider
          search={{
            options: {
              type: "fetch",
            },
          }}
        >
          {children}
        </RootProvider>
        <Analytics />
      </body>
    </html>
  );
}
