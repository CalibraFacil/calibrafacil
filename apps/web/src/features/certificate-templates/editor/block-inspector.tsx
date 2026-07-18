import type { Editor } from '@tiptap/react'

import {
  BAND_LABELS,
  BandConfigBody,
  LOCKED_BLOCK_LABELS,
  LockedBlockConfigBody,
  lockedBlockHasConfig,
} from './block-config-controls'

/**
 * Sidebar mount of the block/band configuration (orientation + fallback).
 * The PRIMARY editing surface is the in-context popover on the block itself
 * (ConfigPill in certificate-editor.tsx); both render the same shared bodies
 * from block-config-controls.tsx.
 */

function selectedNode(editor: Editor | null): {
  typeName: string
  attrs: Record<string, unknown>
} | null {
  if (!editor) return null
  const { selection } = editor.state
  const node = 'node' in selection ? selection.node : null
  if (!node || typeof node !== 'object') return null
  const typeName = Reflect.get(node, 'type')?.name
  if (typeof typeName !== 'string') return null
  const attrs = Reflect.get(node, 'attrs')
  return {
    typeName,
    attrs: attrs && typeof attrs === 'object' ? { ...attrs } : {},
  }
}

export function BlockInspector({ editor }: { editor: Editor | null }) {
  const node = selectedNode(editor)
  if (!editor || !editor.isEditable || !node) return null

  if (
    node.typeName === 'bandTopIdentity' ||
    node.typeName === 'bandPageFooter'
  ) {
    return (
      <div
        className="space-y-2.5 rounded-xl border p-3"
        data-testid="band-inspector"
      >
        <h2 className="text-sm font-semibold">{BAND_LABELS[node.typeName]}</h2>
        <BandConfigBody editor={editor} typeName={node.typeName} />
      </div>
    )
  }

  if (node.typeName !== 'lockedBlock') return null
  const blockKey = String(node.attrs.blockKey)
  if (!lockedBlockHasConfig(blockKey)) return null

  return (
    <div
      className="space-y-2.5 rounded-xl border p-3"
      data-testid="block-inspector"
    >
      <h2 className="text-sm font-semibold">
        {LOCKED_BLOCK_LABELS[blockKey] ?? blockKey}
      </h2>
      <LockedBlockConfigBody editor={editor} blockKey={blockKey} />
    </div>
  )
}
