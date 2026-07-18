import { createContext, useContext, useRef, useState, type ReactNode } from 'react'
import {
  EditorContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  useEditor,
  type Editor,
  type NodeViewProps,
} from '@tiptap/react'
import {
  BandPageFooter,
  BandTopIdentity,
  CERTIFICATE_PRINT_CSS,
  OPTIONAL_BLOCK_KEYS,
  CertImage,
  CertPlaceholder,
  LockedBlock,
  LockedBlockGuard,
  certificateEditorExtensions,
  certificateStyleTokenOverrides,
  certificateThemeClass,
  certificateThemeTokens,
  renderBandPageFooterTemplate,
  renderBandTopIdentityInner,
  renderLockedBlockInner,
  resolvePlaceholder,
  CERTIFICATE_THEMES,
  type BandPageFooterNode,
  type BandTopIdentityNode,
  type CertificateFontScale,
  type CertificateStyleTokens,
  type CertificateTheme,
} from '@calibra-facil/certificate-html-template'

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  BAND_LABELS,
  BandConfigBody,
  LockedBlockConfigBody,
  lockedBlockHasConfig,
} from './block-config-controls'
import {
  EDITOR_SAMPLE_DATA,
  LOCKED_BLOCK_LABELS,
  QR_PLACEHOLDER_SVG,
  isLockedBlockKey,
} from './editor-sample-data'
import { FieldPalette } from './field-palette'
import { FieldSuggestion } from './field-suggestion'
import { SlashMenu } from './slash-menu'
import { issueBlockIndex, type ValidationIssue } from './forms'
import type { PlaceholderCatalogEntry } from '../types'

import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  DashedLine01Icon,
  Delete02Icon,
  Heading02Icon,
  SlidersHorizontalIcon,
  Heading03Icon,
  LeftToRightListBulletIcon,
  CombineIcon,
  LeftToRightListNumberIcon,
  MinusSignIcon,
  SplitIcon,
  Redo02Icon,
  SquareLock02Icon,
  Table01Icon,
  TextBoldIcon,
  TextItalicIcon,
  Undo02Icon,
  ViewIcon,
  ViewOffIcon,
  DragDropVerticalIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import { ImagePicker } from './image-picker'
import './certificate-editor.css'

export { EDITOR_SAMPLE_DATA, LOCKED_BLOCK_LABELS } from './editor-sample-data'

/**
 * TipTap editor core for wysiwyg certificate templates (spec 02 §0/§6.2).
 * Schema + locked-block guard come from @calibra-facil/certificate-html-template
 * (the SAME modules the backend compiler uses); this file adds UI only.
 *
 * PREVIEW FIDELITY (T17): locked blocks render their REAL compiled HTML
 * against the canonical sample data — the exact renderers the worker runs at
 * issuance — inside an A4 page frame styled with the actual print CSS. What
 * you see is what gets issued, except pagination (Chromium decides page
 * breaks at print time; the PDF preview remains the source of truth there).
 */

// ---------------------------------------------------------------------------
// Preview context: token view vs sample-data view for placeholder chips
// ---------------------------------------------------------------------------

const PreviewContext = createContext<{ showSampleValues: boolean }>({
  showSampleValues: false,
})

/** Validation issues grouped by top-level block index (inline badges). */
const IssuesContext = createContext<Map<number, string[]>>(new Map())

function useBlockIssues(props: NodeViewProps): string[] {
  const byIndex = useContext(IssuesContext)
  if (byIndex.size === 0) return []
  const pos = props.getPos()
  if (typeof pos !== 'number') return []
  try {
    return byIndex.get(props.editor.state.doc.resolve(pos).index(0)) ?? []
  } catch {
    return []
  }
}

function BlockIssueBadge({ messages }: { messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <span
      className="cf-block-issue-badge"
      title={messages.join('\n')}
      data-testid="block-issue-badge"
    >
      {messages.length}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Node views
// ---------------------------------------------------------------------------

/**
 * In-context configuration: a pill in the block's hover header opening a
 * popover anchored beside the block, so edits are visible without scrolling
 * to the sidebar. The popover portals to document.body (outside the zoomed
 * paper subtree), so CSS zoom does not skew anchoring; mutation handlers in
 * block-config-controls never refocus the editor, so the popover survives
 * every toggle.
 */
function ConfigPill({
  open,
  onOpenChange,
  onBeforeOpen,
  label,
  align,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onBeforeOpen: () => void
  label: string
  align?: 'start' | 'end'
  children: ReactNode
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            className="cf-config-pill"
            aria-label={`Configurar ${label}`}
            title={`Configurar ${label}`}
            // Keep ProseMirror's mousedown handling (drag start / selection
            // races) away from the pill.
            onMouseDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              if (!open) onBeforeOpen()
            }}
          >
            <HugeiconsIcon
              icon={SlidersHorizontalIcon}
              size={12}
              strokeWidth={2}
            />
          </button>
        }
      />
      <PopoverContent
        align={align ?? 'start'}
        side="bottom"
        sideOffset={6}
        className="w-72 p-3"
        data-testid="block-config-popover"
      >
        <h2 className="text-sm font-semibold">{label}</h2>
        {children}
      </PopoverContent>
    </Popover>
  )
}

