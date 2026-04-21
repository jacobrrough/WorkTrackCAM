/**
 * 4-Axis G-Code Emitter
 *
 * Stateful emitter that strategies use instead of building string arrays
 * directly. Centralizing emission ensures every strategy enforces:
 *
 *   - Modal state tracking (X/Y/Z/A/F) so we can reason about deltas
 *   - "Never rotate A at cutting depth" — `rotateA()` requires retract first
 *   - Chuck-face safety: never emit X < 0
 *   - Plunge feed vs cutting feed selection (deeper Z move at > 0.5 mm uses
 *     plunge feed, otherwise the lateral cut feed)
 *   - Pre-emission angular velocity adaptation via `kinematics.ts`
 *
 * Strategies should call only the named methods on `Emitter` — they should
 * NOT push raw G-code lines, because that bypasses the safety net. The
 * `lines()` getter returns the accumulated output.
 */
import {
  adaptFeedForAngularVelocity,
  shortestAngularPath,
  type FeedAdaptResult
} from './kinematics'

export type EmitterOpts = {
  /** Stock outer radius (mm) — used for clearZ derivation. */
  stockRadius: number
  /** User-requested clear Z above stock surface (mm). */
  safeZMm: number
  /** Hard cap on clearZ (machine work area Z, optional). */
  maxZMm?: number
  /** Lateral cutting feed (mm/min). */
  feedMmMin: number
  /** Z plunge feed (mm/min). */
  plungeMmMin: number
  /** Stock diameter (mm) for angular velocity calculations. */
  stockDiameterMm: number
  /** Machine max rotary RPM (≤ 0 disables feed adaptation). */
  maxRotaryRpm?: number
  /** Tool diameter (mm) — used by stepoverClearZ helpers. */
  toolDiameterMm: number
}

/**
 * Stateful G-code emitter. One instance per strategy invocation.
 */
export class Emitter {
  private readonly _lines: string[] = []
  private readonly _warnings: string[] = []

  /** Current modal state (mm / deg). */
  private cx = 0
  private cz = 0
  private ca = 0
  private cf = 0
  private hasPos = false

  readonly stockRadius: number
  readonly safeZMm: number
  readonly clearZ: number
  readonly feedMmMin: number
  readonly plungeMmMin: number
  readonly stockDiameterMm: number
  readonly maxRotaryRpm: number
  readonly toolDiameterMm: number

  constructor(opts: EmitterOpts) {
    this.stockRadius = opts.stockRadius
    this.safeZMm = opts.safeZMm
    const rawClear = opts.stockRadius + opts.safeZMm
    this.clearZ = opts.maxZMm != null ? Math.min(rawClear, opts.maxZMm - 1) : rawClear
    this.feedMmMin = opts.feedMmMin
    this.plungeMmMin = opts.plungeMmMin
    this.stockDiameterMm = opts.stockDiameterMm
    this.maxRotaryRpm = opts.maxRotaryRpm ?? 0
    this.toolDiameterMm = opts.toolDiameterMm
  }

  // ─── Output accessors ────────────────────────────────────────────────────

  lines(): string[] {
    return this._lines.slice()
  }

  warnings(): string[] {
    return this._warnings.slice()
  }

  // ─── Comments ────────────────────────────────────────────────────────────

  comment(text: string): void {
    if (text.length === 0) return
    this._lines.push(text.startsWith(';') ? text : `; ${text}`)
  }

  // ─── Rapid moves (G0) ────────────────────────────────────────────────────

  /** Rapid retract to clearZ (and optionally Y0 for axis recentering). */
  retractToClear(includeY0 = false): void {
    if (includeY0) {
      this._lines.push(`G0 Z${this.clearZ.toFixed(3)} Y0`)
    } else {
      this._lines.push(`G0 Z${this.clearZ.toFixed(3)}`)
    }
    this.cz = this.clearZ
    this.hasPos = true
  }

  /** Rapid Z move to a specific clearance value (e.g. stepover clearance between A moves). */
  rapidZ(z: number): void {
    if (Math.abs(z - this.cz) < 1e-6 && this.hasPos) return
    this._lines.push(`G0 Z${z.toFixed(3)}`)
    this.cz = z
    this.hasPos = true
  }

  /** Rapid X move. Enforces X ≥ 0 (chuck-face safety). */
  rapidX(x: number): void {
    if (x < 0) {
      throw new Error(`emit.rapidX: refusing negative X (${x.toFixed(3)}) — would crash chuck face`)
    }
    if (Math.abs(x - this.cx) < 1e-6 && this.hasPos) return
    this._lines.push(`G0 X${x.toFixed(3)}`)
    this.cx = x
    this.hasPos = true
  }

