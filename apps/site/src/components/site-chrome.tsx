import { CONTACT_URL, SITE_NAME } from "@/lib/site";

// Plain <a> for every link: "/", "/blog" and "/docs" are served by other apps
// (Vite landing, CMS, docs) via Vercel rewrites, so client-side routing would
// 404 inside this Next app. Full navigations resolve through the rewrites.
const navLinks = [
  { label: "Recursos", href: "/recursos" },
  { label: "Soluções", href: "/solucoes" },
  { label: "Preços", href: "/precos" },
  { label: "Blog", href: "/blog" },
  { label: "Documentação", href: "/docs" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="/" className="text-sm font-semibold tracking-tight">
          {SITE_NAME}
        </a>
        <nav className="hidden items-center gap-1 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <a
          href={CONTACT_URL}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Falar com especialista
        </a>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-muted/40">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {new Date().getFullYear()} {SITE_NAME} — Sistema de gestão
          metrológica para laboratórios e oficinas.
        </p>
        <nav className="flex flex-wrap gap-x-5 gap-y-2">
          <a href="/recursos" className="hover:text-foreground">
            Recursos
          </a>
          <a href="/precos" className="hover:text-foreground">
            Preços
          </a>
          <a href="/blog" className="hover:text-foreground">
            Blog
          </a>
          <a href="/docs" className="hover:text-foreground">
            Documentação
          </a>
          <a href="/privacidade" className="hover:text-foreground">
            Privacidade
          </a>
        </nav>
      </div>
    </footer>
  );
}
