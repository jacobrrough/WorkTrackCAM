# Plan — V2: real 3D toolpath playback in the viewport

> **Stack:** E (V2-era) · **Status:** 🔮 V2-era · **Effort:** **S foundation** / L full vision
> **Machines:** Laguna Swift 5x10 (3-axis), Makera Carvera (3-axis + 4th-axis A)
> **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only

> ⚠️ **Key finding: this is mostly already built.** A complete React-Three-Fiber playback panel
> (`ManufactureCamSimulationPanel.tsx`, 1486 lines) already exists and is wired to the legacy
> `panelTab === 'simulate'` sub-tab. The workflow `simulate` **stage** just doesn't render it yet — it shows
> `ToolpathSimulationBody` (a text-stats readout). The foundation slice is ~10–30 lines of JSX.

---

## 1. Current state

Two distinct "simulate" surfaces:

1. **Workflow stage** `workflowStage === 'simulate'` → `simulateStageBody` (`ManufactureWorkspace.tsx:1829–1831`)
   renders only `<ToolpathSimulationBody camOut={camOut} />`. `ToolpathSimulationBody` (`:394–514`) shows an
   `EmptyState` or a `<dl>` of `parseToolpathStats` text. **No 3D canvas.**
2. **Legacy sub-tab** `panelTab === 'simulate'` (`ManufactureSubTabStrip.tsx:12`) → renders the full
   `ManufactureCamSimulationPanel` (`ManufactureWorkspace.tsx:1750–1778`) with a complete R3F canvas, scrubber,
   play/pause, progressive reveal, tool head, material removal, and 4-axis support.

**Already implemented in `ManufactureCamSimulationPanel.tsx`:**
- `extractToolpathSegmentsFromGcode` (3-axis, `cam-gcode-toolpath.ts:96`) + `extractToolpathSegments4AxisFromGcode`
  (4-axis, `:163`) + `apply4AxisCylindricalTransform` (`:215`) + `buildToolpathLengthSampler` (`:369`).
- `PlaybackToolHead` (endmill model w/ quaternion orientation), `ProgressiveToolpathLines`/`…Tubes` (rapid
  amber `#fbbf24` / feed cyan `#22d3ee`, progressive reveal), `playbackU` + RAF loop + `performance.now()`
  timing, `SPEED_PRESETS` (`:604`), 4-axis `toolRotation` quaternion (`:1091–1126`), cylindrical + 2.5D
  height-field material removal, machine-envelope wireframe, stock outlines, part STL overlay.

**The gap:** `simulateStageBody` doesn't render the panel; `projectDir`, `mfg`, `tools`, `machine`,
`stockSetupIndex`, `previewMeshRelativePath`, `previewOperation` are all in scope but not threaded in.

Reusables for the full vision: `rotary-collision.ts:120` `checkRotaryFixtureCollision` (collision overlay);
`buildContiguousPathChains` (tube merging). Perf guards already present: `MAX_TOOLPATH_SEGS = 200_000`,
`TUBE_MAX_SEGMENTS = 10_000`, `TUBE_MAX_CHAINS = 900`, throttled height-field rebuilds.

## 2. Goal (definition of done)

**Foundation (S):** the workflow `simulate` stage renders the interactive 3D panel (path, color-coded
rapid/feed, scrubber + play/pause, animated tool head, speed select), 4-axis cylindrical transform for Carvera,
stock outlines for both. **Full vision (L):** feed-rate heat-map coloring; material-removal preview surfaced;
collision overlay (red) from `checkRotaryFixtureCollision`; true 4-axis stock rotation during playback;
op-tree sync (clicking an op jumps the scrubber).

## 3. Approach

**Recommended — wire the existing panel into `simulateStageBody`.** Replace the one-liner at
`ManufactureWorkspace.tsx:1829–1831` with the same `ManufactureCamSimulationPanel` block already used at
`:1750–1778`, threaded with the in-scope props, keeping `ToolpathSimulationBody` as a stats header / empty-state.
The two stages never co-render (the `stageBody` switch at `:1856–1876` picks one), so **no double-mount**.

- **Alt A — duplicate the canvas inside `ToolpathSimulationBody`:** rejected (two diverging code paths).
- **Alt B — hoist `playbackU` to the workspace:** defer to the op-tree-sync full-vision item.
- **Alt C — separate stripped `CncSimulateStagePanel`:** unnecessary; the panel's `layout="workspace"` mode fits.

**Perf for large Laguna sheets:** existing guards cover it; for > ~200K segments add
`decimateToolpathSegments(segs, tol)` (Ramer–Douglas–Peucker per same-kind chain, default 0.05 mm, preserve
kind-change boundaries) used only for `BufferGeometry`, keeping the raw array for the length sampler.

## 4. Touchpoints

**Modify**
- `src/renderer/manufacture/ManufactureWorkspace.tsx` *(1904 lines → Python-via-bash)* — replace
  `simulateStageBody` (`:1829–1831`) to render `ToolpathSimulationBody` (stats) **and**
  `ManufactureCamSimulationPanel` (3D, `layout="workspace"`, props per `:1762–1777`). Move the
  `data-testid="workflow-stage-body-simulate"` to the new outer wrapper; give the stats `<section>`
  `data-testid="workflow-stage-simulate-stats"` (one line in `ToolpathSimulationBody`, `:401`).
