import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";

import { LOCALE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/site";
import { GTM_CONTAINER_ID } from "@/lib/analytics/config";
import { LandingNav } from "@/components/landing/landing-nav";
import { LandingFooter } from "@/components/landing/landing-footer";
import { ConsentGate } from "@/components/landing/consent-gate";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `Software para laboratório de calibração | ${SITE_NAME}`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: LOCALE,
    siteName: SITE_NAME,
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
  icons: { icon: "/logo-mark-light.svg" },
  // Google Search Console verification — the property is verified against the
  // apex "/", which this app now serves (moved here from apps/web/index.html).
  verification: {
    google: "GOOGLE_SITE_VERIFICATION_TOKEN",
  },
};

// Follows the OS color scheme (matches the SPA landing) — sets `.dark` before
// paint so there is no flash.
const THEME_SCRIPT = `(function(){try{var m=window.matchMedia('(prefers-color-scheme: dark)');function a(){document.documentElement.classList.toggle('dark',m.matches);}a();m.addEventListener('change',a);}catch(e){}})();`;

// Consent Mode v2 defaults (all denied) + apply any stored choice, before GTM.
const CONSENT_SCRIPT = `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',analytics_storage:'denied',functionality_storage:'granted',security_storage:'granted',wait_for_update:500});gtag('set','ads_data_redaction',true);try{var c=JSON.parse(localStorage.getItem('cf-cookie-consent')||'null');if(c&&typeof c.analytics==='boolean'){gtag('consent','update',{analytics_storage:c.analytics?'granted':'denied',ad_storage:c.ads?'granted':'denied',ad_user_data:c.ads?'granted':'denied',ad_personalization:c.ads?'granted':'denied'});}}catch(e){}`;

const GTM_SCRIPT = `(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_CONTAINER_ID}');`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const isProd = process.env.NODE_ENV === "production";

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <script dangerouslySetInnerHTML={{ __html: CONSENT_SCRIPT }} />
        {isProd ? (
          <script dangerouslySetInnerHTML={{ __html: GTM_SCRIPT }} />
        ) : null}
      </head>
      <body>
        <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
          <LandingNav />
          <main>{children}</main>
          <LandingFooter />
        </div>
        <ConsentGate />
        <Analytics />
      </body>
    </html>
  );
}