function LockedBlockView(props: NodeViewProps) {
  const blockKey = String(props.node.attrs.blockKey)
  const label = LOCKED_BLOCK_LABELS[blockKey] ?? blockKey
  const [configOpen, setConfigOpen] = useState(false)
  const blockIssues = useBlockIssues(props)
  const optionalKeys: readonly string[] = OPTIONAL_BLOCK_KEYS
  const isOptional = optionalKeys.includes(blockKey)
  const selectSelf = () => {
    const pos = props.getPos()
    if (typeof pos === 'number') props.editor.commands.setNodeSelection(pos)
  }
  const removeSelf = () => {
    const pos = props.getPos()
    if (typeof pos !== 'number') return
    props.editor.commands.deleteRange({
      from: pos,
      to: pos + props.node.nodeSize,
    })
  }

  let renderedInner: string | null = null
  if (isLockedBlockKey(blockKey)) {
    try {
      const rawLayout = props.node.attrs.layout
      renderedInner = renderLockedBlockInner(
        blockKey,
        EDITOR_SAMPLE_DATA,
        {
          qrDataUrl: QR_PLACEHOLDER_SVG,
          bilingual: props.editor.state.doc.attrs.bilingual === true,
        },
        rawLayout && typeof rawLayout === 'object' ? rawLayout : null,
      )
    } catch {
      renderedInner = null
    }
  }

  return (
    <NodeViewWrapper
      className={cn(
        'cf-locked-block-view',
        configOpen && 'cf-config-open',
      )}
      data-locked-block-view={blockKey}
      onClick={selectSelf}
    >
      <div className="cf-locked-block-view__header" contentEditable={false}>
        {props.editor.isEditable && (
          <span
            className="cf-drag-grip"
            data-drag-handle
            draggable
            title="Arrastar para reordenar"
            aria-hidden
          >
            <HugeiconsIcon
              icon={DragDropVerticalIcon}
              size={12}
              strokeWidth={2}
            />
          </span>
        )}
        {!isOptional && (
          <span className="cf-locked-block-view__lock" aria-hidden>
            <HugeiconsIcon icon={SquareLock02Icon} size={11} strokeWidth={2} />
          </span>
        )}
        <span className="cf-locked-block-view__label">{label}</span>
        <BlockIssueBadge messages={blockIssues} />
        <span className="cf-locked-block-view__hint">
          {isOptional
            ? 'bloco opcional — preenchido na emissão'
            : 'dados de exemplo — preenchido na emissão'}
        </span>
        {isOptional && props.editor.isEditable && (
          <button
            type="button"
            className="cf-config-pill"
            aria-label={`Remover ${label}`}
            title={`Remover ${label}`}
            onMouseDown={(event) => {
              event.stopPropagation()
            }}
            onClick={(event) => {
              event.stopPropagation()
              removeSelf()
            }}
          >
            <HugeiconsIcon icon={Delete02Icon} size={12} strokeWidth={2} />
          </button>
        )}
        {props.editor.isEditable && lockedBlockHasConfig(blockKey) && (
          <ConfigPill
            open={configOpen}
            onOpenChange={setConfigOpen}
            onBeforeOpen={selectSelf}
            label={label}
            align={blockKey === 'accreditation_seal' ? 'end' : 'start'}
          >
            <LockedBlockConfigBody editor={props.editor} blockKey={blockKey} />
          </ConfigPill>
        )}
      </div>
      {renderedInner ? (
        <div
          className={cn(
            'cf-locked-block cf-locked-block-view__body',
            typeof props.node.attrs.layout?.columns === 'number' &&
              `cf-layout-cols-${props.node.attrs.layout.columns}`,
            props.node.attrs.layout?.density === 'compact' &&
              'cf-layout-compact',
          )}
          data-locked-block={blockKey}
          contentEditable={false}
          // The SAME trusted renderer output the worker compiles at issuance
          // (all interpolated data is escaped inside renderLockedBlockInner).
          dangerouslySetInnerHTML={{ __html: renderedInner }}
        />
      ) : (
        <div className="cf-locked-block-view__body cf-locked-block-view__fallback">
          Conteúdo indisponível na visualização — será preenchido na emissão.
        </div>
      )}
    </NodeViewWrapper>
  )
}

