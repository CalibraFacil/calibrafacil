import type { FileRouteTypes } from "@/routeTree.gen";

/**
 * The portal route registry: one declaration of what each portal route is
 * called and where it shows up. Everything else reads from here:
 *
 * - sidebar               `nav`              (`portalNavSections`)
 * - command palette       `command`          (`portalCommandRoutes`)
 * - breadcrumb crumb      `title`            (`routeCrumbs`)
 * - settings sidebar      `settingsNav`      (`settingsNavRoutes`)
 * - tab title             `title`            (`routeTitle`, read by the branding provider)
 * - sign-in redirect      `afterSignIn`      (`portalRedirectPrefixes`)
 *
 * Ids are the router's `to` (an index route shares its parent's id). The
 * `satisfies` below makes the table exhaustive: a route added to the route tree
 * does not compile until it is declared here, and an entry for a route that no
 * longer exists does not compile either.
 *
 * This module is part of the initial bundle graph (the sign-in redirect reads
 * it), so it stays free of component and feature imports: icons are ids, the
 * shell maps them to glyphs (`features/shell/portal-icons.ts`).
 */

export type PortalRouteId = FileRouteTypes["to"];

export type PortalIconId =
  | "add"
  | "appearance"
  | "assets"
  | "calendar"
  | "certificates"
  | "home"
  | "notifications"
  | "outOfTolerance"
  | "profile"
  | "reliability"
  | "requests"
  | "serviceOrders";

const portalNavSectionLabels = {
  home: undefined,
  calibration: "Calibração",
  services: "Serviços",
  quality: "Qualidade",
} as const;

export type PortalNavSectionId = keyof typeof portalNavSectionLabels;

/** The counters of `useOverview()` the sidebar can show next to an entry. */
export type PortalNavBadge = "overdue" | "awaitingQuote";

type RouteDef = {
  /** Breadcrumb crumb, sidebar text and tab title ("Equipamentos"). */
  title: string;
  /** Sidebar placement; the order of the entries below is the order shown. */
  nav?: {
    section: PortalNavSectionId;
    icon: PortalIconId;
    badge?: PortalNavBadge;
  };
  /**
   * Command palette entry. A page ("Ir para") is called by its `title`; an
   * action has its own label.
   */
  command?: { icon: PortalIconId; action?: string };
  /** Settings sidebar placement, in the order of the entries below. */
  settingsNav?: { icon: PortalIconId };
  /**
   * Signed-in pages a sign-in can land on (the `redirect` of a session that
   * expired there). Public pages and redirects are not.
   */
  afterSignIn: boolean;
};

const portalRoutes = {
  "/": {
    title: "Painel",
    nav: { section: "home", icon: "home" },
    command: { icon: "home" },
    afterSignIn: true,
  },
  "/assets": {
    title: "Equipamentos",
    nav: { section: "calibration", icon: "assets", badge: "overdue" },
    command: { icon: "assets" },
    afterSignIn: true,
  },
  "/assets/$id": { title: "Equipamento", afterSignIn: true },
  "/calendar": {
    title: "Calendário",
    nav: { section: "calibration", icon: "calendar" },
    command: { icon: "calendar" },
    afterSignIn: true,
  },
  "/certificates": {
    title: "Certificados",
    nav: { section: "calibration", icon: "certificates" },
    command: { icon: "certificates" },
    afterSignIn: true,
  },
  "/certificates/$id": { title: "Certificado", afterSignIn: true },
  "/requests": {
    title: "Solicitações",
    nav: { section: "calibration", icon: "requests" },
    command: { icon: "requests" },
    afterSignIn: true,
  },
  "/requests/new": {
    title: "Nova solicitação",
    command: { icon: "add", action: "Nova solicitação de calibração" },
    afterSignIn: true,
  },
  "/requests/$id": { title: "Solicitação", afterSignIn: true },
  "/reliability": {
    title: "Confiabilidade",
    nav: { section: "calibration", icon: "reliability" },
    command: { icon: "reliability" },
    afterSignIn: true,
  },
  "/service-orders": {
    title: "Manutenção",
    nav: { section: "services", icon: "serviceOrders", badge: "awaitingQuote" },
    command: { icon: "serviceOrders" },
    afterSignIn: true,
  },
  "/service-orders/$id": { title: "Ordem de serviço", afterSignIn: true },
  // No nav badge: the sidebar's badges are the counts of `useOverview()`, and
  // the overview has no §7.10 notices count yet (adding one is an API change).
  "/out-of-tolerance": {
    title: "Fora de tolerância",
    nav: { section: "quality", icon: "outOfTolerance" },
    command: { icon: "outOfTolerance" },
    afterSignIn: true,
  },
  // Reached from the bell in the header, not from the sidebar.
  "/notifications": { title: "Notificações", afterSignIn: true },
  // Redirects to /settings/profile.
  "/settings": { title: "Configurações", afterSignIn: true },
  "/settings/profile": {
    title: "Perfil",
    settingsNav: { icon: "profile" },
    afterSignIn: true,
  },
  "/settings/appearance": {
    title: "Aparência",
    settingsNav: { icon: "appearance" },
    afterSignIn: true,
  },
  "/settings/notifications": {
    title: "Notificações",
    settingsNav: { icon: "notifications" },
    afterSignIn: true,
  },
  "/sign-in": { title: "Entrar", afterSignIn: false },
  "/magic-link": { title: "Link de acesso", afterSignIn: false },
  "/accept-invite": { title: "Convite", afterSignIn: false },
  "/access-code": { title: "Acesso ao orçamento", afterSignIn: false },
  "/service-order-access/$token": { title: "Orçamento", afterSignIn: false },
  "/v/$token": { title: "Verificação de certificado", afterSignIn: false },
} as const satisfies Record<PortalRouteId, RouteDef>;

