/**
 * Wave 3f · Bundled-font read contract.
 *
 * The Text → machinable-vectors engine ({@link ./text-to-vectors}) needs the
 * bytes of an OFL/Apache font to flatten glyph outlines. The font ships inside
 * the app under `resources/fonts/` (see `resources/fonts/README.md`) and the
 * renderer cannot read the filesystem directly, so the main process exposes a
 * tiny read-only IPC (`font:read`) that streams the bundled font as base64. This
 * mirrors the existing `wizard:readCadSample` resource-read channel exactly:
 * read-only, never touches a project directory or any G-code path.
 *
 * Only the ONE bundled face is reachable — the request carries a font id from
 * {@link BUNDLED_FONT_IDS} so the handler can never be coerced into reading an
 * arbitrary path (no path traversal: the id maps to a fixed filename).
 */

/** The single bundled font id this wave ships (Roboto Regular, Apache-2.0). */
export const BUNDLED_FONT_IDS = ['roboto-regular'] as const

export type BundledFontId = (typeof BUNDLED_FONT_IDS)[number]

/** Default font id the Text dialog selects when it opens. */
export const DEFAULT_BUNDLED_FONT_ID: BundledFontId = 'roboto-regular'

/** id → on-disk filename under `resources/fonts/` (fixed map; no traversal). */
export const BUNDLED_FONT_FILE: Readonly<Record<BundledFontId, string>> = {
  'roboto-regular': 'Roboto-Regular.ttf'
}

/** id → human-readable family/style label for the dialog's font picker. */
export const BUNDLED_FONT_LABEL: Readonly<Record<BundledFontId, string>> = {
  'roboto-regular': 'Roboto Regular'
}

/** Request payload for the `font:read` IPC. */
export interface ReadBundledFontRequest {
  /** Which bundled face to read. Must be a {@link BundledFontId}. */
  readonly fontId: BundledFontId
}

/** Result of the `font:read` IPC. */
export type ReadBundledFontResult =
  | {
      ok: true
      /** The font id that was read back (echoed for the caller's cache key). */
      fontId: BundledFontId
      /** Base64-encoded raw font bytes (decode → ArrayBuffer → opentype.parse). */
      base64: string
    }
  | { ok: false; error: string }

/** Narrow an unknown value to a valid {@link BundledFontId}. */
export function isBundledFontId(value: unknown): value is BundledFontId {
  return typeof value === 'string' && (BUNDLED_FONT_IDS as readonly string[]).includes(value)
}