function PlaceholderView(props: NodeViewProps) {
  const { showSampleValues } = useContext(PreviewContext)
  const path = String(props.node.attrs.path)
  const label =
    typeof props.node.attrs.label === 'string' ? props.node.attrs.label : path

  let sampleValue: string | null = null
  let invalid = false
  try {
    sampleValue = resolvePlaceholder(EDITOR_SAMPLE_DATA, path)
  } catch {
    invalid = true
  }

  const showValue = showSampleValues && !invalid && sampleValue !== null
  return (
    <NodeViewWrapper
      as="span"
      className={cn(
        'cf-placeholder',
        showValue && 'cf-placeholder--value',
        invalid && 'cf-placeholder--invalid',
      )}
      data-placeholder-path={path}
      title={invalid ? `Campo inválido: ${path}` : `${label} — {{${path}}}`}
    >
      {showValue ? (sampleValue === '' ? '—' : sampleValue) : `{{${path}}}`}
    </NodeViewWrapper>
  )
}

// ---------------------------------------------------------------------------
// Band lanes (M-B): page furniture that repeats on every printed page. The
// lanes render the REAL band renderers against the sample data; clicking a
// lane selects the band node so the inspector exposes its config.
// ---------------------------------------------------------------------------

function rowSlot(value: unknown): 'left' | 'right' | undefined {
  return value === 'left' || value === 'right' ? value : undefined
}

function readTopBandAttrs(
  attrs: Record<string, unknown>,
): BandTopIdentityNode['attrs'] {
  return {
    enabled: attrs.enabled === true,
    showLabName: attrs.showLabName === true,
    showCertificateNumber: attrs.showCertificateNumber === true,
    showTitle: attrs.showTitle === true,
    showSealText: attrs.showSealText === true,
    labNameSlot: rowSlot(attrs.labNameSlot),
    titleSlot: rowSlot(attrs.titleSlot),
    certificateNumberSlot: rowSlot(attrs.certificateNumberSlot),
    sealTextSlot:
      attrs.sealTextSlot === 'line2' ? 'line2' : rowSlot(attrs.sealTextSlot),
  }
}

function readFooterBandAttrs(
  attrs: Record<string, unknown>,
): BandPageFooterNode['attrs'] {
  return {
    enabled: attrs.enabled === true,
    showCertificateNumber: attrs.showCertificateNumber === true,
    showLabName: attrs.showLabName === true,
    showIssueDate: attrs.showIssueDate === true,
    identitySide: rowSlot(attrs.identitySide),
  }
}

function BandTopIdentityView(props: NodeViewProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const selectSelf = () => {
    const pos = props.getPos()
    if (typeof pos === 'number') props.editor.commands.setNodeSelection(pos)
  }
  let inner = ''
  try {
    inner = renderBandTopIdentityInner(
      readTopBandAttrs(props.node.attrs),
      EDITOR_SAMPLE_DATA,
    )
  } catch {
    inner = ''
  }
  return (
    <NodeViewWrapper
      className={cn('cf-band-view', configOpen && 'cf-config-open')}
      data-band-view="bandTopIdentity"
    >
      <div className="cf-band-view__header" contentEditable={false}>
        <span className="cf-band-view__label">Identificação no topo</span>
        <span className="cf-band-view__hint">repete em todas as páginas</span>
        {props.editor.isEditable && (
          <ConfigPill
            open={configOpen}
            onOpenChange={setConfigOpen}
            onBeforeOpen={selectSelf}
            label={BAND_LABELS.bandTopIdentity ?? 'Faixa'}
          >
            <BandConfigBody editor={props.editor} typeName="bandTopIdentity" />
          </ConfigPill>
        )}
      </div>
      {inner !== '' ? (
        <div
          className="cf-band-top-identity"
          contentEditable={false}
          // Trusted output of the same band renderer the compiler runs.
          dangerouslySetInnerHTML={{ __html: inner }}
        />
      ) : (
        <div className="cf-band-view__empty" contentEditable={false}>
          Faixa desativada — nenhuma identificação repetida no topo.
        </div>
      )}
    </NodeViewWrapper>
  )
}

function BandPageFooterView(props: NodeViewProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const selectSelf = () => {
    const pos = props.getPos()
    if (typeof pos === 'number') props.editor.commands.setNodeSelection(pos)
  }
  // The footer band compiles to a Chromium footerTemplate; the lane previews
  // its body with sample page numbers (real values only exist at print time).
  let inner = ''
  try {
    const template = renderBandPageFooterTemplate(
      readFooterBandAttrs(props.node.attrs),
      EDITOR_SAMPLE_DATA,
    )
    inner = (/<body>([\s\S]*)<\/body>/.exec(template)?.[1] ?? '')
      .replace('<span class="pageNumber"></span>', '1')
      .replace('<span class="totalPages"></span>', '2')
  } catch {
    inner = ''
  }
  return (
    <NodeViewWrapper
      className={cn(
        'cf-band-view cf-band-view--footer',
        configOpen && 'cf-config-open',
      )}
      data-band-view="bandPageFooter"
    >
      <div className="cf-band-view__header" contentEditable={false}>
        <span className="cf-band-view__label">Rodapé do certificado</span>
        <span className="cf-band-view__hint">
          repete em todas as páginas · numeração obrigatória
        </span>
        {props.editor.isEditable && (
          <ConfigPill
            open={configOpen}
            onOpenChange={setConfigOpen}
            onBeforeOpen={selectSelf}
            label={BAND_LABELS.bandPageFooter ?? 'Rodapé'}
            align="end"
          >
            <BandConfigBody editor={props.editor} typeName="bandPageFooter" />
          </ConfigPill>
        )}
      </div>
      {inner !== '' ? (
        <div
          className="cf-band-footer-preview"
          contentEditable={false}
          dangerouslySetInnerHTML={{ __html: inner }}
        />
      ) : (
        <div className="cf-band-view__empty" contentEditable={false}>
          Rodapé indisponível.
        </div>
      )}
    </NodeViewWrapper>
  )
}

