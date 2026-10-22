import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@calibra-facil/ui/alert-dialog'
import { useMountEffect } from '@/hooks/use-mount-effect'
import type { UnsavedChangesGate } from '@/lib/unsaved-changes-gate'
import {
  clearExecutionDraft,
  writeExecutionDraft,
  type ExecutionDraftScope,
  type ExecutionFormValues,
} from '@/features/jobs/execution-draft'

/** Quiet period after the last edit before the draft is written. */
export const EXECUTION_DRAFT_DEBOUNCE_MS = 800

/**
 * Keeps a dirty worksheet recoverable. Render it with a `key` derived from the
 * form values, the dirty flag and `suspended`: every change remounts it, which
 * is what restarts the debounce — no effect with a dependency list involved.
 *
 * While the worksheet is dirty it:
 * - writes the draft once the technician stops typing for
 *   {@link EXECUTION_DRAFT_DEBOUNCE_MS},
 * - writes it immediately if the page is hidden/unloaded, and
 * - arms the browser `beforeunload` prompt (reload, tab close, desktop window
 *   close), which in-app routing cannot intercept.
 *
 * When the worksheet is clean it removes any stale draft, except while a
 * restore offer is pending (`suspended`), when the stored draft is the thing
 * being offered and must survive until the technician decides.
 */
export function ExecutionDraftSync({
  scope,
  values,
  dirty,
  suspended,
  baseUpdatedAt,
}: {
  scope: ExecutionDraftScope | null
  values: ExecutionFormValues
  dirty: boolean
  suspended: boolean
  baseUpdatedAt: string | null
}) {
  useMountEffect(() => {
    if (!dirty) {
      if (scope && !suspended) clearExecutionDraft(scope)
      return undefined
    }

    const flush = () => {
      if (scope && !suspended) {
        writeExecutionDraft({ scope, values, baseUpdatedAt })
      }
    }
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      flush()
      // Both are needed: preventDefault for spec-compliant browsers,
      // returnValue for the rest (and Electron's will-prevent-unload).
      event.preventDefault()
      event.returnValue = ''
    }

    const timer = window.setTimeout(flush, EXECUTION_DRAFT_DEBOUNCE_MS)
    window.addEventListener('beforeunload', handleBeforeUnload)
    window.addEventListener('pagehide', flush)

    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('beforeunload', handleBeforeUnload)
      window.removeEventListener('pagehide', flush)
    }
  })

  return null
}

/**
 * Blocks in-app navigation through the router-provided gate while
 * `shouldBlock()` holds, and asks the technician what to do.
 */
export function ExecutionNavigationGuard({
  Gate,
  shouldBlock,
  draftKept,
  onBeforeLeave,
}: {
  Gate: UnsavedChangesGate
  shouldBlock: () => boolean
  draftKept: boolean
  /** Runs right before a confirmed "leave without saving" (e.g. flush draft). */
  onBeforeLeave: () => void
}) {
  return (
    <Gate shouldBlock={shouldBlock}>
      {(blocker) => (
        <ExecutionLeaveDialog
          open={blocker.status === 'blocked'}
          draftKept={draftKept}
          onStay={() => {
            if (blocker.status === 'blocked') blocker.reset()
          }}
          onLeave={() => {
            if (blocker.status !== 'blocked') return
            onBeforeLeave()
            blocker.proceed()
          }}
        />
      )}
    </Gate>
  )
}

/** Confirm shown when in-app navigation is blocked by unsaved readings. */
function ExecutionLeaveDialog({
  open,
  draftKept,
  onStay,
  onLeave,
}: {
  open: boolean
  /** True when a local draft is being kept, so the copy can reassure. */
  draftKept: boolean
  onStay: () => void
  onLeave: () => void
}) {
  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onStay()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
          <AlertDialogDescription>
            Há leituras não salvas nesta calibração.
            {draftKept
              ? ' Um rascunho local será mantido neste dispositivo e poderá ser restaurado ao reabrir a execução.'
              : ' Elas serão perdidas se você sair agora.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar editando</AlertDialogCancel>
          <AlertDialogAction
            onClick={onLeave}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            Sair sem salvar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Offer to restore (never auto-apply) a local draft newer than the server data. */
export function ExecutionDraftRestoreDialog({
  open,
  onRestore,
  onDiscard,
}: {
  open: boolean
  onRestore: () => void
  onDiscard: () => void
}) {
  return (
    <AlertDialog
      open={open}
      // Deliberately not dismissible: the technician must choose, otherwise the
      // offered draft and the on-screen values would silently diverge.
      onOpenChange={() => {}}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Restaurar rascunho não salvo?</AlertDialogTitle>
          <AlertDialogDescription>
            Encontramos leituras digitadas neste dispositivo que não chegaram a
            ser salvas e são mais recentes que os dados do servidor.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onDiscard}>Descartar</AlertDialogCancel>
          <AlertDialogAction onClick={onRestore}>Restaurar</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
