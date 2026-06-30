/**
 * Pure, framework-agnostic model layer for associative surface-finish
 * (surface-texture) symbols — the sibling of `drawing-gdt-model.ts` for the
 * ISO 1302 / ASME Y14.36 surface-texture annotation path.
 *
 * `DrawingView.tsx` is a thin orchestrator over the functions here: it reuses
 * the SAME one-click anchored-snap machinery GD&T frames use (the placement
 * machine + `cad.extract_drawing_geometry` snap points), captures the operator's
 * click, and hands the resolved click + the chosen material / Ra / allowance /
 * lay to {@link buildSurfaceFinish} to mint an **anchored**
 * `SurfaceFinishSymbol` that is persisted into
 * `drawingSheetSchema.annotations.surfaceFinishes`. On every fresh geometry
 * projection it re-runs {@link reanchorSurfaceFinishes} to refresh each symbol's
 * resolved position and badge any symbol whose anchor link has gone missing.
 *
 * ## Why a separate module (mirrors `drawing-gdt-model.ts`)
 *
 *  * The renderer's test environment is `node` (no jsdom, no
 *    `@testing-library/react`), so the interactive click→persist→re-resolve
 *    logic cannot be exercised through a rendered component. Extracting the
 *    build + the SVG emitter into pure functions makes the whole surface-finish
 *    contract unit-testable at the model level
 *    (`__tests__/DrawingView.surface-finish.test.tsx`).
 *  * Keeps `DrawingView.tsx` focused on wiring + JSX.
 *
 * ## Rendering: client-side, NOT a sidecar round-trip
 *
 * Unlike GD&T frames (which compose through the `cad.annotateGdt` sidecar
 * handler), the surface-finish symbol is a small, fully-deterministic geometric
 * glyph (the ISO 1302 check-mark with optional bar / circle / Ra text). It is
 * emitted as a self-contained SVG `<g>` overlay by {@link surfaceFinishToSvg}
 * and composited into the projection SVG by the renderer. This keeps the
 * feature entirely within the renderer + schema layer (no new sidecar handler).
 *
 * ## Safety Rule 4 (stored-XSS) — no escaping surface
 *
 * Every field of a {@link SurfaceFinishSymbol} is a NUMBER (`ra`,
 * `machiningAllowanceMm`) or a closed ENUM (`material`, `lay`). There is NO
 * operator free-text on this annotation, so — unlike GD&T datums — nothing here
 * reaches `<text>` markup unescaped. {@link surfaceFinishToSvg} formats the
 * numeric Ra / allowance to a fixed, bounded decimal string and emits only the
 * fixed lay glyph characters, so the emitted SVG can never carry an injection
 * payload. (The renderer still drops the composed SVG in via
 * `dangerouslySetInnerHTML`; this module guarantees the surface-finish layer it
 * contributes is markup-safe by construction.)
 *
 * Safety Rule 1: documentation overlays only. Nothing here is read by CAM /
 * G-code / post-processing. Safety Rule 3: no `any`.
 */

import type {
  DrawingDimensionAnchor,
  SurfaceFinishLay,
  SurfaceFinishMaterial,
  SurfaceFinishSymbol,
} from '../../shared/drawing-annotation-schema'
import {
  anchorFromClick,
  buildSnapIndex,
  FREE_ANCHOR_REF_ID,
  resolveAnchor,
  type FreshSnapPoint,
  type ResolvedClick,
} from './drawing-annotation-model'

// ---------------------------------------------------------------------------
// Stable id minting
// ---------------------------------------------------------------------------

/**
 * Monotonic-ish unique id for a freshly placed surface-finish symbol. Combines
 * a kind prefix, a base-36 timestamp, and a per-call counter so two symbols
 * placed in the same millisecond never collide. Opaque to the rest of the
 * system — only equality matters. (Mirrors {@link makeGdtFrameId}.)
 */
let surfaceFinishIdCounter = 0
export function makeSurfaceFinishId(): string {
  surfaceFinishIdCounter += 1
  return `sf:${Date.now().toString(36)}:${surfaceFinishIdCounter.toString(36)}`
}

// ---------------------------------------------------------------------------
// Anchored-symbol builder (one-click placement → SurfaceFinishSymbol)
// ---------------------------------------------------------------------------

/**
 * Options carried alongside the placement click when minting a surface-finish
 * symbol. All optional except `material` (the basic glyph variant); a bare
 * symbol with only a material disposition is valid ISO 1302.
 */