function CertImageView(props: NodeViewProps) {
  const mediaId = Number(props.node.attrs.mediaId)
  const alt = typeof props.node.attrs.alt === 'string' ? props.node.attrs.alt : ''
  const widthMm =
    typeof props.node.attrs.widthMm === 'number' ? props.node.attrs.widthMm : null
  return (
    <NodeViewWrapper className="cf-image" data-media-id={mediaId} draggable>
      <img
        src={`/api/organization-media/library/${mediaId}/file`}
        alt={alt}
        style={widthMm ? { width: `${widthMm}mm` } : undefined}
        contentEditable={false}
      />
    </NodeViewWrapper>
  )
}

const CertImageWithView = CertImage.extend({
  addNodeView() {
    return ReactNodeViewRenderer(CertImageView)
  },
})

const LockedBlockWithView = LockedBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(LockedBlockView)
  },
})

const PlaceholderWithView = CertPlaceholder.extend({
  addNodeView() {
    return ReactNodeViewRenderer(PlaceholderView)
  },
})

const BandTopIdentityWithView = BandTopIdentity.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BandTopIdentityView)
  },
})

const BandPageFooterWithView = BandPageFooter.extend({
  addNodeView() {
    return ReactNodeViewRenderer(BandPageFooterView)
  },
})

function editorExtensions() {
  return [
    ...certificateEditorExtensions().map((extension) => {
      if (extension.name === 'lockedBlock') return LockedBlockWithView
      if (extension.name === 'placeholder') return PlaceholderWithView
      if (extension.name === 'bandTopIdentity') return BandTopIdentityWithView
      if (extension.name === 'bandPageFooter') return BandPageFooterWithView
      if (extension.name === 'image') return CertImageWithView
      return extension
    }),
    LockedBlockGuard,
    FieldSuggestion,
    SlashMenu,
  ]
}

export type CertificateEditorProps = {
  initialDocument: Record<string, unknown>
  /** Placeholder catalog for the {{ autocomplete + Campos palette. */
  catalog?: PlaceholderCatalogEntry[]
  /** Server validation issues — rendered as inline badges on the blocks. */
  issues?: ValidationIssue[]
  editable?: boolean
  onDocumentChange?: (documentJson: Record<string, unknown>) => void
  onEditorReady?: (editor: Editor) => void
  /** Tests (jsdom, no SSR) pass true; the app default follows TipTap SSR guidance. */
  immediatelyRender?: boolean
}

