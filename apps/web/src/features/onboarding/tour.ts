import { Cancel01Icon } from '@hugeicons/core-free-icons'
import {
  driver,
  type Config,
  type DriveStep,
  type Driver,
  type Alignment,
  type PopoverDOM,
  type Side,
} from 'driver.js'

/**
 * Guided pointers on top of the activation checklist (driver.js).
 *
 * Two uses: the interface tour a laboratory can take from the checklist or the
 * user menu, and the single pointer at the control a checklist step asks for
 * when the lab arrives on that screen.
 *
 * Steps find their element through `data-tour` attributes, never through
 * classes or copy, so restyling or rewording a screen cannot quietly break a
 * tour. The popover is dressed as the app's own popover in styles.css.
 */

export type TourStep = {
  /** `data-tour` value of the element to point at; none centres the step. */
  target?: string
  title: string
  description: string
  /** Where the note sits; driver.js picks a side when unset. */
  side?: Side
  align?: Alignment
}

const SVG_NS = 'http://www.w3.org/2000/svg'

/** A HugeIcons icon as a DOM node, for markup driver.js renders itself. */
function iconElement(icon: typeof Cancel01Icon): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 24 24')
  svg.setAttribute('width', '16')
  svg.setAttribute('height', '16')
  svg.setAttribute('fill', 'none')
  svg.setAttribute('aria-hidden', 'true')
  for (const [tag, attributes] of icon) {
    const node = document.createElementNS(SVG_NS, tag)
    for (const [name, value] of Object.entries(attributes)) {
      if (name === 'key') continue
      // strokeWidth → stroke-width
      const attribute = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
      node.setAttribute(attribute, String(value))
    }
    svg.append(node)
  }
  return svg
}

// The library draws its close button as a "×" character; the app's close
// affordance is the icon.
function renderCloseIcon(popover: PopoverDOM) {
  popover.closeButton.replaceChildren(iconElement(Cancel01Icon))
}

const BASE_CONFIG: Config = {
  animate: true,
  smoothScroll: true,
  overlayOpacity: 0.45,
  stagePadding: 6,
  stageRadius: 10,
  popoverOffset: 12,
  popoverClass: 'calibra-tour',
  showProgress: true,
  progressText: '{{current}} de {{total}}',
  nextBtnText: 'Próximo',
  prevBtnText: 'Anterior',
  doneBtnText: 'Concluir',
  closeBtnLabel: 'Fechar',
  onPopoverRender: renderCloseIcon,
}

export function tourSelector(target: string): string {
  return `[data-tour="${target}"]`
}

/**
 * The steps that can be shown right now: centred ones, and those whose element
 * is rendered and takes space (on a phone the sidebar is closed, so its items
 * are left out rather than pointed at an empty corner).
 */
export function stepsOnScreen(
  steps: TourStep[],
  isOnScreen: (selector: string) => boolean = (selector) => {
    const element = document.querySelector(selector)
    return element !== null && element.getClientRects().length > 0
  },
): DriveStep[] {
  return steps.flatMap((step) => {
    const popover = {
      title: step.title,
      description: step.description,
      ...(step.side ? { side: step.side } : {}),
      ...(step.align ? { align: step.align } : {}),
    }
    if (!step.target) return [{ popover }]

    const selector = tourSelector(step.target)
    return isOnScreen(selector) ? [{ element: selector, popover }] : []
  })
}

// One guide on screen at a time: starting another replaces it.
let active: Driver | undefined

function replaceActive(next: Driver) {
  active?.destroy()
  active = next
}

export function startTour(steps: TourStep[]): void {
  const [first, ...rest] = stepsOnScreen(steps)
  if (!first) return

  replaceActive(
    driver({
      ...BASE_CONFIG,
      // Nothing comes before the first step, so it offers no way back.
      steps: [
        {
          ...first,
          popover: { ...first.popover, showButtons: ['next', 'close'] },
        },
        ...rest,
      ],
    }),
  )
  active?.drive()
}

/**
 * Highlight one control with a short note. Clicking the control does what the
 * note says, so it also dismisses the note (a dialog it opens must not sit
 * under the overlay). Returns a cleanup that removes it.
 */
export function pointAt(
  step: Required<Pick<TourStep, 'target' | 'title' | 'description'>>,
): () => void {
  const pointer = driver({
    ...BASE_CONFIG,
    showProgress: false,
    overlayOpacity: 0.3,
    // The screen may still be loading the data that renders the control.
    waitForElement: 3000,
    onHighlighted: (element) => {
      element?.addEventListener('click', () => pointer.destroy(), {
        once: true,
      })
    },
  })
  replaceActive(pointer)
  pointer.highlight({
    element: tourSelector(step.target),
    popover: {
      title: step.title,
      description: step.description,
      showButtons: ['close'],
      // The controls a step starts from sit at the right of a screen's
      // header: anchoring the note's right edge keeps it on screen.
      side: 'bottom',
      align: 'end',
    },
  })

  return () => {
    pointer.destroy()
    if (active === pointer) active = undefined
  }
}
