/**
 * Ambient type declarations for `clipper-lib` (Angus Johnson's Clipper 6.4.2,
 * Boost Software License — a permissive MIT/BSD-class license per docs/SECURITY.md
 * dependency policy). The package ships as a UMD/CommonJS module
 * (`module.exports = ClipperLib`) with NO bundled `.d.ts`, so this file types
 * exactly the surface `src/shared/sketch-boolean-offset.ts` and the NFP nesting
 * engine `src/main/nesting/true-shape-nfp.ts` consume — nothing more — to keep
 * the offset + boolean + Minkowski/NFP geometry fully typed (no `any`).
 *
 * IMPORT SHAPE (Wave-3f build lesson): because the package is CommonJS with a
 * single `module.exports = <object>`, the value lands on `.default` under both
 * Node's ESM interop and the electron-vite (Rollup) production build. So this
 * module is imported with a **default** import:
 *     `import ClipperLib from 'clipper-lib'`
 * A namespace import (`import * as`) would nest everything under `.default`
 * instead — the OPPOSITE of opentype.js (an ESM, named-only package that needed
 * the namespace import). Verified empirically: a Node `import('clipper-lib')`
 * dynamic import exposes `m.default.Clipper` (function) while top-level
 * `m.Clipper` is `undefined`, and a Vitest (Vite transform) default-import probe
 * runs a live `ClipperOffset.Execute`.
 */
declare module 'clipper-lib' {
  /** Integer point in Clipper's scaled coordinate space. */
  export interface IntPoint {
    X: number
    Y: number
  }

  /** One closed/open path = an ordered list of integer points. */
  export type Path = IntPoint[]
  /** A set of paths (Clipper's `Paths`). */
  export type Paths = Path[]

  /** Boolean clip operation selector. */
  interface ClipTypeEnum {
    ctIntersection: number
    ctUnion: number
    ctDifference: number
    ctXor: number
  }

  /** Subject vs clip role for `AddPath`/`AddPaths`. */
  interface PolyTypeEnum {
    ptSubject: number
    ptClip: number
  }

  /** Fill rule controlling inside/outside determination. */
  interface PolyFillTypeEnum {
    pftEvenOdd: number
    pftNonZero: number
    pftPositive: number
    pftNegative: number
  }

  /** Corner-join style for `ClipperOffset`. */
  interface JoinTypeEnum {
    jtSquare: number
    jtRound: number
    jtMiter: number
  }

  /** Path-end style for `ClipperOffset` (we only use closed-polygon offsets). */
  interface EndTypeEnum {
    etClosedPolygon: number
    etClosedLine: number
    etOpenButt: number
    etOpenSquare: number
    etOpenRound: number
  }

  /**
   * Boolean clipper: add subject/clip paths, then `Execute` a boolean op.
   * The constructor value also carries Clipper's static geometry helpers
   * (`Area`, `MinkowskiSum`) used by the NFP nesting engine.
   */
  interface ClipperCtor {
    new (initOptions?: number): ClipperInstance
    /** Signed area of one path (Clipper int units²); sign encodes winding. */
    Area(path: Path): number
    /**
     * Minkowski sum of `pattern` with each closed path in `paths`, unioned
     * (NonZero) into result `Paths`.
     *
     * NFP correctness note (verified against clipper.js 6.4.2 source): ONLY
     * this `Paths` overload adds the `TranslatePath(paths[i], pattern[0])`
     * fill that closes the spurious interior hole of the swept quad band, so
     * NFP callers MUST pass the fixed polygon wrapped in an array and the
     * NEGATED moving polygon as `pattern` — `NFP(A, B) = MinkowskiSum(-B, [A])`.
     */
    MinkowskiSum(pattern: Path, paths: Paths, pathIsClosed: boolean): Paths
  }

  interface ClipperInstance {
    AddPath(path: Path, polyType: number, closed: boolean): boolean
    AddPaths(paths: Paths, polyType: number, closed: boolean): boolean
    /** Execute into a flat `Paths` solution using subject + clip fill rules. */
    Execute(
      clipType: number,
      solution: Paths,
      subjFillType: number,
      clipFillType: number
    ): boolean
  }

  /** Polygon offsetter (inflate/deflate closed paths by a delta). */
  class ClipperOffset {
    constructor(miterLimit?: number, roundPrecision?: number)
    AddPath(path: Path, joinType: number, endType: number): void
    AddPaths(paths: Paths, joinType: number, endType: number): void
    /** Offset all added paths by `delta` (Clipper integer units) into `solution`. */
    Execute(solution: Paths, delta: number): void
    Clear(): void
  }

  /** Assorted JS helpers (we use `AreaOfPolygon` / `Area` for winding/area). */
  interface ClipperJS {
    /** Signed area of one path (Clipper int units²); sign encodes winding. */
    AreaOfPolygon(path: Path): number
  }

  interface ClipperLibStatic {
    /** Constructor + static helpers (`Area`, `MinkowskiSum`). */
    Clipper: ClipperCtor
    ClipperOffset: typeof ClipperOffset
    ClipType: ClipTypeEnum
    PolyType: PolyTypeEnum
    PolyFillType: PolyFillTypeEnum
    JoinType: JoinTypeEnum
    EndType: EndTypeEnum
    JS: ClipperJS
  }

  const ClipperLib: ClipperLibStatic
  export default ClipperLib
}