export interface SurfaceFinishOptions {
  /** Basic glyph variant: any / material-removal-required / removal-prohibited. */
  readonly material: SurfaceFinishMaterial
  /** Primary roughness value Ra (µm). Omitted / non-finite → no Ra text. */
  readonly ra?: number
  /** Machining-allowance value (mm). Omitted / non-finite → not drawn. */
  readonly machiningAllowanceMm?: number
  /** Lay-direction symbol. Omitted → no lay glyph. */
  readonly lay?: SurfaceFinishLay
}

/**
 * Coerce a possibly-undefined numeric option to a finite, non-negative value or
 * `undefined`. Drops `NaN` / `Infinity` / negatives so the persisted symbol
 * always parses against the schema (`finite().nonnegative().optional()`).
 */
function cleanNonNegative(value: number | undefined): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isFinite(value) || value < 0) return undefined
  return value
}

/**
 * Build an anchored {@link SurfaceFinishSymbol} from a single resolved
 * placement click and the operator-chosen material / Ra / allowance / lay.
 *
 * Like the GD&T builder, the click resolves to either a snapped feature (its
 * `sourceId` becomes the anchor `refId`, the live associative link) or a free
 * cursor point (empty `refId` sentinel — associative-inert, never dangling).
 * `placement` defaults to the resolved click coordinate so the symbol renders
 * where the operator clicked; the caller may nudge it later. Pure.
 */
export function buildSurfaceFinish(
  click: ResolvedClick,
  options: SurfaceFinishOptions,
): SurfaceFinishSymbol {
  const anchor = anchorFromClick(click)
  const ra = cleanNonNegative(options.ra)
  const allowance = cleanNonNegative(options.machiningAllowanceMm)
  const symbol: SurfaceFinishSymbol = {
    id: makeSurfaceFinishId(),
    material: options.material,
    ...(ra !== undefined ? { ra } : {}),
    ...(allowance !== undefined ? { machiningAllowanceMm: allowance } : {}),
    ...(options.lay !== undefined ? { lay: options.lay } : {}),
    anchor,
    placement: { x: anchor.cachedPoint.x, y: anchor.cachedPoint.y },
  }
  return symbol
}

// ---------------------------------------------------------------------------
// Re-anchor-on-reload resolver (mirrors reanchorGdtFrame / reanchorGdtFrames)
// ---------------------------------------------------------------------------

/**
 * A surface-finish symbol re-resolved against fresh geometry, paired with
 * whether its associative anchor lost its link.
 */
export interface ReanchoredSurfaceFinish {
  /** The symbol with its resolved anchor `cachedPoint` (and `placement`) refreshed. */
  readonly symbol: SurfaceFinishSymbol
  /**
   * `true` when the symbol's associative anchor `refId` no longer resolves
   * against the fresh geometry. The renderer badges these `dangling` (drawn from
   * the stale `cachedPoint` fallback) so the operator can re-attach them. A free
   * anchor never dangles.
   */
  readonly dangling: boolean
}

/**
 * Re-resolve one persisted symbol's anchor against the fresh snap index,
 * refreshing the resolved `cachedPoint` (and the symbol `placement`, which
 * tracks the anchor) and flagging the symbol `dangling` when the associative
 * anchor lost its link. Free anchors never dangle. Pure — returns a new symbol;
 * the input is never mutated.
 */
export function reanchorSurfaceFinish(
  symbol: SurfaceFinishSymbol,
  index: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
): ReanchoredSurfaceFinish {
  const { anchor, status } = resolveAnchor(symbol.anchor, index)
  if (status === 'resolved') {
    return {
      symbol: {
        ...symbol,
        anchor,
        // Keep the symbol pinned to its (refreshed) anchor.
        placement: { x: anchor.cachedPoint.x, y: anchor.cachedPoint.y },
      },
      dangling: false,
    }
  }
  // free / dangling: keep the anchor + placement as-is (graceful fallback).
  return { symbol: { ...symbol, anchor }, dangling: status === 'dangling' }
}

/**
 * Re-resolve a whole list of persisted symbols against a fresh snap-point list
 * (typically the `snapPoints` from a fresh `cad.extract_drawing_geometry` call).
 * Returns the refreshed symbols plus a parallel set of the ids that are now
 * `dangling`. Pure. The single entry point `DrawingView` calls on every geometry
 * refresh.
 */
