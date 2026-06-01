/**
 * machine-profile-spindle-pin.test.ts -- regression pin for the
 * spindle-RPM ranges baked into the three bundled machine profiles.
 *
 * Background: in earlier cycles the bundled JSON files shipped with
 * spindle ranges that did NOT match the hardware documented in
 * CLAUDE.md USER CONTEXT:
 *   - Laguna Swift 5x10: 6,000-24,000 RPM (was shipped as 8,000-18,000)
 *   - Makera Carvera 3-axis: 13,000-15,000 RPM (was shipped as
 *     6,000-15,000; the 200 W spindle's real lower bound is 13,000)
 *   - Creality K2 Plus: FDM, no spindle at all -> minSpindleRpm MUST
 *     be absent from the JSON entirely.
 *
 * This pin guards the *raw JSON* (fs.readFile + JSON.parse) rather
 * than the Zod-validated profile, so a future regression that swaps
 * the values back to the old wrong numbers is caught even if someone
 * also relaxes the schema. Schema-level coverage lives in
 * machines-pin.test.ts; this file is intentionally schema-independent.
 *
 * Three-machine impact: DIRECT. The spindle-RPM range gates
 * - the GCODE spindle-RPM validator (src/shared/carvera-zeroing.ts,
 *   validateSpindleRpm) -> Carvera ATC tool changes that try to run
 *   below 13 k will now warn instead of silently passing.
 * - the Laguna RichAuto A-series post-processor's warm-up and
 *   cool-down dwell calculations, which assume the real
 *   6 k-24 k envelope.
 * Bad ranges crash machines or burn motors -- Safety Rule 1 ("G-code
 * is sacred") applies transitively to the machine profiles that drive
 * the posts.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const PROJECT_ROOT = resolve(__dirname, '..', '..')
const MACHINES_DIR = resolve(PROJECT_ROOT, 'resources', 'machines')

const readProfileJson = async (file: string): Promise<Record<string, unknown>> => {
  const text = await readFile(resolve(MACHINES_DIR, file), 'utf-8')
  const parsed: unknown = JSON.parse(text)
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`expected object root in ${file}`)
  }
  return parsed as Record<string, unknown>
}

describe('Machine-profile spindle-RPM range pin (raw JSON)', () => {
  it('Laguna Swift 5x10 pins minSpindleRpm=6000 and maxSpindleRpm=24000 (CLAUDE.md spec)', async () => {
    const profile = await readProfileJson('laguna-swift-5x10.json')
    expect(profile.minSpindleRpm).toBe(6000)
    expect(profile.maxSpindleRpm).toBe(24000)
  })

  it('Makera Carvera 3-axis pins minSpindleRpm=13000 (200 W spindle real lower bound)', async () => {
    const profile = await readProfileJson('makera-carvera-3axis.json')
    expect(profile.minSpindleRpm).toBe(13000)
  })

  it('Creality K2 Plus has NO minSpindleRpm (FDM has no spindle)', async () => {
    const profile = await readProfileJson('creality-k2-plus.json')
    expect(profile.minSpindleRpm).toBeUndefined()
    expect(profile.maxSpindleRpm).toBeUndefined()
  })
})
