// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { RoutePendingFallback, routeBoundaryOptions } from "./route-boundaries";

const mocks = vi.hoisted(() => ({
  reportClientError: vi.fn(),
}));

vi.mock("@/lib/report-client-error", () => ({
  reportClientError: mocks.reportClientError,
}));

let shouldCrash = true;

function Broken() {
  if (shouldCrash) throw new Error("boom na renderização");
  return <p>conteúdo recuperado</p>;
}

function renderApp(
  initialPath: string,
  options: { loaderFails?: boolean } = {},
) {
  const rootRoute = createRootRoute({ component: Outlet });
  const brokenRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/quebrada",
    component: Broken,
  });
  const loaderRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/carga",
    loader: () => {
      if (options.loaderFails) throw new Error("falha no loader");
      return null;
    },
    component: () => <p>carregada</p>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([brokenRoute, loaderRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
    ...routeBoundaryOptions,
  });
  return render(<RouterProvider router={router} />);
}

describe("router boundaries (portal)", () => {
  beforeEach(() => {
    shouldCrash = true;
    vi.clearAllMocks();
    // React logs caught render errors; keep the test output readable.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("REQ-FE-BOUNDARY-030: a route render crash shows pt-BR copy and is reported through reportClientError", async () => {
    // The router uses a memory history here; defaultOnCatch reads the real URL.
    window.history.replaceState({}, "", "/quebrada");
    renderApp("/quebrada");

    expect(
      await screen.findByText("Algo deu errado ao carregar esta página"),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Tentar novamente" }),
    ).toBeTruthy();

    await waitFor(() =>
      expect(mocks.reportClientError).toHaveBeenCalledTimes(1),
    );
    const [reported, context] = mocks.reportClientError.mock.calls[0] ?? [];
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).toBe("boom na renderização");
    expect(context.route).toBe("/quebrada");
    expect(context.componentStack).toContain("Broken");
  });

  it("REQ-FE-BOUNDARY-031: a loader failure also reaches the boundary and reportClientError", async () => {
    renderApp("/carga", { loaderFails: true });

    expect(
      await screen.findByText("Algo deu errado ao carregar esta página"),
    ).toBeTruthy();
    await waitFor(() => expect(mocks.reportClientError).toHaveBeenCalled());
    const [reported] = mocks.reportClientError.mock.calls[0] ?? [];
    expect(reported.message).toBe("falha no loader");
  });

  it("REQ-FE-BOUNDARY-032: the retry action resets the boundary and re-renders the route", async () => {
    renderApp("/quebrada");
    const retry = await screen.findByRole("button", {
      name: "Tentar novamente",
    });

    shouldCrash = false;
    fireEvent.click(retry);

    expect(await screen.findByText("conteúdo recuperado")).toBeTruthy();
  });

  it("REQ-FE-BOUNDARY-033: an unknown URL renders the pt-BR not-found page with a way home", async () => {
    renderApp("/nao-existe");

    expect(await screen.findByText("Página não encontrada")).toBeTruthy();
    const home = screen.getByRole("link", { name: "Ir para o início" });
    expect(home.getAttribute("href")).toBe("/");
    expect(mocks.reportClientError).not.toHaveBeenCalled();
  });

  it("REQ-FE-BOUNDARY-034: the pending fallback announces loading in pt-BR", () => {
    render(<RoutePendingFallback />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Carregando…")).toBeTruthy();
  });
});
