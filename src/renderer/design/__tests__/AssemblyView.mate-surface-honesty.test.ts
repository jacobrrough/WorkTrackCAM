/**
 * Class-D honesty pin (Model + Assembly audit) — the AssemblyView Mates panel +
 * its face-id modal are a DEAD, DIVERGENT capability surface.
 *
 * FINDING: `AssemblyView` renders a whole Mates block (the "Define mate" button,
 * the mates list, and a modal whose kind picker + part1/feature1/part2/feature2
 * inputs model a mate as integer FACE IDS) gated on the `mates` prop. The LIVE
 * `assemble` route (DesignWorkspace) mounts `<AssemblyView>` WITHOUT `mates` /
 * `onAddMate` / `onRemoveMate`, so that block never renders in the running app —
 * only the test suite passes them. The reachable mate surface is the SEPARATE
 * `AssemblyMatePanel`, which models a mate as 3-VECTORS (point/axis/plane) — the
 * shape the durable persistence path (`runPersistMate` → `persistMate`) consumes.
 *
 * The risk this pin locks down: a future caller "turning mates on" by wiring the
 * AssemblyView face-id surface would emit a face-id `AssemblyMate` that nothing
 * in persistence consumes (it expects a `SolvedMate` 3-vector draft) — a silent
 * no-op masquerading as a capability. These source pins fail loudly if either
 * (a) someone wires the dead face-id surface onto the live route, or (b) the
 * honesty warning documenting the trap is removed.
 *
 * Source-pin style (node env, no DOM) mirrors `DesignSessionContext.reload-guard`.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const DESIGN_WORKSPACE_SRC = readFileSync(
  join(__dirname, '..', 'DesignWorkspace.tsx'),
  'utf-8'
)
const ASSEMBLY_VIEW_SRC = readFileSync(join(__dirname, '..', 'AssemblyView.tsx'), 'utf-8')

describe('live assemble route uses the 3-vector AssemblyMatePanel, not the face-id surface', () => {
  it('mounts the reachable AssemblyMatePanel (the durable-persistence mate surface)', () => {
    expect(DESIGN_WORKSPACE_SRC).toContain('<AssemblyMatePanel')
    expect(DESIGN_WORKSPACE_SRC).toContain('onMateAdded={onMateAdded}')
  })

  it('does NOT wire the AssemblyView face-id mate surface on the live route', () => {
    // The live <AssemblyView ...> mount must not pass any of the face-id mate
    // props — wiring them would activate the dead, divergent (no-op) surface.
    expect(DESIGN_WORKSPACE_SRC).not.toContain('onAddMate=')
    expect(DESIGN_WORKSPACE_SRC).not.toContain('onRemoveMate=')
    // `mates=` (the gating prop) must not appear in the workspace composition.
    expect(DESIGN_WORKSPACE_SRC).not.toMatch(/<AssemblyView[\s\S]*?\bmates=\{/)
  })
})

describe('AssemblyView documents the dead face-id mate surface (honesty contract)', () => {
  it('carries the dead-surface / divergent-model warning on the mates prop', () => {
    expect(ASSEMBLY_VIEW_SRC).toContain('HONESTY / DEAD-SURFACE WARNING')
    // It names the reachable alternative + the divergence so the trap is explicit.
    expect(ASSEMBLY_VIEW_SRC).toContain('AssemblyMatePanel')
    expect(ASSEMBLY_VIEW_SRC).toMatch(/FACE IDS|face-id/)
  })
})
