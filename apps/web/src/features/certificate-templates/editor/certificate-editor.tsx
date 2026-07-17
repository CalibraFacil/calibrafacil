import { createContext, useContext, useState } from 'react'
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
  CertPlaceholder,
  LockedBlock,
  LockedBlockGuard,
  certificateEditorExtensions,
  certificateThemeClass,
  certificateThemeTokens,
  renderBandPageFooterTemplate,
  renderBandTopIdentityInner,
  renderLockedBlockInner,
  resolvePlaceholder,
  sampleCertificateInputData,
  CERTIFICATE_THEMES,
  type BandPageFooterNode,
  type BandTopIdentityNode,
  type CertificateTheme,
  type LockedBlockKey,
} from '@calibra-facil/certificate-html-template'

import { renderToStaticMarkup } from 'react-dom/server'
import { AccreditationSealSvg } from '@calibra-facil/documents'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Heading02Icon,
  Heading03Icon,
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  MinusSignIcon,
  Redo02Icon,
  SquareLock02Icon,
  Table01Icon,
  TextBoldIcon,
  TextItalicIcon,
  Undo02Icon,
  ViewIcon,
  ViewOffIcon,
} from '@hugeicons/core-free-icons'

import { Button } from '@/components/ui/button'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { cn } from '@/lib/utils'
import './certificate-editor.css'

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

export const LOCKED_BLOCK_LABELS: Record<string, string> = {
  certificate_identification: 'Identificação do certificado',
  lab_identification: 'Identificação do laboratório',
  customer_identification: 'Identificação do cliente',
  item_identification: 'Identificação do item',
  method_traceability: 'Método e rastreabilidade',
  environmental_conditions: 'Condições ambientais',
  results_table: 'Tabela de resultados',
  uncertainty_statement: 'Declaração de incerteza',
  signature_block: 'Assinatura autorizada',
  accreditation_seal: 'Selo de acreditação',
  verification_qr: 'QR de verificação',
  end_of_document: 'Fim do certificado',
}

// ---------------------------------------------------------------------------
// Editor-only sample data: identical to the canonical fixture, but binary
// artifacts (QR, signature image) are inline SVG placeholders so nothing 404s
// inside the editor. NEVER used by the real compiler.
// ---------------------------------------------------------------------------

