import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";

import { HomePage, NotFoundPage } from "./app";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("index.html has no #root element");

const page = (
  <StrictMode>
    {root.dataset.page === "not-found" ? <NotFoundPage /> : <HomePage />}
  </StrictMode>
);

// The build prerenders every page (scripts/prerender.mjs), so production
// hydrates existing markup; the dev server serves an empty root.
if (root.firstElementChild) {
  hydrateRoot(root, page);
} else {
  createRoot(root).render(page);
}
