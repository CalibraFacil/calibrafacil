import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  matchPortalRoute,
  portalCommandRoutes,
  portalNavSections,
  portalRedirectPrefixes,
  routeCrumbs,
  routeTitle,
  settingsNavRoutes,
} from "./route-registry";

describe("portal route registry", () => {
  describe("matching", () => {
    it("matches a path to its route, a trailing slash ignored", () => {
      expect(matchPortalRoute("/")).toBe("/");
      expect(matchPortalRoute("/assets/")).toBe("/assets");
      expect(matchPortalRoute("/assets/a1b2")).toBe("/assets/$id");
      expect(matchPortalRoute("/certificates/JOB-1")).toBe("/certificates/$id");
    });

    it("lets a static segment beat a parameter", () => {
      expect(matchPortalRoute("/requests/new")).toBe("/requests/new");
      expect(matchPortalRoute("/requests/12")).toBe("/requests/$id");
    });

    it("has no route for a path nothing serves", () => {
      expect(matchPortalRoute("/nope")).toBeUndefined();
      expect(matchPortalRoute("/assets/1/extra")).toBeUndefined();
      expect(routeTitle("/nope")).toBeUndefined();
    });
  });

  it("titles a page by its route", () => {
    expect(routeTitle("/reliability")).toBe("Confiabilidade");
    expect(routeTitle("/service-orders/abc")).toBe("Ordem de serviço");
    expect(routeTitle("/sign-in")).toBe("Entrar");
  });

  it("builds a breadcrumb with a crumb per served prefix", () => {
    expect(routeCrumbs("/")).toEqual([{ title: "Painel", path: "/" }]);
    expect(routeCrumbs("/certificates/JOB-1")).toEqual([
      { title: "Painel", path: "/" },
      { title: "Certificados", path: "/certificates" },
      { title: "Certificado", path: "/certificates/JOB-1" },
    ]);
    expect(
      routeCrumbs("/settings/profile").map((crumb) => crumb.title),
    ).toEqual(["Painel", "Configurações", "Perfil"]);
    expect(routeCrumbs("/calendar").map((crumb) => crumb.title)).toEqual([
      "Painel",
      "Calendário",
    ]);
  });

  it("lays the sidebar out in sections, badges on the entries that count", () => {
    const sections = portalNavSections();

    expect(sections.map((section) => section.label)).toEqual([
      undefined,
      "Calibração",
      "Serviços",
      "Qualidade",
    ]);
    expect(
      sections.flatMap((section) =>
        section.items.map((item) => [item.to, item.badge]),
      ),
    ).toEqual([
      ["/", undefined],
      ["/assets", "overdue"],
      ["/calendar", undefined],
      ["/certificates", undefined],
      ["/requests", undefined],
      ["/reliability", undefined],
      ["/service-orders", "awaitingQuote"],
      ["/out-of-tolerance", undefined],
    ]);
  });

  it("offers every sidebar page in the command palette, and the new request as an action", () => {
    const commands = portalCommandRoutes();
    const pages = commands.filter((command) => command.kind === "page");

    expect(pages.map((command) => command.to)).toEqual(
      portalNavSections().flatMap((section) =>
        section.items.map((item) => item.to),
      ),
    );
    expect(commands.filter((command) => command.kind === "action")).toEqual([
      {
        to: "/requests/new",
        label: "Nova solicitação de calibração",
        icon: "add",
        kind: "action",
      },
    ]);
  });

  it("lists the settings pages in order", () => {
    expect(settingsNavRoutes().map((route) => route.title)).toEqual([
      "Perfil",
      "Aparência",
      "Notificações",
    ]);
  });

  describe("sign-in redirect prefixes", () => {
    it("are the signed-in routes, not the public ones", () => {
      const prefixes = portalRedirectPrefixes();

      expect(prefixes).toEqual(
        expect.arrayContaining([
          "/",
          "/assets",
          "/calendar",
          "/reliability",
          "/out-of-tolerance",
          "/notifications",
          "/settings",
        ]),
      );
      for (const publicPrefix of [
        "/sign-in",
        "/v",
        "/magic-link",
        "/accept-invite",
        "/access-code",
        "/service-order-access",
      ]) {
        expect(prefixes).not.toContain(publicPrefix);
      }
    });

    it("cover every top-level route file of the signed-in folder", () => {
      const segments = readdirSync(join(__dirname, "../routes/_authenticated"))
        .filter((entry) => !/^(index|route)\.tsx$/.test(entry))
        .map((entry) => `/${entry.replace(/\.tsx$/, "")}`);

      expect(segments.length).toBeGreaterThan(5);
      expect(portalRedirectPrefixes()).toEqual(
        expect.arrayContaining(segments),
      );
    });
  });
});