export function CertificateEditor({
  initialDocument,
  catalog = [],
  issues = [],
  editable = true,
  onDocumentChange,
  onEditorReady,
  immediatelyRender = false,
}: CertificateEditorProps) {
  // The suggestion plugin closes over a GETTER so a late-loading catalog
  // never requires re-initializing the editor.
  const catalogRef = useRef<PlaceholderCatalogEntry[]>(catalog)
  catalogRef.current = catalog
  // Read-only (published) views open in certificate form; drafts open showing
  // the editable tokens.
  const [showSampleValues, setShowSampleValues] = useState(!editable)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [, setSelectionTick] = useState(0)
  const [hoverBlock, setHoverBlock] = useState<{
    pos: number
    top: number
  } | null>(null)
  const paperRef = useRef<HTMLDivElement | null>(null)
  // A4 width at CSS 96dpi: 210mm ≈ 794px (fit-width baseline).
  const fitWidthPercent = () => {
    const width = paperRef.current?.clientWidth
    if (!width) return 100
    return Math.max(50, Math.min(150, Math.floor((width / 794) * 100)))
  }
  const [showPageMarks, setShowPageMarks] = useState(false)
  const [theme, setTheme] = useState<CertificateTheme>(
    readDocumentTheme(initialDocument),
  )
  const [styleTokens, setStyleTokens] = useState<CertificateStyleTokens | null>(
    readDocumentStyleTokens(initialDocument),
  )
  const [bilingual, setBilingual] = useState(
    readDocumentBilingual(initialDocument),
  )
  const editor = useEditor({
    extensions: editorExtensions(),
    content: initialDocument,
    editable,
    immediatelyRender,
    onCreate: ({ editor: created }) => {
      for (const storageKey of ['fieldSuggestion', 'slashMenu']) {
        const suggestionStorage = Reflect.get(created.storage, storageKey)
        if (suggestionStorage && typeof suggestionStorage === 'object') {
          Reflect.set(
            suggestionStorage,
            'getCatalog',
            () => catalogRef.current,
          )
        }
      }
      // The doc opens with the band atom first; land the caret on the first
      // EDITABLE position instead so typing never targets the band node.
      let firstTextPos = -1
      created.state.doc.descendants((node, pos) => {
        if (firstTextPos === -1 && node.isTextblock) firstTextPos = pos
        return firstTextPos === -1
      })
      if (firstTextPos >= 0) {
        created.commands.setTextSelection(firstTextPos + 1)
      }
      onEditorReady?.(created)
    },
    onUpdate: ({ editor: updated }) => {
      const json = updated.getJSON()
      setTheme(readDocumentTheme(json))
      setStyleTokens(readDocumentStyleTokens(json))
      setBilingual(readDocumentBilingual(json))
      onDocumentChange?.(json)
    },
    onSelectionUpdate: () => setSelectionTick((tick) => tick + 1),
    editorProps: {
      handleDOMEvents: {
        // Notion-idiom ＋ gutter: track the hovered TOP-LEVEL block so the
        // insert handle can sit beside it.
        mousemove: (view, event) => {
          // Resolve the hovered TOP-LEVEL block from the event target's DOM —
          // posAtCoords lands after atom NodeViews and pointed the handle at
          // the FOLLOWING block; the DOM ancestry cannot be off.
          const target = event.target instanceof Element ? event.target : null
          const paperEl = paperRef.current
          if (!target || !paperEl) return false
          const holder: {
            hit: { pos: number; dom: HTMLElement } | null
          } = { hit: null }
          view.state.doc.forEach((_node, offset) => {
            if (holder.hit) return
            const dom = view.nodeDOM(offset)
            if (
              dom instanceof HTMLElement &&
              (dom === target || dom.contains(target))
            ) {
              holder.hit = { pos: offset, dom }
            }
          })
          if (!holder.hit) return false
          const { pos: blockPos, dom: blockDom } = holder.hit
          const zoomFactor =
            Number(paperEl.getAttribute('data-zoom') ?? '100') / 100 || 1
          const paperRect = paperEl.getBoundingClientRect()
          const blockRect = blockDom.getBoundingClientRect()
          const top = Math.round(
            (blockRect.top - paperRect.top) / zoomFactor,
          )
          setHoverBlock((current) =>
            current?.pos === blockPos && current.top === top
              ? current
              : { pos: blockPos, top },
          )
          return false
        },
      },
      handleKeyDown: (_view, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false
        if (event.key === '=' || event.key === '+') {
          event.preventDefault()
          setZoomPercent((zoom) => Math.min(150, zoom + 25))
          return true
        }
        if (event.key === '-') {
          event.preventDefault()
          setZoomPercent((zoom) => Math.max(50, zoom - 25))
          return true
        }
        if (event.key === '0') {
          event.preventDefault()
          setZoomPercent(100)
          return true
        }
        return false
      },
    },
  })

  const issuesByIndex = new Map<number, string[]>()
  for (const issue of issues) {
    const index = issueBlockIndex(issue.path)
    if (index === null) continue
    issuesByIndex.set(index, [...(issuesByIndex.get(index) ?? []), issue.message])
  }

  return (
    <IssuesContext.Provider value={issuesByIndex}>
    <PreviewContext.Provider value={{ showSampleValues }}>
      <div className="cf-editor">
        {/* The REAL print stylesheet, scoped to the page frame via native CSS
            nesting. Nested :root/body selectors match nothing, so the design
            TOKENS are re-declared directly on .cf-page (base text styles live
            in certificate-editor.css). */}
        <style>{`.cf-page{${certificateThemeTokens(theme)}${certificateStyleTokenOverrides(styleTokens)}}\n.cf-page { ${CERTIFICATE_PRINT_CSS} }`}</style>
        <div className="cf-editor__bar">
          {editable && <EditorToolbar editor={editor} />}
          {editable && <FieldPalette editor={editor} catalog={catalog} />}
          {editable && <ImagePicker editor={editor} />}
          {editable && (
            <NativeSelect
              aria-label="Registro visual"
              value={theme}
              className="h-8 w-44 text-xs"
              onChange={(event) => {
                const next = event.target.value
                if (!editor) return
                editor
                  .chain()
                  .focus()
                  .command(({ tr }) => {
                    tr.setDocAttribute('theme', next)
                    return true
                  })
                  .run()
              }}
            >
              {CERTIFICATE_THEMES.map((themeOption) => (
                <NativeSelectOption key={themeOption} value={themeOption}>
                  {THEME_LABELS[themeOption]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          )}
          {editable && (
            <StyleTokenControls editor={editor} styleTokens={styleTokens} />
          )}
          {editable && (
            <Button
              type="button"
              variant={bilingual ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={bilingual}
              aria-label="Rótulos bilíngues (PT/EN)"
              className="text-xs transition-[transform,background-color] active:scale-[0.96]"
              onClick={() => {
                if (!editor) return
                const next = !bilingual
                editor
                  .chain()
                  .focus()
                  .command(({ tr }) => {
                    tr.setDocAttribute('bilingual', next ? true : null)
                    // No-op remap of each locked block so its NodeView
                    // re-renders with the new label language immediately.
                    tr.doc.descendants((node, pos) => {
                      if (node.type.name === 'lockedBlock') {
                        tr.setNodeMarkup(pos, undefined, { ...node.attrs })
                      }
                      return false
                    })
                    return true
                  })
                  .run()
              }}
            >
              PT/EN
            </Button>
          )}
          <NativeSelect
            aria-label="Zoom da página"
            value={
              [50, 75, 100, 125, 150].includes(zoomPercent)
                ? String(zoomPercent)
                : 'fit'
            }
            className="h-8 w-22 text-xs"
            onChange={(event) => {
              if (event.target.value === 'fit') {
                setZoomPercent(fitWidthPercent())
                return
              }
              const parsed = Number(event.target.value)
              setZoomPercent(Number.isFinite(parsed) && parsed > 0 ? parsed : 100)
            }}
          >
            {[50, 75, 100, 125, 150].map((level) => (
              <NativeSelectOption key={level} value={String(level)}>
                {level}%
              </NativeSelectOption>
            ))}
            <NativeSelectOption value="fit">Ajustar largura</NativeSelectOption>
          </NativeSelect>
          <Button
            type="button"
            variant={showPageMarks ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={showPageMarks}
            aria-label="Quebras de página (aproximadas)"
            title="Mostrar quebras de página aproximadas — a paginação final é decidida na geração do PDF"
            className="size-8 p-0 transition-[transform,background-color] active:scale-[0.96]"
            onClick={() => setShowPageMarks((value) => !value)}
          >
            <HugeiconsIcon icon={DashedLine01Icon} size={15} strokeWidth={1.8} />
          </Button>
          <Button
            type="button"
            variant={showSampleValues ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={showSampleValues}
            aria-label={
              showSampleValues ? 'Ver campos' : 'Ver com dados de exemplo'
            }
            title={showSampleValues ? 'Ver campos' : 'Ver com dados de exemplo'}
            className="size-8 p-0 transition-[transform,background-color] active:scale-[0.96]"
            onClick={() => setShowSampleValues((value) => !value)}
          >
            <HugeiconsIcon
              icon={showSampleValues ? ViewOffIcon : ViewIcon}
              size={15}
              strokeWidth={1.8}
            />
          </Button>
        </div>
        <div
          ref={paperRef}
          className="cf-editor__paper"
          data-zoom={zoomPercent}
          style={zoomPercent === 100 ? undefined : { zoom: zoomPercent / 100 }}
          // Hover state clears when leaving the PAPER (page + gutter), never
          // when merely crossing from the page toward the ＋ in the gutter.
          onMouseLeave={() => setHoverBlock(null)}
        >
          <EditorContent
            editor={editor}
            className={cn(
              'cf-page',
              certificateThemeClass(theme),
              !editable && 'cf-page--readonly',
              editable && !showSampleValues && 'cf-page--tokens',
              showPageMarks && 'cf-page--pagemarks',
            )}
          />
          {editable && editor && hoverBlock !== null && (
            <button
              type="button"
              className="cf-insert-handle"
              style={{ top: hoverBlock.top }}
              aria-label="Inserir bloco abaixo"
              title="Inserir abaixo (abre o menu /)"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const { doc } = editor.state
                const node = doc.nodeAt(hoverBlock.pos)
                if (!node) return
                const after = hoverBlock.pos + node.nodeSize
                editor
                  .chain()
                  .focus()
                  .insertContentAt(after, { type: 'paragraph' })
                  .setTextSelection(after + 1)
                  .insertContent('/')
                  .run()
              }}
            >
              +
            </button>
          )}
        </div>
        <SelectionDock editor={editor} />
      </div>
    </PreviewContext.Provider>
    </IssuesContext.Provider>
  )
}

/**
 * Floating selection dock (shell reframe step 4): a slim bottom bar naming
 * the selected block/band with a Configurar action that scrolls the block
 * into view and opens ITS OWN ConfigPill — it never duplicates the pill's
 * content, so there is exactly one config surface.
 */
function SelectionDock({ editor }: { editor: Editor | null }) {
  if (!editor || !editor.isEditable) return null
  const { selection } = editor.state
  const node = 'node' in selection ? selection.node : null
  if (!node || typeof node !== 'object') return null
  const typeName = Reflect.get(node, 'type')?.name
  let label: string | null = null
  let configurable = false
  if (typeName === 'lockedBlock') {
    const blockKey = String(Reflect.get(node, 'attrs')?.blockKey ?? '')
    label = LOCKED_BLOCK_LABELS[blockKey] ?? blockKey
    configurable = lockedBlockHasConfig(blockKey)
  } else if (typeName === 'bandTopIdentity' || typeName === 'bandPageFooter') {
    label = BAND_LABELS[typeName] ?? typeName
    configurable = true
  }
  if (!label) return null

  const openConfig = () => {
    const dom = editor.view.nodeDOM(selection.from)
    if (dom instanceof HTMLElement) {
      if (typeof dom.scrollIntoView === 'function') {
        dom.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }
      if (configurable) {
        dom
          .querySelector<HTMLButtonElement>(
            'button.cf-config-pill[aria-label^="Configurar"]',
          )
          ?.click()
      }
    }
  }

  return (
    <div className="cf-selection-dock" data-testid="selection-dock">
      <span className="cf-selection-dock__label">{label}</span>
      {configurable && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 px-2.5 text-xs transition-[transform,background-color] active:scale-[0.96]"
          onClick={openConfig}
        >
          Configurar
        </Button>
      )}
    </div>
  )
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
  if (!editor) return null
  const run = () => editor.chain().focus()
  return (
    <div
      className="cf-editor__toolbar"
      role="toolbar"
      aria-label="Ferramentas do editor"
    >
      <ToolbarButton
        label="Negrito"
        icon={TextBoldIcon}
        active={editor.isActive('bold')}
        onClick={() => run().toggleBold().run()}
      />
      <ToolbarButton
        label="Itálico"
        icon={TextItalicIcon}
        active={editor.isActive('italic')}
        onClick={() => run().toggleItalic().run()}
      />
      <span className="cf-editor__toolbar-divider" />
      <ToolbarButton
        label="Título"
        icon={Heading02Icon}
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => run().toggleHeading({ level: 2 }).run()}
      />
      <ToolbarButton
        label="Subtítulo"
        icon={Heading03Icon}
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => run().toggleHeading({ level: 3 }).run()}
      />
      <ToolbarButton
        label="Lista"
        icon={LeftToRightListBulletIcon}
        active={editor.isActive('bulletList')}
        onClick={() => run().toggleBulletList().run()}
      />
      <ToolbarButton
        label="Lista numerada"
        icon={LeftToRightListNumberIcon}
        active={editor.isActive('orderedList')}
        onClick={() => run().toggleOrderedList().run()}
      />
      <span className="cf-editor__toolbar-divider" />
      <ToolbarButton
        label="Tabela"
        icon={Table01Icon}
        onClick={() =>
          run().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()
        }
      />
      <ToolbarButton
        label="Mesclar células"
        icon={CombineIcon}
        onClick={() => run().mergeCells().run()}
      />
      <ToolbarButton
        label="Dividir célula"
        icon={SplitIcon}
        onClick={() => run().splitCell().run()}
      />
      <ToolbarButton
        label="Divisor"
        icon={MinusSignIcon}
        onClick={() => run().setHorizontalRule().run()}
      />
      <span className="cf-editor__toolbar-divider" />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Inserir bloco"
              title="Inserir bloco opcional"
              className="h-8 gap-1 px-2 text-xs transition-[transform,background-color] active:scale-[0.96]"
            >
              <HugeiconsIcon icon={Add01Icon} size={15} strokeWidth={1.8} />
              Bloco
            </Button>
          }
        />
        <DropdownMenuContent align="start">
          {/* the guard enforces at-most-one: inserting an already-present
              optional block is a rejected transaction (harmless no-op) */}
          <DropdownMenuItem
            onClick={() =>
              run()
                .insertContent({
                  type: 'lockedBlock',
                  attrs: { blockKey: 'uncertainty_budget_annex' },
                })
                .run()
            }
          >
            Balanço de incertezas (anexo)
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() =>
              run()
                .insertContent({
                  type: 'lockedBlock',
                  attrs: { blockKey: 'decision_rule_statement' },
                })
                .run()
            }
          >
            Regra de decisão
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="cf-editor__toolbar-divider" />
      <ToolbarButton
        label="Desfazer"
        icon={Undo02Icon}
        onClick={() => run().undo().run()}
      />
      <ToolbarButton
        label="Refazer"
        icon={Redo02Icon}
        onClick={() => run().redo().run()}
      />
    </div>
  )
}

function ToolbarButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: typeof TextBoldIcon
  active?: boolean
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'ghost'}
      size="sm"
      aria-label={label}
      aria-pressed={active}
      title={label}
      className="size-8 p-0 transition-[transform,background-color,color] active:scale-[0.96]"
      onClick={onClick}
    >
      <HugeiconsIcon icon={icon} size={16} strokeWidth={1.8} />
    </Button>
  )
}

/** Curated accent swatches (no raw CSS smuggling — schema only accepts hex). */
const ACCENT_SWATCHES: Array<{ value: string; label: string }> = [
  { value: '#1F3A5F', label: 'Azul técnico' },
  { value: '#111418', label: 'Grafite' },
  { value: '#0F5132', label: 'Verde escuro' },
  { value: '#7A1F1F', label: 'Vinho' },
  { value: '#0E7490', label: 'Petróleo' },
  { value: '#92400E', label: 'Âmbar escuro' },
]

const FONT_SCALE_LABELS: Record<string, string> = {
  '0.9': 'Texto 90%',
  '1': 'Texto 100%',
  '1.1': 'Texto 110%',
}

function writeStyleTokens(
  editor: Editor,
  next: CertificateStyleTokens | null,
) {
  const normalized =
    next && (next.accent || (next.fontScale !== undefined && next.fontScale !== 1))
      ? next
      : null
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setDocAttribute('styleTokens', normalized)
      return true
    })
    .run()
}

