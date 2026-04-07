/**
 * Lightweight parse of common Cura-style FDM G-code layer comments (preview / QA only).
 */

export type FdmGcodeLayerSummary = {
  /** Highest `;LAYER:n` index seen + 1 (Cura uses 0-based layer indices). */
  inferredLayerCount: number | null
  /** From `;LAYER_COUNT:` when present. */
  declaredLayerCount: number | null
  linesScanned: number
}

/**
 * Scans the first {@link maxLines} lines for Cura-style `;LAYER:` and `;LAYER_COUNT:` headers.
 */
export function summarizeFdmGcodeLayers(gcode: string, maxLines = 25000): FdmGcodeLayerSummary {
  if (!gcode.trim()) {
    return { inferredLayerCount: null, declaredLayerCount: null, linesScanned: 0 }
  }
  const lines = gcode.split(/\r?\n/)
  const lim = Math.min(lines.length, maxLines)
  let maxLayer = -1
  let declared: number | null = null
  for (let i = 0; i < lim; i++) {
    const t = lines[i]!.trim()
    const lm = /^;LAYER:(-?\d+)/i.exec(t)
    if (lm) {
      const n = Number.parseInt(lm[1]!, 10)
      if (Number.isFinite(n)) maxLayer = Math.max(maxLayer, n)
    }
    const dc = /^;LAYER_COUNT:\s*(\d+)/i.exec(t)
    if (dc) {
      const n = Number.parseInt(dc[1]!, 10)
      if (Number.isFinite(n) && n >= 0) declared = n
    }
  }
  const inferredLayerCount = maxLayer >= 0 ? maxLayer + 1 : null
  return { inferredLayerCount, declaredLayerCount: declared, linesScanned: lim }
}

/** One-line text for Utilities → Slice (empty when there is nothing useful to show). */
export function formatFdmLayerSummaryHuman(s: FdmGcodeLayerSummary): string {
  const bits: string[] = []
  if (s.declaredLayerCount != null) {
    bits.push(`declared ${s.declaredLayerCount} (;LAYER_COUNT)`)
  }
  if (s.inferredLayerCount != null) {
    bits.push(`inferred ${s.inferredLayerCount} (from ;LAYER comments)`)
  }
  if (bits.length > 0) {
    return `Layer summary: ${bits.join('; ')} (scanned ${s.linesScanned} lines).`
  }
  if (s.linesScanned > 0) {
    return `Layer summary: no Cura-style ;LAYER / ;LAYER_COUNT headers in the first ${s.linesScanned} lines.`
  }
  return ''
}
