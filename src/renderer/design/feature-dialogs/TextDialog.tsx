/**
 * Wave 3f · Text → machinable sketch vectors dialog.
 *
 * "Sign work is impossible without machinable text vectors" (docs/plans/catalog/
 * vcarve-laguna.md Text/Clipart rows; cad-design.md gap #7). This dialog is the
 * reachable front door for the pure {@link textToSketchVectors} engine
 * (`src/shared/text-to-vectors.ts`): the operator types a string, picks the
 * bundled font, sets cap-height + letter spacing, and on Apply the engine
 * flattens the glyph outlines into CLOSED contours (outer CCW, counters CW) that
 * are folded into the LIVE session {@link DesignFileV2} via
 * {@link mergeTextVectorsIntoDesign}. The merged model is pushed straight onto
 * the same sketch surface the operator is looking at (additive — never clobbers
 * CAD-authored geometry) and persists like any other sketch edit, so the text
 * becomes derivable contour / pocket / V-carve toolpaths downstream exactly like
 * a DXF import (mirrors `DesignWorkspaceHost.handleImportDxf`).
 *
 * ──────────────────────────────────────────────────────────────────────────
 * Font bytes (no network at runtime)
 * ──────────────────────────────────────────────────────────────────────────
 * The engine needs the font's raw bytes. The font ships bundled under
 * `resources/fonts/` and the renderer can't read disk, so the bytes arrive via
 * the read-only `font:read` IPC (`window.fab.fontReadBundled`, base64). The
 * loader is injected ({@link TextDialogProps.loadFontBuffer}) so the component
 * unit-tests in the `node` vitest env with a real on-disk Roboto buffer and no
 * Electron. The buffer is cached per font id so re-opening the dialog or typing
 * does not re-read it.
 *
 * No `any`; every interactive element is a real `<button type="button">` /
 * native control; styling reuses the shared `FeatureDialogKit` (`.fd-*`).
 */

import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import {
  DialogApplyRow,
  DialogNumberField,
  DialogSelectField,
  FeatureDialogCard
} from './FeatureDialogKit'
import type { DesignFileV2 } from '../../../shared/design-schema'
import {
  mergeTextVectorsIntoDesign,
  type TextToVectorsResult
} from '../../../shared/text-to-vectors'
import {
  BUNDLED_FONT_IDS,
  BUNDLED_FONT_LABEL,
  DEFAULT_BUNDLED_FONT_ID,
  type BundledFontId
} from '../../../shared/bundled-font-contract'

/** Default cap-height (mm) a new text insert opens with — readable sign letters. */
export const DEFAULT_TEXT_SIZE_MM = 25
/** Default inter-glyph spacing (mm). 0 = the font's native advance widths. */
export const DEFAULT_TEXT_LETTER_SPACING_MM = 0

/** Loader for a bundled font's raw bytes, keyed by id. Returns an ArrayBuffer. */
export type FontBufferLoader = (fontId: BundledFontId) => Promise<ArrayBuffer>

/**
 * Default loader: pull the bundled font's base64 from the `font:read` IPC and
 * decode it to an ArrayBuffer. Throws a friendly error when the bridge or the
 * font is unavailable (the dialog surfaces it as an honest, non-fatal hint).
 */
export const loadBundledFontBufferViaFab: FontBufferLoader = async (fontId) => {
  const fab = (globalThis as { fab?: { fontReadBundled?: unknown } }).fab
  const read = fab?.fontReadBundled
  if (typeof read !== 'function') {
    throw new Error('Font bridge unavailable (window.fab.fontReadBundled missing).')
  }
  const res = (await (read as (p: { fontId: BundledFontId }) => Promise<unknown>)({ fontId })) as
    | { ok: true; base64: string }
    | { ok: false; error: string }
  if (!res.ok) throw new Error(res.error)
  return base64ToArrayBuffer(res.base64)
}

/** Decode a base64 string to a fresh ArrayBuffer (opentype.parse wants one). */
function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out.buffer
}

export interface TextDialogProps {
  /** The live sketch model the inserted text is merged into (additive). */
  readonly design: DesignFileV2
  /**
   * Apply the merged design (base + text contours). Wired to the session's
   * `onDesignChange`; the host then persists it like any other sketch edit.
   */
  readonly onInsert: (next: DesignFileV2) => void
  /** Close / dismiss the dialog (Cancel, or after a successful insert). */
  readonly onClose?: () => void
  /** Transient one-line status (insert summary, errors). */
  readonly onHint?: (msg: string) => void
  /**
   * Inject the font-bytes loader. Defaults to {@link loadBundledFontBufferViaFab}
   * (the `font:read` IPC). Tests pass a loader backed by an on-disk buffer.
   */
  readonly loadFontBuffer?: FontBufferLoader
}

/** Internal: which fonts the picker offers (the bundled set + their labels). */
const FONT_OPTIONS: ReadonlyArray<{ value: BundledFontId; label: string }> = BUNDLED_FONT_IDS.map(
  (id) => ({ value: id, label: BUNDLED_FONT_LABEL[id] })
)