- `src/renderer/manufacture/ManufactureWorkspace.stage-content.test.tsx` — add simulate-stage tests.
- `src/renderer/manufacture/ManufactureCamSimulationPanel.tsx` *(1486 lines → Python-via-bash)* — **no change
  for foundation**; full vision adds `feedRateColorMode` + `collisionSegmentIndices` props.

**Create**
- `src/shared/cnc-simulate-playback.ts` (~100 lines) — Zod view-model + builder:
  ```ts
  export const cncSimulatePlaybackModelSchema = z.object({
    axisMode: z.enum(['3axis', '4axis']),
    segmentCount: z.number().int().nonnegative(),
    totalLengthMm: z.number().nonnegative(),
    feedRateRangeMmMin: z.object({ min: z.number(), max: z.number() }).nullable(),
    collisionSegmentIndices: z.array(z.number().int()).readonly(),
  })
  export type CncSimulatePlaybackModel = z.infer<typeof cncSimulatePlaybackModelSchema>
  export function buildCncSimulatePlaybackModel(gcode: string, axisMode: '3axis' | '4axis'): CncSimulatePlaybackModel
  ```
  Delegates to the existing extractors; a cheap pass (no geometry returned). Session-only; **no** persistence.
- `src/shared/cnc-simulate-playback.test.ts` + `cnc-simulate-playback-pin.test.ts`.

**No change:** `gcode-toolpath-stats.ts`, the existing G-code parsers (reused verbatim).

## 5. Risks & mitigations

- **Double-mount:** none — the `stageBody` switch renders exactly one stage; the sub-tab path isn't rendered
  when `workflowStage === 'simulate'`.
- **Large G-code perf:** existing caps + optional RDP decimation for `BufferGeometry` only (sampler keeps raw).
- **4-axis transforms:** `apply4AxisCylindricalTransform` already arc-subdivides `|ΔA|>5°`; full-vision stock
  rotation reads the current segment's `a1` and rotates the cylinder outline.
- **`performance.now()`/RAF in tests:** loop runs only while playing; render-pin tests use `renderToStaticMarkup`
  (no `useEffect`); new utilities take an injected `getNow` defaulting to `performance.now`.
- **G-code safety:** reuses battle-tested parsers (`cam-gcode-toolpath-pin.test.ts`); never re-emits G-code.
- **File size:** both target files > 800 lines → Python-via-bash; the edits are < 30 lines each.

## 6. Test strategy

- `cnc-simulate-playback.test.ts`: empty → zeros/null/[]; Laguna fixture (no A) → `axisMode:'3axis'`; Carvera
  (A-words) → `'4axis'`; feed range from `F300`/`F1200` → `{min:300,max:1200}`; G2/G3 arcs counted, no crash.
- `cnc-simulate-playback-pin.test.ts`: only `buildCncSimulatePlaybackModel` exported; no `any`; imports only
  `zod` + the two extractors.
- `ManufactureWorkspace.stage-content.test.tsx`: stats `<section>` testid present with G-code; empty-state testid
  when `camOut===''`; (jsdom + mocked R3F/three) panel present in the stage body.
- Extend `cam-gcode-toolpath.test.ts` if `decimateToolpathSegments` is added (collinear → 2 endpoints;
  kind-change boundary preserved).
- Fixtures: existing `CARVERA_GCODE`; add a Laguna 3-axis fixture (G0 rapids + G1 cuts, no A); a Carvera 4-axis fixture.

## 7. Sequencing

1. **Foundation (S, ~2–4 h):** shared playback module + tests; wire the panel into `simulateStageBody`;
   stage-content tests; run existing panel/parser/collision tests; gcode-safety gate.
2. Playback-speed `<select>` from exported `SPEED_PRESETS`.
3. Feed-rate heat-map coloring (`feedRateColorMode` + F-word parsing variant).
4. Collision overlay (`collisionSegmentIndices` + red `BufferGeometry`; profile gains `chuckOuterRadiusMm`/`chuckDepthMm`).
5. Op-tree sync (op→segment ranges from `; --- Operation: <id> ---` markers; jump scrubber on `selectedOpIndex`).

## Effort & open questions

**Effort: S** foundation (panel exists; 10–30 lines JSX + ~200 lines shared module/tests, 1–3 h).
**L** full vision (~1,000 lines across coloring/collision/op-sync/stock-rotation + schema additions).

1. Keep the stats readout as a header, or replace it entirely with the panel? (Plan keeps both; stats also
   serve the no-project empty state.)
2. Hide the legacy `simulate` sub-tab when on the `simulate` workflow stage? (Recommend leaving both.)
3. Laguna RichAuto post uses standard `G0`/`G1` (parser is dialect-agnostic) — confirm post template path.
4. `performance.now()` is fine in the Electron renderer; the `Date.now()` restriction is for deterministic contexts.
5. Move the `data-testid` to the new wrapper to avoid breaking existing stage tests.
