# WorkTrackCAM — Implementation Plans

Committable, code-grounded implementation plans for the final remaining follow-up items.
Produced **plan-only** (no production code changed) on **2026-06-02** by a 7-stack parallel
planning wave — one read-only architect agent per atomic work item. Each plan cites real
`file:line` touchpoints and honors the CLAUDE.md quality gates (Vitest + typecheck, no `any`,
schema migrations, G-code safety, Python-via-bash for files > 800 lines).

These are **plans, not changes.** To execute one, follow its _Sequencing_ section under the
standard per-cycle gates (pre-flight `npm test` + `npm run typecheck`, post-flight the same with
zero regressions, improvement-log entry).

## Status legend

- ✅ **Ready** — build-ready now; no external blockers.
- ⛔ **Blocked** — waiting on an upstream dependency; plan is watch/track-focused.
- 🔮 **V2-era** — larger future feature; plan delivers a foundation slice **and** the full vision.

## Plans

| # | Plan | Status | Effort | Machines |
|---|------|--------|--------|----------|
| 1 | [electron-builder 25 → 26](electron-builder-25-to-26.md) | ✅ Ready | S | All (build tooling) |
| 2 | [CAD V1.5 — per-layer slicer breakdowns](cad-v15-per-layer-slicer-breakdowns.md) | ✅ Ready | M | K2 Plus (FDM) |
| 3 | [CAD V1.5 — true HLR at section cuts](cad-v15-true-hlr-section-cuts.md) | ✅ Ready | L | CAD (all) |
| 4 | [CarveraCLI abort verb](carvera-cli-abort-verb.md) | ⛔ Blocked | S watch / M wire | Carvera |
| 5 | [V2 — real 3D toolpath playback](v2-3d-toolpath-playback.md) | 🔮 V2-era | **S foundation** / L full | Laguna, Carvera |
| 6 | [V2 — assembly mate solver convergence](v2-assembly-mate-solver-convergence.md) | 🔮 V2-era | L / XL | CAD |
| 7 | [V2 — drawing dimension snap-to-vertex](v2-drawing-dimension-snap-to-vertex.md) | 🔮 V2-era | L (S first slice) | CAD |

## Key cross-cutting findings

- **#5 is mostly built already.** `src/renderer/manufacture/ManufactureCamSimulationPanel.tsx`
  (1486 lines) is a complete React-Three-Fiber playback panel — scrubber, play/pause, color-coded
  rapid/feed, animated tool head, 4-axis cylindrical transform, material-removal preview. It is wired
  to the legacy `panelTab === 'simulate'` sub-tab but **not** to the workflow `simulate` stage, which
  still renders `ToolpathSimulationBody` (a text-stats readout). Foundation = ~10–30 lines of JSX in
  `ManufactureWorkspace.tsx:1829`. The "V2-era" label overstates the remaining work.
- **#4 is genuinely blocked, and the upstream isn't even publicly indexed.** No `abort`/`stop`/`halt`
  verb was discoverable for `carvera-cli` in any public index as of 2026-06-02 (the `hagmonk/carvera-cli`
  repo is private, deleted, or unindexed). The interim advisory → physical-E-stop behavior is confirmed
  correct and safe. Bonus doc-bug found: `docs/MACHINES.md:184` cites `fab:estop`; the real IPC channel
  is `machine:estop`.
- **#3's HLR approach is already proven in-repo.** The 2D drawing pipeline
  (`engines/cad/cadquery_drawing.py` `section_drawing`) already runs OCCT hidden-line removal via
  CadQuery's `getSVG`. The new work exposes a dedicated `HLRBRep_Algo` sidecar method for the 3D viewport,
  replacing the current Three.js half-space clip (`Viewport3D.tsx:699`).
- **#1 closes 10 high (dev-only) advisories.** `docs/SECURITY.md` already defers the v26 bump; this plan
  closes it, every v26 breaking change maps onto signing/notarize/`linux.desktop` config this repo does
  not use, and it adds an `npm audit --omit=dev` gate to `scripts/verify-release-gate.mjs`.

## Recommended execution order

1. **#1 electron-builder** — small, isolated, unblocks the release security gate. Own worktree.
2. **#5 toolpath playback foundation** — surprisingly cheap (S), high visible value.
3. **#2 per-layer slicer breakdowns** — self-contained FDM improvement (M).
4. **#3 true HLR** — larger (L) but well-scoped; proven kernel path.
5. **#6 / #7** — true V2-era; schedule when CAD depth is the focus.
6. **#4** — watch-only until upstream ships; do the doc-fix half now (S).
