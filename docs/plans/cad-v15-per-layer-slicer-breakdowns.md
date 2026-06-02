# Plan — CAD V1.5: true per-layer slicer breakdowns

> **Stack:** B (CAD V1.5 polish) · **Status:** ✅ Ready · **Effort:** M
> **Machines:** Creality K2 Plus (FDM) · **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only

Replace the current coarse/aggregate slice summary (total time/filament spread uniformly across layers)
with **real per-layer stats** parsed from the sliced G-code: per-layer time, filament length/volume, and —
where available — line-type breakdown. Parse on the main process via streaming, return a compact typed
result over IPC, and surface it in the FDM Preview stage.

---

## 1. Current state

- **OrcaSlicer K2 output** carries: `;BEFORE_LAYER_CHANGE` + bare-`;{layer_z}` on every layer
  (`resources/orca-slicer/profiles/machines/creality-k2-plus.json:152`), plus header totals
  (`; estimated printing time …`, `; total filament used [mm] …`, `… [g] …`). There is **no**
  `;TYPE:` line-type annotation by default (`gcode_label_objects: "0"` in `standard.json:111`) and
  **no** JSON stats sidecar from the 2.3.x CLI.
- **Current parser** `src/renderer/manufacture/gcode-layer-parser.ts` distributes total time/filament
  **uniformly** across layers. `LayerInfo` (`:58–67`) = `{ index, zMm, estTimeSec, estFilamentMm }` — the
  "coarse" problem.
- **IPC flow:** `ManufactureWorkspace.runFdmSliceFromOp` (`:812`) → `fab.sliceOrca` → `slice:orca`
  (`src/main/ipc-fabrication.ts:307`) → `runOrcaSlice` (`src/main/slicer/orca-wrapper.ts:189`). On success
  the workspace sets `lastSliceGcodePath` (`:840`); an effect (`:726–750`) reads the whole file via
  `fab.readTextFile` → `file:readText` (`src/main/ipc-core.ts:121`, full `readFile(p,'utf-8')`) and passes
  `gcodeText` to `LayerPreviewBody` (`:237`).
- **Memory note:** a tall 0.2 mm K2 print is 1,500+ layers / 5–30 MB of G-code; loading the full text into
  the renderer is the current pattern. Fine for most jobs, wasteful for large ones.

## 2. Goal (definition of done)

1. FDM Preview shows **actual** per-layer stats: index + Z (done), per-layer time, per-layer filament,
   and an **optional** line-type breakdown (outer/inner wall, infill, support, skirt/brim) when present.
2. A **streaming** main-process parser scans the file line-by-line (no multi-MB text into the renderer)
   and returns a compact typed `FdmLayerBreakdownResult`.
3. A new Zod schema in `src/shared/` covers the result — **session-only**, NOT persisted, so **no**
   `project-schema.ts` change and **no** migration.
4. K2 process profiles enable per-layer comments if the Orca build supports it (see open question).
5. All new code ships with Vitest tests; UI uses `EmptyState` for the no-data branch.

## 3. Approach

**Recommended — streaming main-process parser + dedicated IPC channel.** The renderer never needs raw
G-code for the Preview scrubber; it only needs the per-layer array. Parse with `node:readline` +
`createReadStream`, accumulate per layer, and return `FdmLayerBreakdown[]` (typically 100–2000 entries,
~200 KB JSON — trivial over IPC).

- **Alt A — keep the renderer-side parser**, just extend `gcode-layer-parser.ts` to read `;LAYER_TIME:` /
  `;TYPE:`. Smaller diff, but loads multi-MB strings into V8. Acceptable MVP fallback.
- **Alt B — Orca stats sidecar:** no documented per-layer JSON in 2.3.x CLI. Rejected.

The parser **always falls back** to uniform distribution from header totals when per-layer comments are
absent — graceful degradation to today's behavior, never worse.

## 4. Touchpoints

**Create**
- `src/shared/fdm-gcode-layer-breakdown.ts` — `FdmLineType` union + `fdmLineTypeSchema`;
  `FdmLayerBreakdown` (`{ index, zMm, estTimeSec|null, estFilamentMm|null, lineTypeCounts|null, maxSpeedMmMin|null }`);
  `FdmLayerBreakdownResult` (`{ layers, totalTimeSec|null, totalFilamentMm|null, layerCount }`) + schemas.
  No persistence, no migration.
- `src/main/slicer/fdm-gcode-stream-parser.ts` — `parseFdmGcodeLayersFromFile(path): Promise<FdmLayerBreakdownResult>`;
  streams via readline; parses `;BEFORE_LAYER_CHANGE`+`;{z}`, `;LAYER_TIME:`, `;LAYER_FILAMENT:`, `;TYPE:`,
  and the header totals; uniform-distribution fallback; pure/testable.

**Modify**
- `resources/orca-slicer/profiles/process/standard.json` + `high_speed.json` — add `"gcode_comments": "1"`
  (pending confirmation it emits per-layer comments in the Orca/K2 fork — see open Q1).