export function TextDialog({
  design,
  onInsert,
  onClose,
  onHint,
  loadFontBuffer = loadBundledFontBufferViaFab
}: TextDialogProps): JSX.Element {
  const [text, setText] = useState('TEXT')
  const [fontId, setFontId] = useState<BundledFontId>(DEFAULT_BUNDLED_FONT_ID)
  const [sizeRaw, setSizeRaw] = useState(String(DEFAULT_TEXT_SIZE_MM))
  const [spacingRaw, setSpacingRaw] = useState(String(DEFAULT_TEXT_LETTER_SPACING_MM))
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Cache the decoded font buffer per id so typing / re-applying doesn't re-read
  // it. A ref (not state) — it never needs to trigger a re-render on its own.
  const fontCacheRef = useRef<Map<BundledFontId, ArrayBuffer>>(new Map())
  // Guards against a state update after unmount (the async apply path).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const size = Number.parseFloat(sizeRaw)
  const sizeValid = Number.isFinite(size) && size > 0
  const spacing = spacingRaw.trim() === '' ? 0 : Number.parseFloat(spacingRaw)
  const spacingValid = Number.isFinite(spacing)
  const hasText = text.trim().length > 0
  const canApply = hasText && sizeValid && spacingValid && !applying

  /** Resolve (and cache) the font buffer for the active id. */
  const resolveFontBuffer = useCallback(
    async (id: BundledFontId): Promise<ArrayBuffer> => {
      const cached = fontCacheRef.current.get(id)
      if (cached) return cached
      const buf = await loadFontBuffer(id)
      fontCacheRef.current.set(id, buf)
      return buf
    },
    [loadFontBuffer]
  )

  const handleApply = useCallback(async (): Promise<void> => {
    if (!hasText || !sizeValid || !spacingValid) return
    setApplying(true)
    setError(null)
    try {
      const fontBuffer = await resolveFontBuffer(fontId)
      const { design: merged, result } = mergeTextVectorsIntoDesign(
        {
          text,
          fontBuffer,
          sizeMm: size,
          letterSpacingMm: spacing
        },
        design
      )
      if (!mountedRef.current) return
      onInsert(merged)
      onHint?.(summarizeInsert(result))
      onClose?.()
    } catch (e) {
      if (!mountedRef.current) return
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      onHint?.(`Text insert failed: ${msg}`)
    } finally {
      if (mountedRef.current) setApplying(false)
    }
  }, [
    hasText,
    sizeValid,
    spacingValid,
    resolveFontBuffer,
    fontId,
    text,
    size,
    spacing,
    design,
    onInsert,
    onHint,
    onClose
  ])

  const applyHint = !hasText
    ? 'Enter the text to engrave.'
    : !sizeValid
      ? 'Enter a positive cap-height in millimetres.'
      : !spacingValid
        ? 'Letter spacing must be a number (may be negative).'
        : error !== null
          ? error
          : undefined

  return (
    <FeatureDialogCard title="Text" testId="fd-text">
      {/* Multi-line text entry — newlines split lines (engine steps the baseline). */}
      <div className="fd-field" data-testid="fd-text-string-field">
        <label className="fd-field__label" htmlFor="fd-text-string">
          Text
        </label>
        <textarea
          id="fd-text-string"
          className="fd-field__input fd-text__textarea"
          data-testid="fd-text-string"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Sign text…"
        />
      </div>

      <DialogSelectField
        label="Font"
        value={fontId}
        options={FONT_OPTIONS}
        onChange={(v) => setFontId(v)}
        testId="fd-text-font"
      />

      <DialogNumberField
        label="Size (cap height)"
        value={sizeRaw}
        onChange={setSizeRaw}
        testId="fd-text-size"
        min={0}
        suffix="mm"
      />

      <DialogNumberField
        label="Letter spacing"
        value={spacingRaw}
        onChange={setSpacingRaw}
        testId="fd-text-spacing"
        suffix="mm"
      />

      <p className="fd-note" data-testid="fd-text-note">
        Outlines flatten to closed contours (counters become holes) and drop onto
        the sketch additively — ready for profile, pocket, or V-carve toolpaths.
      </p>

      <div className="fd-text__actions">
        {onClose && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            data-testid="fd-text-cancel"
            onClick={onClose}
          >
            Cancel
          </button>
        )}
        <DialogApplyRow
          label="Insert text"
          onApply={() => {
            void handleApply()
          }}
          canApply={canApply}
          busy={applying}
          hint={applyHint}
          testId="fd-text-apply"
        />
      </div>
    </FeatureDialogCard>
  )
}

/** One-line operator summary of what an insert produced. */
function summarizeInsert(result: TextToVectorsResult): string {
  const loops = result.entities.length
  const holes = result.contours.filter((c) => c.isHole).length
  const solids = loops - holes
  const holeBit = holes > 0 ? ` (${solids} solid · ${holes} hole${holes === 1 ? '' : 's'})` : ''
  return `Inserted ${loops} text contour${loops === 1 ? '' : 's'}${holeBit}.`
}

export default TextDialog