const QR_PLACEHOLDER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  // Real QR matrix (generated with the same qrcode lib the compiler uses),
  // encoding the SAMPLE verification URL /v/exemplo — a deliberately invalid
  // token, so the preview scans to "certificado não encontrado".
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 31 31" shape-rendering="crispEdges"><path fill="#ffffff" d="M0 0h31v31H0z"/><path stroke="#000000" d="M1 1.5h7m1 0h1m1 0h2m1 0h2m2 0h2m3 0h7M1 2.5h1m5 0h1m2 0h1m4 0h1m2 0h2m1 0h1m1 0h1m5 0h1M1 3.5h1m1 0h3m1 0h1m1 0h3m2 0h1m1 0h6m1 0h1m1 0h3m1 0h1M1 4.5h1m1 0h3m1 0h1m2 0h1m1 0h8m3 0h1m1 0h3m1 0h1M1 5.5h1m1 0h3m1 0h1m3 0h2m2 0h1m2 0h2m3 0h1m1 0h3m1 0h1M1 6.5h1m5 0h1m1 0h1m1 0h3m1 0h1m1 0h1m5 0h1m5 0h1M1 7.5h7m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h1m1 0h7M12 8.5h2m1 0h1m1 0h1m1 0h2M1 9.5h1m1 0h1m3 0h2m2 0h2m3 0h2m2 0h1m3 0h1m2 0h1m1 0h1M1 10.5h1m3 0h2m3 0h4m1 0h3m2 0h2m1 0h2m3 0h2M2 11.5h1m1 0h2m1 0h2m1 0h1m3 0h3m2 0h3m1 0h1m1 0h3m1 0h1M1 12.5h2m1 0h2m2 0h2m1 0h1m4 0h2m1 0h2m2 0h1m1 0h2M1 13.5h3m3 0h1m2 0h4m3 0h1m2 0h2m1 0h2m4 0h1M3 14.5h2m1 0h1m1 0h5m1 0h1m1 0h1m1 0h1m1 0h5m3 0h2M2 15.5h1m1 0h2m1 0h3m2 0h3m1 0h5m1 0h1m1 0h1m4 0h1M1 16.5h1m2 0h3m1 0h2m2 0h2m2 0h2m1 0h1m2 0h1M1 17.5h1m4 0h2m4 0h1m3 0h1m4 0h3m5 0h1M3 18.5h2m3 0h4m2 0h1m1 0h3m1 0h2m1 0h2m2 0h3M1 19.5h2m1 0h8m4 0h1m1 0h1m1 0h2m3 0h2m2 0h1M4 20.5h2m2 0h1m1 0h1m4 0h3m3 0h1m1 0h2M1 21.5h4m1 0h5m2 0h3m1 0h1m1 0h1m1 0h6m1 0h1M9 22.5h1m1 0h1m1 0h2m1 0h1m1 0h1m2 0h1m3 0h3m1 0h1M1 23.5h7m1 0h1m1 0h1m1 0h1m2 0h1m4 0h1m1 0h1m1 0h1m3 0h1M1 24.5h1m5 0h1m6 0h1m2 0h1m2 0h2m3 0h1m2 0h1M1 25.5h1m1 0h3m1 0h1m2 0h3m1 0h1m2 0h1m2 0h7m1 0h1M1 26.5h1m1 0h3m1 0h1m3 0h1m1 0h2m1 0h2m2 0h1m1 0h1m2 0h3m1 0h1M1 27.5h1m1 0h3m1 0h1m1 0h1m3 0h2m1 0h1m2 0h4m2 0h1m2 0h2M1 28.5h1m5 0h1m4 0h3m1 0h2m1 0h1m1 0h1m3 0h2M1 29.5h7m1 0h2m3 0h1m2 0h1m3 0h1m3 0h1m3 0h1"/></svg>',
)}`

const LOGO_PLACEHOLDER_SVG = `data:image/svg+xml;utf8,${encodeURIComponent(
  // Compact mark only — the masthead already prints the lab name beside it.
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><rect width="96" height="96" rx="18" fill="#1e3a5f"/><text x="48" y="61" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="38" font-weight="700" fill="#fff">LE</text></svg>',
)}`

// The REAL accreditation seal component (packages/documents) — the same art
// the worker rasterizes at issuance — rendered with the sample CAL number.
const SEAL_SAMPLE_DATA_URL = `data:image/svg+xml;utf8,${encodeURIComponent(
  renderToStaticMarkup(<AccreditationSealSvg accreditationNumber="9999" />),
)}`

function buildEditorSampleData(): Record<string, unknown> {
  const clone: Record<string, unknown> = JSON.parse(
    JSON.stringify(sampleCertificateInputData),
  )
  // approval.signatureUrl already ships as an inline data URL in the fixture.
  const lab = Reflect.get(clone, 'lab')
  if (lab && typeof lab === 'object') {
    Reflect.set(lab, 'logoDataUrl', LOGO_PLACEHOLDER_SVG)
    Reflect.set(lab, 'accreditationSealPng', SEAL_SAMPLE_DATA_URL)
  }
  return clone
}

export const EDITOR_SAMPLE_DATA = buildEditorSampleData()

function isLockedBlockKey(value: string): value is LockedBlockKey {
  return value in LOCKED_BLOCK_LABELS
}

// ---------------------------------------------------------------------------
// Preview context: token view vs sample-data view for placeholder chips
// ---------------------------------------------------------------------------

const PreviewContext = createContext<{ showSampleValues: boolean }>({
  showSampleValues: false,
})

// ---------------------------------------------------------------------------
// Node views
// ---------------------------------------------------------------------------

function LockedBlockView(props: NodeViewProps) {
  const blockKey = String(props.node.attrs.blockKey)
  const label = LOCKED_BLOCK_LABELS[blockKey] ?? blockKey

  let renderedInner: string | null = null
  if (isLockedBlockKey(blockKey)) {
    try {
      const rawLayout = props.node.attrs.layout
      renderedInner = renderLockedBlockInner(
        blockKey,
        EDITOR_SAMPLE_DATA,
        { qrDataUrl: QR_PLACEHOLDER_SVG },
        rawLayout && typeof rawLayout === 'object' ? rawLayout : null,
      )
    } catch {
      renderedInner = null
    }
  }

  return (
    <NodeViewWrapper
      className="cf-locked-block-view"
      data-locked-block-view={blockKey}
      data-drag-handle
      draggable
    >
      <div className="cf-locked-block-view__header" contentEditable={false}>
        <span className="cf-locked-block-view__lock" aria-hidden>
          <HugeiconsIcon icon={SquareLock02Icon} size={11} strokeWidth={2} />
        </span>
        <span className="cf-locked-block-view__label">{label}</span>
        <span className="cf-locked-block-view__hint">
          dados de exemplo — preenchido na emissão
        </span>
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

function readTopBandAttrs(
  attrs: Record<string, unknown>,
): BandTopIdentityNode['attrs'] {
  return {
    enabled: attrs.enabled === true,
    showLabName: attrs.showLabName === true,
    showCertificateNumber: attrs.showCertificateNumber === true,
    showTitle: attrs.showTitle === true,
    showSealText: attrs.showSealText === true,
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
  }
}

function BandTopIdentityView(props: NodeViewProps) {
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
    <NodeViewWrapper className="cf-band-view" data-band-view="bandTopIdentity">
      <div className="cf-band-view__header" contentEditable={false}>
        <span className="cf-band-view__label">Identificação no topo</span>
        <span className="cf-band-view__hint">repete em todas as páginas</span>
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
      className="cf-band-view cf-band-view--footer"
      data-band-view="bandPageFooter"
    >
      <div className="cf-band-view__header" contentEditable={false}>
        <span className="cf-band-view__label">Rodapé do certificado</span>
        <span className="cf-band-view__hint">
          repete em todas as páginas · numeração obrigatória
        </span>
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
      return extension
    }),
    LockedBlockGuard,
  ]
}

export type CertificateEditorProps = {
  initialDocument: Record<string, unknown>
  editable?: boolean
  onDocumentChange?: (documentJson: Record<string, unknown>) => void
  onEditorReady?: (editor: Editor) => void
  /** Tests (jsdom, no SSR) pass true; the app default follows TipTap SSR guidance. */
  immediatelyRender?: boolean
}

export function CertificateEditor({
  initialDocument,
  editable = true,
  onDocumentChange,
  onEditorReady,
  immediatelyRender = false,
}: CertificateEditorProps) {
  // Read-only (published) views open in certificate form; drafts open showing
  // the editable tokens.
  const [showSampleValues, setShowSampleValues] = useState(!editable)
  const [zoomPercent, setZoomPercent] = useState(100)
  const [theme, setTheme] = useState<CertificateTheme>(
    readDocumentTheme(initialDocument),
  )
  const editor = useEditor({
    extensions: editorExtensions(),
    content: initialDocument,
    editable,
    immediatelyRender,
    onCreate: ({ editor: created }) => {
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
      onDocumentChange?.(json)
    },
  })

  return (
    <PreviewContext.Provider value={{ showSampleValues }}>
      <div className="cf-editor">
        {/* The REAL print stylesheet, scoped to the page frame via native CSS
            nesting. Nested :root/body selectors match nothing, so the design
            TOKENS are re-declared directly on .cf-page (base text styles live
            in certificate-editor.css). */}
        <style>{`.cf-page{${certificateThemeTokens(theme)}}\n.cf-page { ${CERTIFICATE_PRINT_CSS} }`}</style>
        <div className="cf-editor__bar">
          {editable && <EditorToolbar editor={editor} />}
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
          <NativeSelect
            aria-label="Zoom da página"
            value={String(zoomPercent)}
            className="h-8 w-22 text-xs"
            onChange={(event) => {
              const parsed = Number(event.target.value)
              setZoomPercent(Number.isFinite(parsed) && parsed > 0 ? parsed : 100)
            }}
          >
            {[50, 75, 100, 125, 150].map((level) => (
              <NativeSelectOption key={level} value={String(level)}>
                {level}%
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <Button
            type="button"
            variant={showSampleValues ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={showSampleValues}
            className="gap-1.5 transition-[transform,background-color] active:scale-[0.96]"
            onClick={() => setShowSampleValues((value) => !value)}
          >
            <HugeiconsIcon
              icon={showSampleValues ? ViewOffIcon : ViewIcon}
              size={15}
              strokeWidth={1.8}
            />
            {showSampleValues ? 'Ver campos' : 'Ver com dados de exemplo'}
          </Button>
        </div>
        <div
          className="cf-editor__paper"
          data-zoom={zoomPercent}
          style={zoomPercent === 100 ? undefined : { zoom: zoomPercent / 100 }}
        >
          <EditorContent
            editor={editor}
            className={cn(
              'cf-page',
              certificateThemeClass(theme),
              !editable && 'cf-page--readonly',
            )}
          />
        </div>
      </div>
    </PreviewContext.Provider>
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
        label="Divisor"
        icon={MinusSignIcon}
        onClick={() => run().setHorizontalRule().run()}
      />
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