  /**
   * Rapid A rotation. SAFETY: only allowed when current Z is at or above the
   * caller-supplied safety floor (typically `stepoverClearZ`). Rotating A at
   * cutting depth would sweep the tool through any protruding geometry between
   * the old and new angles.
   */
  rotateA(targetDeg: number, safetyFloorZ: number): void {
    if (this.hasPos && this.cz < safetyFloorZ - 1e-3) {
      throw new Error(
        `emit.rotateA: refusing to rotate A while Z=${this.cz.toFixed(3)} is below stepover clearance ${safetyFloorZ.toFixed(3)} — never rotate at cutting depth`
      )
    }
    if (Math.abs(targetDeg - this.ca) < 1e-6 && this.hasPos) return
    this._lines.push(`G0 A${targetDeg.toFixed(3)}`)
    this.ca = targetDeg
    this.hasPos = true
  }

  // ─── Cutting moves (G1) ──────────────────────────────────────────────────

  /**
   * Plunge from current Z to a deeper Z at the plunge feed rate. Refuses
   * non-deepening moves (use `cutTo` instead).
   */
  plungeZ(z: number): void {
    if (z >= this.cz - 1e-9 && this.hasPos) {
      // Already at or below target — no plunge needed.
      return
    }
    this._lines.push(`G1 Z${z.toFixed(3)} F${this.plungeMmMin.toFixed(0)}`)
    this.cz = z
    this.cf = this.plungeMmMin
    this.hasPos = true
  }

  /**
   * Linear feed move to (x, z). Selects between plunge and cut feed
   * automatically: a deepening Z change > 0.5 mm uses plunge feed; everything
   * else uses the cutting feed. If `aDeg` is provided, also handles the A
   * rotation (with feed adaptation via `kinematics.ts`).
   */
  cutTo(x: number, z: number, aDeg?: number): void {
    if (x < 0) {
      throw new Error(`emit.cutTo: refusing negative X (${x.toFixed(3)}) — chuck-face safety`)
    }
    const dx = x - this.cx
    const dz = z - this.cz
    const dxAbs = Math.abs(dx)
    const dzAbs = Math.abs(dz)

    let feed: number
    let feedSource: 'plunge' | 'cut'
    if (dz < -0.5 + 1e-9 && dzAbs > 0.5) {
      // Deepening by > 0.5 mm — use plunge feed
      feed = this.plungeMmMin
      feedSource = 'plunge'
    } else {
      feed = this.feedMmMin
      feedSource = 'cut'
    }

    let aPart = ''
    if (aDeg != null) {
      const dA = shortestAngularPath(this.ca, aDeg)
      if (Math.abs(dA) > 1e-6) {
        const linearDist = Math.hypot(dx, dz)
        const adapt: FeedAdaptResult = adaptFeedForAngularVelocity({
          requestedFeedMmMin: feed,
          deltaADeg: dA,
          linearDistMm: linearDist,
          stockDiameterMm: this.stockDiameterMm,
          maxRotaryRpm: this.maxRotaryRpm
        })
        if (adapt.throttled) {
          feed = adapt.feedMmMin
          if (adapt.warning) this._warnings.push(adapt.warning)
        }
        // Emit absolute target angle, not delta — controllers track absolute A.
        aPart = ` A${aDeg.toFixed(3)}`
        this.ca = aDeg
      }
    }

    let parts = `G1 X${x.toFixed(3)}`
    if (dzAbs > 0.005) parts += ` Z${z.toFixed(3)}`
    parts += aPart
    if (Math.abs(feed - this.cf) > 1e-9 || feedSource === 'plunge') {
      parts += ` F${feed.toFixed(0)}`
      this.cf = feed
    }

    this._lines.push(parts)
    this.cx = x
    if (dzAbs > 0.005) this.cz = z
    this.hasPos = true
  }

  /**
   * Final return-to-home: retract to clear Z, center Y on rotation axis,
   * return A to 0.
   */
  returnHome(): void {
    this._lines.push(`G0 Z${this.clearZ.toFixed(3)} Y0`)
    this._lines.push('G0 A0 ; return A to home')
    this.cz = this.clearZ
    this.ca = 0
  }

  // ─── State accessors (for tests / strategies that need to know) ──────────

  getX(): number {
    return this.cx
  }
  getZ(): number {
    return this.cz
  }
  getA(): number {
    return this.ca
  }
}
