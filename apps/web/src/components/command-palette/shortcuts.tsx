import { Kbd } from '@/components/ui/kbd'

/**
 * Global keyboard shortcuts for the command palette, expressed as **leader-key
 * sequences** (press the first key, then the second) — e.g. `G H` to go to the
 * dashboard, `C C` to create a calibration.
 *
 * Why sequences instead of `⌘N`/`Ctrl+N`: single-modifier combos like Ctrl+N,
 * Ctrl+T, Ctrl+W, Ctrl+P and Ctrl+1–8 are reserved by the browser and never
 * reach the page, so they can't be intercepted in the web app. Leader sequences
 * are not reserved and work identically on macOS and Windows.
 */
export const COMMAND_SHORTCUTS = [
  { id: 'goDashboard', keys: ['G', 'H'], to: '/dashboard' },
  { id: 'goClients', keys: ['G', 'C'], to: '/dashboard/clients' },
  { id: 'goAssets', keys: ['G', 'A'], to: '/dashboard/assets' },
  { id: 'goSettings', keys: ['G', 'S'], to: '/dashboard/settings' },
  { id: 'createCalibration', keys: ['C', 'C'], to: '/dashboard/jobs/new' },
  {
    id: 'createServiceOrder',
    keys: ['C', 'O'],
    to: '/dashboard/service-orders/new',
  },
  { id: 'createAsset', keys: ['C', 'A'], to: '/dashboard/assets/new' },
  {
    id: 'createEnvironment',
    keys: ['C', 'E'],
    to: '/dashboard/settings/environment',
  },
  { id: 'createNonConformance', keys: ['C', 'N'], to: '/dashboard/nc/new' },
] as const

export type CommandShortcut = (typeof COMMAND_SHORTCUTS)[number]
export type CommandShortcutId = CommandShortcut['id']

/** The set of valid leader keys (first key of any sequence), lowercased. */
export const LEADER_KEYS: ReadonlySet<string> = new Set(
  COMMAND_SHORTCUTS.map((shortcut) => shortcut.keys[0].toLowerCase()),
)

const BY_SEQUENCE = new Map(
  COMMAND_SHORTCUTS.map((shortcut) => [
    shortcut.keys.join('').toLowerCase(),
    shortcut,
  ]),
)

/** Returns the shortcut for a typed two-key sequence (e.g. `"gh"`), or null. */
export function matchShortcutSequence(
  sequence: string,
): CommandShortcut | null {
  return BY_SEQUENCE.get(sequence) ?? null
}

function shortcutKeys(id: CommandShortcutId): ReadonlyArray<string> {
  return COMMAND_SHORTCUTS.find((shortcut) => shortcut.id === id)?.keys ?? []
}

/** Renders a leader sequence as keycaps, e.g. `[C] [C]`. */
export function ShortcutHint({ id }: { id: CommandShortcutId }) {
  return (
    <span
      data-slot="command-shortcut"
      className="ml-auto inline-flex items-center gap-1"
    >
      {shortcutKeys(id).map((key, index) => (
        <Kbd key={`${id}-${index}`}>{key}</Kbd>
      ))}
    </span>
  )
}