- `src/main/ipc-fabrication.ts` — register `ipcMain.handle('slice:layerBreakdown', …)` inside
  `registerFabricationIpc` (next to `slice:orca`); null-byte guard; returns the result or `{ok:false,error}`.
- `src/preload/index.ts` — add `sliceLayerBreakdown` to the `Api` type + `ipcRenderer.invoke` bridge.
- `src/renderer/src/shop-types.ts` — add `sliceLayerBreakdown` to `window.fab`.
- `src/renderer/manufacture/ManufactureWorkspace.tsx` — replace the `sliceGcodeText` read effect (`:726–750`)
  with a `fab.sliceLayerBreakdown(lastSliceGcodePath)` call; swap `LayerPreviewBody`'s `gcodeText` prop for
  `layerBreakdown: FdmLayerBreakdownResult|null`; add a per-layer table + (conditional) line-type row.
  *(File > 800 lines → Python-via-bash edit.)*
- `src/main/slice-orca-ipc-pin.test.ts` — add a section pinning the new handler (registered, calls parser,
  rejects null-byte paths, returns result shape).
- `src/renderer/manufacture/ManufactureWorkspace.stage-content.test.tsx` — swap the `ORCA_K2_GCODE` fixture
  for an `FdmLayerBreakdownResult` fixture across the existing 9 cases.

**No change:** `gcode-layer-parser.ts` (kept as fallback reference + its tests), `ProfileStack.tsx`,
`plate-thumbnail.ts`, `src/shared/fdm-gcode-layer-summary.ts` (separate Utilities path).

## 5. Risks & mitigations

- **R1 — `gcode_comments=1` may not emit `;LAYER_TIME:` in Orca's Bambu fork.** Pivotal uncertainty.
  Mitigation: parser always falls back to header-distributed values; UI degrades to current behavior. The
  streaming-parser refactor still ships value even if per-layer time isn't available yet.
- **R2 — `ManufactureWorkspace.tsx` is large + growing.** Accept ~50–80 added lines this cycle; flag a
  future `LayerPreviewBody`/`ToolpathSimulationBody` extraction.
- **R3 — IPC payload size.** ~200 KB for 1,500 layers — negligible.
- **R4 — `LayerPreviewBody` prop break.** Only internal + its test call it; update both together.
- **R5 — `;LAYER_TIME:` attribution.** State machine attributes per-layer comments to the most recently
  opened layer (after the preceding `;BEFORE_LAYER_CHANGE`).
- **R6 — line-type needs `gcode_label_objects`.** `lineTypeCounts` optional/null; UI shows the section only
  when present. Not required for MVP.

## 6. Test strategy

- `src/shared/fdm-gcode-layer-breakdown.test.ts` — schema parse/reject, optional `lineTypeCounts`,
  positive-int `index`, non-negative `zMm`.
- `src/shared/fdm-gcode-layer-breakdown-pin.test.ts` — exported symbols, no `any`, no `fs`/`electron` imports,
  `FdmLineType` union members (mirrors `fdm-gcode-layer-summary-pin.test.ts`).
- `src/main/slicer/fdm-gcode-stream-parser.test.ts` — fixtures: empty file; 3 layers BEFORE-only (uniform
  fallback); header totals populate `estTimeSec`; `;LAYER_TIME:` → real per-layer values; `;TYPE:` →
  `lineTypeCounts`; CRLF tolerance; 1000-layer synthetic completes without spike; bad/null-byte path rejects.
- Update `ManufactureWorkspace.stage-content.test.tsx` (9 cases) + a snapshot of `LayerPreviewBody` with a
  line-type breakdown present.
- Add the `slice:layerBreakdown` section to `slice-orca-ipc-pin.test.ts`.
- Run the **gcode-safety** skill after the profile edits (adding `gcode_comments`) to confirm K2 invariants.

## 7. Sequencing

1. Shared schema + its two test files (no deps).
2. Streaming parser + tests (reference `gcode-layer-parser.ts` for marker forms).
3. IPC handler + preload + shop-types + pin-test section.
4. Profile `gcode_comments` edit; test-slice to confirm the emitted format; tune the `;LAYER_TIME:` regex.
5. Renderer surgery + stage-content test updates.
6. gcode-safety gate.

## Effort & open questions

**Effort: M** (~1 dev-day: schema+parser ~3–4 h, IPC ~1 h, profile ~1 h, renderer ~2 h).

1. **Does Orca 2.3.x `gcode_comments=1` actually emit `;LAYER_TIME:` for the K2/Bambu fork?** Confirm with a
   real slice before hardening the per-layer-time path; else ship the refactor + uniform fallback and treat
   true per-layer time as a follow-up.
2. Show line-type counts now (rendering "—" until a profile enables labeling) vs. defer the UI row?
3. Exact `ManufactureWorkspace.tsx` line count — if it grows past ~1500, extract the stage bodies.
4. The setup-sheet `readTextFile` path (`:1354`) is unaffected — only the `sliceGcodeText` state is replaced.
