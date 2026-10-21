import { useSyncExternalStore } from "react";

// Tailwind's `lg` breakpoint: where decorative side panels start to show.
const LARGE_SCREEN_QUERY = "(min-width: 1024px)";

function subscribe(callback: () => void) {
  const mediaQuery = window.matchMedia(LARGE_SCREEN_QUERY);
  mediaQuery.addEventListener("change", callback);
  return () => mediaQuery.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia(LARGE_SCREEN_QUERY).matches;
}

/** False on the server and on small screens, so heavy decoration never loads there. */
export function useIsLargeScreen() {
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