export function reanchorSurfaceFinishes(
  symbols: readonly SurfaceFinishSymbol[],
  snapPoints: readonly FreshSnapPoint[],
): { symbols: SurfaceFinishSymbol[]; danglingIds: ReadonlySet<string> } {
  const index = buildSnapIndex(snapPoints)
  const out: SurfaceFinishSymbol[] = []
  const danglingIds = new Set<string>()
  for (const symbol of symbols) {
    const { symbol: next, dangling } = reanchorSurfaceFinish(symbol, index)
    out.push(next)
    if (dangling) danglingIds.add(next.id)
  }
  return { symbols: out, danglingIds }
}

/** Re-export the free-anchor sentinel for callers that classify symbol anchors. */
export { FREE_ANCHOR_REF_ID }

/** Test whether a symbol's anchor is a live associative link. Pure. */
export function isAssociativeSurfaceFinish(symbol: SurfaceFinishSymbol): boolean {
  return symbol.anchor.refId !== FREE_ANCHOR_REF_ID
}

// ---------------------------------------------------------------------------
// SVG emitter (client-side glyph composition — ISO 1302 / ASME Y14.36)
// ---------------------------------------------------------------------------

/**
 * The single lay-direction glyph character per {@link SurfaceFinishLay} id
 * (ISO 1302). Fixed strings — never operator input — so they are markup-safe.
 */
export const SURFACE_FINISH_LAY_GLYPH: Record<SurfaceFinishLay, string> = {
  parallel: '=',
  perpendicular: '⟂', // ⟂ PERPENDICULAR
  crossed: 'X',
  multidirectional: 'M',
  circular: 'C',
  radial: 'R',
  particulate: 'P',
}

/** Human label per lay id, for the toolbar dropdown. */
export const SURFACE_FINISH_LAY_LABELS: Record<SurfaceFinishLay, string> = {
  parallel: 'Parallel (=)',
  perpendicular: 'Perpendicular',
  crossed: 'Crossed (X)',
  multidirectional: 'Multi (M)',
  circular: 'Circular (C)',
  radial: 'Radial (R)',
  particulate: 'Particulate (P)',
}

/**
 * Format a numeric Ra / allowance value to a bounded, locale-independent decimal
 * string. Trims trailing zeros (`1.60` → `1.6`, `3.00` → `3`) and caps the
 * fraction at 3 places so a runaway float can't blow out the `<text>` node.
 * Pure; markup-safe (digits + at most one dot + an optional leading minus —
 * though callers only pass non-negative values).
 */
export function formatSurfaceFinishValue(value: number): string {
  if (!Number.isFinite(value)) return '0'
  const fixed = value.toFixed(3)
  // Strip trailing zeros and a dangling decimal point.
  return fixed.replace(/\.?0+$/, '')
}

/**
 * Emit the ISO 1302 / ASME Y14.36 surface-finish symbol as a self-contained SVG
 * `<g>` fragment positioned at `symbol.placement`. The glyph is the classic
 * check-mark (a short leg + a long leg meeting at the vee), with:
 *
 *  * `material: 'required'`   → a horizontal bar across the top of the long leg
 *    (closed-triangle variant: material removal required).
 *  * `material: 'prohibited'` → a small circle in the vee (removal prohibited).
 *  * `material: 'any'`        → the bare check-mark.
 *  * `ra`                     → the Ra value drawn above the long leg.
 *  * `machiningAllowanceMm`   → drawn to the LEFT of the symbol.
 *  * `lay`                    → the lay glyph drawn to the RIGHT of the long leg.
 *
 * The fragment carries `data-sf-id` (the symbol id) and, when `dangling`, the
 * `surface-finish--dangling` class + `data-sf-dangling="true"` so the renderer /
 * tests can find and style orphaned symbols (the GD&T dangling-badge analogue).
 *
 * Coordinates are SVG-mm sheet space (the same frame the projection + dimension
 * layers use). Pure: same input → byte-identical output (no clock / random).
 */