function StyleTokenControls({
  editor,
  styleTokens,
}: {
  editor: Editor | null
  styleTokens: CertificateStyleTokens | null
}) {
  if (!editor) return null
  const accent = styleTokens?.accent
  const fontScale = styleTokens?.fontScale ?? 1
  return (
    <>
      <Popover>
        <PopoverTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label="Cor de destaque"
              className="gap-1.5 transition-[transform,background-color] active:scale-[0.96]"
            >
              <span
                aria-hidden
                className="size-3.5 rounded-full border border-black/20"
                style={{ backgroundColor: accent ?? 'var(--accent, #1F3A5F)' }}
              />
              Cor
            </Button>
          }
        />
        <PopoverContent align="start" className="w-56 p-3">
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            Cor de destaque
          </p>
          <div className="flex flex-wrap gap-2">
            {ACCENT_SWATCHES.map((swatch) => (
              <button
                key={swatch.value}
                type="button"
                title={swatch.label}
                aria-label={swatch.label}
                aria-pressed={accent === swatch.value}
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border transition-[transform,box-shadow] active:scale-[0.96]',
                  accent === swatch.value
                    ? 'border-foreground shadow-[0_0_0_2px_var(--background),0_0_0_3.5px_currentColor]'
                    : 'border-black/15',
                )}
                style={{ backgroundColor: swatch.value }}
                onClick={() =>
                  writeStyleTokens(editor, {
                    ...styleTokens,
                    accent: swatch.value,
                  })
                }
              />
            ))}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 w-full text-xs"
            disabled={!accent}
            onClick={() => {
              const next = { ...styleTokens }
              delete next.accent
              writeStyleTokens(editor, next)
            }}
          >
            Usar cor padrão do registro
          </Button>
        </PopoverContent>
      </Popover>
      <NativeSelect
        aria-label="Tamanho do texto"
        value={String(fontScale)}
        className="h-8 w-28 text-xs"
        onChange={(event) => {
          const parsed = Number(event.target.value)
          const next: CertificateFontScale =
            parsed === 0.9 ? 0.9 : parsed === 1.1 ? 1.1 : 1
          writeStyleTokens(editor, { ...styleTokens, fontScale: next })
        }}
      >
        {['0.9', '1', '1.1'].map((scale) => (
          <NativeSelectOption key={scale} value={scale}>
            {FONT_SCALE_LABELS[scale]}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </>
  )
}

function readDocumentStyleTokens(
  documentJson: Record<string, unknown>,
): CertificateStyleTokens | null {
  const attrs = Reflect.get(documentJson, 'attrs')
  const raw =
    attrs && typeof attrs === 'object' ? Reflect.get(attrs, 'styleTokens') : null
  if (!raw || typeof raw !== 'object') return null
  const accentRaw = Reflect.get(raw, 'accent')
  const scaleRaw = Reflect.get(raw, 'fontScale')
  const tokens: CertificateStyleTokens = {}
  if (typeof accentRaw === 'string' && /^#[0-9A-Fa-f]{6}$/.test(accentRaw)) {
    tokens.accent = accentRaw
  }
  if (scaleRaw === 0.9 || scaleRaw === 1 || scaleRaw === 1.1) {
    tokens.fontScale = scaleRaw
  }
  return tokens.accent || tokens.fontScale !== undefined ? tokens : null
}

function readDocumentBilingual(documentJson: Record<string, unknown>): boolean {
  const attrs = Reflect.get(documentJson, 'attrs')
  return (
    (attrs && typeof attrs === 'object'
      ? Reflect.get(attrs, 'bilingual')
      : null) === true
  )
}

function readDocumentTheme(
  documentJson: Record<string, unknown>,
): CertificateTheme {
  const attrs = Reflect.get(documentJson, 'attrs')
  const theme =
    attrs && typeof attrs === 'object' ? Reflect.get(attrs, 'theme') : null
  return theme === 'institute-classic' ? 'institute-classic' : 'technical-form'
}

export const THEME_LABELS: Record<CertificateTheme, string> = {
  'technical-form': 'Registro técnico',
  'institute-classic': 'Registro clássico',
}
