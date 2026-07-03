const SUPPRESS_WINDOW_MS = 150

/**
 * Guards the mobile sidebar against iOS WebKit's momentum-scroll tap quirk.
 *
 * In an `overflow` scroll container, touching down to halt a scroll that is
 * still moving makes WebKit synthesize immediate mousedown/mouseup/click
 * events on the element under the finger. In the sidebar that "click" lands
 * on a nav link, navigation fires, and the sheet auto-closes — the user only
 * wanted to stop the scroll.
 *
 * Scroll events fire continuously while the list is moving (drag and
 * momentum), so a click arriving within SUPPRESS_WINDOW_MS of the last
 * scroll event can only be that synthetic tap-to-stop click. An intentional
 * tap on a resting list is always further than that from the final scroll
 * event.
 */
export function createSidebarScrollTapGuard(
  now: () => number = () => performance.now(),
) {
  let lastScrollAt = Number.NEGATIVE_INFINITY

  return {
    noteScroll() {
      lastScrollAt = now()
    },
    shouldSuppressTap() {
      return now() - lastScrollAt < SUPPRESS_WINDOW_MS
    },
  }
}
