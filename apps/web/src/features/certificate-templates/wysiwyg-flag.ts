/**
 * Rollout flag for the wysiwyg certificate editor (06-reframe §G #4):
 * PR #713 merges after M-A, but labs only see the editor entry points once
 * this is enabled — M-B (band model) is the intended first exposure.
 * Enable per environment: VITE_WYSIWYG_EDITOR_ENABLED=true.
 */
export function isWysiwygEditorEnabled(): boolean {
  return import.meta.env.VITE_WYSIWYG_EDITOR_ENABLED === 'true'
}