export function surfaceFinishToSvg(
  symbol: SurfaceFinishSymbol,
  options?: { readonly dangling?: boolean },
): string {
  const { x, y } = symbol.placement
  const dangling = options?.dangling === true
  // Glyph metrics (SVG-mm). The vee sits at (x, y); the short leg goes up-left,
  // the long leg up-right ~2× as tall, at the ISO ~60° rake.
  const shortDX = -3.5
  const shortDY = -6
  const longDX = 7
  const longDY = -12
  const veeX = x
  const veeY = y
  const shortX = x + shortDX
  const shortY = y + shortDY
  const longX = x + longDX
  const longY = y + longDY

  const strokeAttrs =
    'fill="none" stroke="currentColor" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round"'
  const parts: string[] = []

  // The two legs of the check-mark (short leg → vee → long leg).
  parts.push(
    `<polyline ${strokeAttrs} points="${num(shortX)},${num(shortY)} ${num(veeX)},${num(veeY)} ${num(longX)},${num(longY)}" />`,
  )

  if (symbol.material === 'required') {
    // Horizontal bar across the top of the long leg (closed-triangle variant).
    const barX2 = longX + 9
    parts.push(
      `<line ${strokeAttrs} x1="${num(longX)}" y1="${num(longY)}" x2="${num(barX2)}" y2="${num(longY)}" />`,
    )
  } else if (symbol.material === 'prohibited') {
    // Small circle seated in the vee (removal prohibited).
    const cx = veeX + (shortDX + longDX) / 4
    const cy = veeY + (shortDY + longDY) / 4
    parts.push(`<circle ${strokeAttrs} cx="${num(cx)}" cy="${num(cy)}" r="1.6" />`)
  }

  const textCommon =
    'fill="currentColor" stroke="none" font-size="3.2" font-family="sans-serif"'

  // Ra value: above the long leg (left-anchored at the leg top).
  if (symbol.ra !== undefined) {
    const raText = formatSurfaceFinishValue(symbol.ra)
    parts.push(
      `<text ${textCommon} text-anchor="start" x="${num(longX + 1)}" y="${num(longY - 1.5)}">Ra ${raText}</text>`,
    )
  }

  // Machining allowance: to the LEFT of the symbol.
  if (symbol.machiningAllowanceMm !== undefined) {
    const allowText = formatSurfaceFinishValue(symbol.machiningAllowanceMm)
    parts.push(
      `<text ${textCommon} text-anchor="end" x="${num(shortX - 1)}" y="${num(shortY)}">${allowText}</text>`,
    )
  }

  // Lay symbol: to the RIGHT of the long leg.
  if (symbol.lay !== undefined) {
    const layGlyph = SURFACE_FINISH_LAY_GLYPH[symbol.lay]
    parts.push(
      `<text ${textCommon} text-anchor="start" x="${num(longX + 11)}" y="${num(veeY - 1)}">${layGlyph}</text>`,
    )
  }

  const cls = dangling ? 'surface-finish surface-finish--dangling' : 'surface-finish'
  const danglingAttr = dangling ? ' data-sf-dangling="true"' : ''
  return `<g class="${cls}" data-sf-id="${symbol.id}"${danglingAttr}>${parts.join('')}</g>`
}

/**
 * Compose every surface-finish symbol into one `<g class="surface-finish-layer">`
 * fragment (render order preserved), badging any symbol whose id is in
 * `danglingIds`. Returns the empty string when there are no symbols so the
 * caller can skip composition entirely. Pure.
 */
export function surfaceFinishLayerSvg(
  symbols: readonly SurfaceFinishSymbol[],
  danglingIds?: ReadonlySet<string>,
): string {
  if (symbols.length === 0) return ''
  const inner = symbols
    .map((s) => surfaceFinishToSvg(s, { dangling: danglingIds?.has(s.id) === true }))
    .join('')
  return `<g class="surface-finish-layer" data-testid="design-drawing-surface-finish-layer">${inner}</g>`
}

/**
 * Splice a surface-finish `<g>` layer into an existing projection SVG, just
 * before the closing `</svg>` so it paints on top of the linework + dimension +
 * GD&T layers. When the SVG has no `</svg>` close tag (defensive) the layer is
 * appended. When there are no symbols the input SVG is returned unchanged. Pure.
 */
export function composeSurfaceFinishIntoSvg(
  svg: string,
  symbols: readonly SurfaceFinishSymbol[],
  danglingIds?: ReadonlySet<string>,
): string {
  const layer = surfaceFinishLayerSvg(symbols, danglingIds)
  if (layer === '') return svg
  const closeIdx = svg.lastIndexOf('</svg>')
  if (closeIdx === -1) return svg + layer
  return svg.slice(0, closeIdx) + layer + svg.slice(closeIdx)
}

/** Narrow re-export so callers don't need to import the dimension module too. */
export type { DrawingDimensionAnchor }

/**
 * Format a finite number for SVG markup with bounded precision (3 dp, trailing
 * zeros trimmed). Internal coordinate formatter; `NaN`/`Infinity` collapse to
 * `0` so the emitted geometry is always valid. Markup-safe (digits/dot/minus).
 */
function num(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return Number(value.toFixed(3)).toString()
}