const routeEntries = Object.entries<RouteDef>(portalRoutes);

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function splitPath(path: string) {
  return path.split("/").filter(Boolean);
}

/**
 * The route id a URL path belongs to, or `undefined` for a path no route
 * serves. A static segment beats a `$param` one (`/requests/new` is the new
 * page, not a request called "new"); a trailing slash is ignored.
 */
export function matchPortalRoute(pathname: string): PortalRouteId | undefined {
  const actual = splitPath(pathname);
  let best: { id: string; statics: number } | undefined;
  for (const [id] of routeEntries) {
    const expected = splitPath(id);
    if (expected.length !== actual.length) continue;
    let statics = 0;
    const matches = expected.every((part, index) => {
      if (part.startsWith("$")) return actual[index] !== undefined;
      const same = part === actual[index];
      if (same) statics += 1;
      return same;
    });
    if (matches && (!best || statics > best.statics)) best = { id, statics };
  }
  return best && isPortalRouteId(best.id) ? best.id : undefined;
}

function isPortalRouteId(id: string): id is PortalRouteId {
  return id in portalRoutes;
}

/** The title of a URL path ("Equipamento" for `/assets/abc`), if a route serves it. */
export function routeTitle(pathname: string): string | undefined {
  const id = matchPortalRoute(pathname);
  return id === undefined ? undefined : portalRoutes[id].title;
}

/**
 * The breadcrumb of a URL path, "Painel" first: one crumb per prefix of the
 * path, titled by the route that serves it. A prefix no route serves
 * (`/service-order-access`) is left out.
 */
export function routeCrumbs(
  pathname: string,
): Array<{ title: string; path: string }> {
  const crumbs: Array<{ title: string; path: string }> = [
    { title: portalRoutes["/"].title, path: "/" },
  ];
  let path = "";
  for (const segment of splitPath(pathname)) {
    path += `/${segment}`;
    const title = routeTitle(path);
    if (title !== undefined) crumbs.push({ title, path });
  }
  return crumbs;
}

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

export type PortalNavItem = {
  to: PortalRouteId;
  title: string;
  icon: PortalIconId;
  badge?: PortalNavBadge;
};

/** The sidebar: sections in their fixed order, entries in registry order. */
export function portalNavSections(): Array<{
  id: PortalNavSectionId;
  label: string | undefined;
  items: Array<PortalNavItem>;
}> {
  const sectionIds = Object.keys(portalNavSectionLabels).filter(
    (id): id is PortalNavSectionId => id in portalNavSectionLabels,
  );
  return sectionIds.map((id) => ({
    id,
    label: portalNavSectionLabels[id],
    items: routeEntries.flatMap(([to, def]) =>
      def.nav?.section === id && isPortalRouteId(to)
        ? [{ to, title: def.title, icon: def.nav.icon, badge: def.nav.badge }]
        : [],
    ),
  }));
}

export type PortalCommandRoute = {
  to: PortalRouteId;
  /** The page's title, or the action's own label. */
  label: string;
  icon: PortalIconId;
  kind: "page" | "action";
};

export function portalCommandRoutes(): Array<PortalCommandRoute> {
  return routeEntries.flatMap(([to, def]) =>
    def.command && isPortalRouteId(to)
      ? [
          {
            to,
            label: def.command.action ?? def.title,
            icon: def.command.icon,
            kind: def.command.action ? ("action" as const) : ("page" as const),
          },
        ]
      : [],
  );
}

export function settingsNavRoutes(): Array<{
  to: PortalRouteId;
  title: string;
  icon: PortalIconId;
}> {
  return routeEntries.flatMap(([to, def]) =>
    def.settingsNav && isPortalRouteId(to)
      ? [{ to, title: def.title, icon: def.settingsNav.icon }]
      : [],
  );
}

/**
 * The URL prefixes a sign-in may redirect back to: `/` and the first segment of
 * every `afterSignIn` route.
 */
export function portalRedirectPrefixes(): Array<string> {
  const prefixes = new Set(["/"]);
  for (const [id, def] of routeEntries) {
    const [first] = splitPath(id);
    if (def.afterSignIn && first) prefixes.add(`/${first}`);
  }
  return [...prefixes].sort();
}
