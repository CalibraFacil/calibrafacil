import { renderToString } from "react-dom/server";

import { HomePage, NotFoundPage } from "./app";

export type PageId = "home" | "not-found";

/** Static markup for one page, hydrated by main.tsx in the browser. */
export function render(page: PageId): string {
  return renderToString(page === "not-found" ? <NotFoundPage /> : <HomePage />);
}
