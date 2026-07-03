/**
 * FEATURE-TIMELINE UNDO/REDO · Wiring pins for `DesignSessionContext`.
 *
 * Phase-3 parity (docs/PARITY-ROADMAP.md): sketch editing had full undo (the
 * surface-owned `SketchHistory` + its own Ctrl+Z handler), but the kernel
 * timeline (append / remove / move / reorder / update / suppress / roll-back)
 * was NOT undoable. This wave records each timeline mutation as an undoable
 * `ReplayCommand` whose inverse replays through the SAME `commitKernelFeatures`
 * serialized chain, and routes Ctrl+Z / Ctrl+Y to a timeline-scoped
 * `UndoManager` — but ONLY when the sketch surface is not mounted (the sketch
 * surface owns undo in sketch mode).
 *
 * The renderer test env is `node` (no jsdom / @testing-library), so the
 * provider effect + keydown handler can't be MOUNTED here — the WIRING is
 * source-pinned, the established convention for this file's siblings
 * (`DesignSessionContext.kernel-op-race.test.ts`,
 * `DesignSessionContext.update-kernel-op.test.ts`). The BEHAVIOUR of the pure
 * inverse folds is proven exhaustively by the round-trip suite in
 * `feature-timeline-actions.test.ts`; the ReplayCommand + `record` coalescing
 * semantics by `undo-manager.test.ts`. A small end-to-end simulation of the
 * record→undo→redo cycle through a fake commit chain is included below to prove
 * the substrate the wiring composes.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UndoManager, ReplayCommand } from '../../src/undo-manager'

const SESSION_SRC = readFileSync(join(__dirname, '..', 'DesignSessionContext.tsx'), 'utf-8')

describe('timeline undo — imports + manager', () => {
  it('imports the UndoManager + ReplayCommand substrate', () => {
    expect(SESSION_SRC).toContain("import { UndoManager, ReplayCommand } from '../src/undo-manager'")
  })

  it('imports the pure inverse-fold builders from feature-timeline-actions', () => {
    for (const sym of [
      'invertAppendKernelOp',
      'invertRemoveKernelOpAt',
      'invertMoveKernelOp',
      'invertReorderKernelOps',
      'invertUpdateKernelOpAt',
      'invertSetKernelOpSuppressedAt',
      'invertSetKernelRollbackMarker'
    ]) {
      expect(SESSION_SRC).toContain(sym)
    }
  })

  it('creates ONE timeline-scoped UndoManager per provider (lazy ref)', () => {
    expect(SESSION_SRC).toContain('const timelineUndoRef = useRef<UndoManager | null>(null)')
    expect(SESSION_SRC).toContain('timelineUndoRef.current = new UndoManager()')
  })
})

describe('timeline undo — commit chain stays single-write', () => {
  it('commitKernelFeatures now REPORTS whether it committed (boolean)', () => {
    expect(SESSION_SRC).toContain(
      '(compute: (base: PartFeaturesFile) => KernelFeaturesMutation): boolean =>'
    )
  })

  it('there is still exactly ONE featuresSave for the timeline (race-test invariant)', () => {
    const count =
      SESSION_SRC.match(/fab\.featuresSave\(projectDir, JSON\.stringify\(next\)\)/g)?.length ?? 0
    expect(count).toBe(1)
  })

  it('records an ALREADY-EXECUTED ReplayCommand (record, never re-execute)', () => {
    expect(SESSION_SRC).toContain('const cmd = new ReplayCommand(')
    expect(SESSION_SRC).toContain('mgr.record(cmd)')
    // The forward + inverse both replay through commitKernelFeatures.
    expect(SESSION_SRC).toContain('() => commitKernelFeatures(forward)')
    expect(SESSION_SRC).toContain('() => commitKernelFeatures(inverse)')
  })

  it('captures the PRE-mutation base for the inverse (restores the prior state)', () => {
    expect(SESSION_SRC).toContain(
      'const preState = featuresRef.current ?? derivePartFeatures(designRef.current, null)'
    )
    expect(SESSION_SRC).toContain('const inverse = buildInverse(preState)')
  })
})

describe('timeline undo — every mutating editor is undoable', () => {
  it('all seven kernel-timeline editors route through undoableCommit', () => {
    // append / remove / move / suppress / reorder / update / rollback.
    expect(SESSION_SRC.match(/undoableCommit\(/g)?.length).toBe(7)
  })

  it('append records the remove-at-appended-index inverse', () => {
    expect(SESSION_SRC).toContain('invertAppendKernelOp((preState.kernelOps ?? []).length)')
  })

  it('remove records the re-insert-at-index inverse from the captured op', () => {
    expect(SESSION_SRC).toContain('invertRemoveKernelOpAt(index, removed)')
  })

  it('move records the swap-back inverse', () => {
    expect(SESSION_SRC).toContain('invertMoveKernelOp(index, delta)')
  })

  it('suppress records the previous-flag inverse', () => {
    expect(SESSION_SRC).toContain('invertSetKernelOpSuppressedAt(')
  })

  it('reorder records the order + marker inverse', () => {
    expect(SESSION_SRC).toContain(
      'invertReorderKernelOps(preState.kernelOps ?? [], preState.rolledBackTo)'
    )
  })

  it('update records the previous-op inverse', () => {
    expect(SESSION_SRC).toContain('invertUpdateKernelOpAt(index, previous)')
  })

  it('rollback records the previous-marker inverse', () => {
    expect(SESSION_SRC).toContain('invertSetKernelRollbackMarker(preState.rolledBackTo)')
  })
})

describe('timeline undo — coalescing (dialog-spinner burst)', () => {
  it('a rapid re-edit on the SAME index coalesces via a per-index key', () => {
    // The update editor passes a coalesce key keyed on the index so a spinner
    // burst merges into one undo step (1000 ms window, like sketch numeric edits).
    expect(SESSION_SRC).toContain('`update-kernel-op:${index}`')
  })
})

describe('timeline undo — Ctrl+Z routing gate', () => {
  it('binds a window keydown handler that dispatches via the shared matchers', () => {
    expect(SESSION_SRC).toContain("import {\n  isTypableKeyboardTarget,\n  matchesRedo,\n  matchesUndo\n} from '../../shared/app-keyboard-shortcuts'")
    expect(SESSION_SRC).toContain("window.addEventListener('keydown', handler)")
    expect(SESSION_SRC).toContain("window.removeEventListener('keydown', handler)")
  })

  it('skips typable targets (never hijacks a dialog spinner / text field)', () => {
    expect(SESSION_SRC).toContain('if (isTypableKeyboardTarget(e.target)) return')
  })

  it('YIELDS to the sketch surface while it is mounted (the routing rule)', () => {
    // The DOM probe is the focus/mode gate: sketch mode owns Ctrl+Z; otherwise
    // the timeline stack owns it. No double-undo across the two linear stacks.
    expect(SESSION_SRC).toContain("document.querySelector('.sketch-surface')")
  })

  it('routes Ctrl+Z → timeline undo and Ctrl+Y/Shift+Z → timeline redo', () => {
    expect(SESSION_SRC).toMatch(/matchesUndo\(e\)[\s\S]{0,120}timelineUndoRef\.current\?\.undo\(\)/)
    expect(SESSION_SRC).toMatch(/matchesRedo\(e\)[\s\S]{0,120}timelineUndoRef\.current\?\.redo\(\)/)
  })
})

describe('timeline undo — exposed on the session value', () => {
  it('declares the optional timeline undo/redo contract (additive)', () => {
    expect(SESSION_SRC).toContain('timelineUndo?: () => void')
    expect(SESSION_SRC).toContain('timelineRedo?: () => void')
    expect(SESSION_SRC).toContain('canTimelineUndo?: boolean')
    expect(SESSION_SRC).toContain('canTimelineRedo?: boolean')
  })

  it('exposes timelineUndo/timelineRedo on the value memo AND its deps', () => {
    expect((SESSION_SRC.match(/^ {6}timelineUndo,$/gm) ?? []).length).toBe(2)
    expect((SESSION_SRC.match(/^ {6}timelineRedo,$/gm) ?? []).length).toBe(2)
  })

  it('derives canTimelineUndo/Redo from the live manager', () => {
    expect(SESSION_SRC).toContain('canTimelineUndo: timelineUndoRef.current?.canUndo ?? false')
    expect(SESSION_SRC).toContain('canTimelineRedo: timelineUndoRef.current?.canRedo ?? false')
  })

  it('re-renders on stack change via a mirrored version (timelineUndoVersion in deps)', () => {
    expect(SESSION_SRC).toContain('const [timelineUndoVersion, setTimelineUndoVersion] = useState(0)')
    expect((SESSION_SRC.match(/^ {6}timelineUndoVersion,$/gm) ?? []).length).toBe(1)
  })
})

/**
 * End-to-end simulation of the record→undo→redo cycle the wiring composes: a
 * fake serialized commit chain (a mutable ops array) mirrors what
 * `commitKernelFeatures` does, and `undoableCommit`'s pattern (run forward,
 * then `record` a ReplayCommand whose forward/inverse both re-run through the
 * chain) is exercised for all five mutation kinds. Proves append→undo removes
 * it, remove→undo restores AT INDEX with the suppressed flag, move→undo,
 * update→undo→redo, and rollback→undo — the contract the source pins above
 * assert is present.
 */
describe('record→undo→redo cycle (substrate simulation)', () => {
  type Op = { kind: string; suppressed?: true; r?: number }
  type State = { ops: Op[]; rolledBackTo?: number }

  function makeChain() {
    const state: State = { ops: [] }
    // commitFold: apply a fold that returns the next State (or null to no-op).
    const commit = (fold: (s: State) => State | null): boolean => {
      const next = fold(structuredClone(state))
      if (next === null) return false
      state.ops = next.ops
      state.rolledBackTo = next.rolledBackTo
      return true
    }
    return { state, commit }
  }

  it('append → undo removes the appended op; redo re-appends', () => {
    const { state, commit } = makeChain()
    const mgr = new UndoManager()
    state.ops = [{ kind: 'union' }]
    const forward = (s: State): State => ({ ...s, ops: [...s.ops, { kind: 'fillet', r: 3 }] })
    const pre = structuredClone(state)
    commit(forward)
    mgr.record(
      new ReplayCommand(
        () => commit(forward),
        () => commit((s) => ({ ...s, ops: s.ops.slice(0, pre.ops.length) })),
        'Add kernel op'
      )
    )
    expect(state.ops.map((o) => o.kind)).toEqual(['union', 'fillet'])
    mgr.undo()
    expect(state.ops.map((o) => o.kind)).toEqual(['union'])
    mgr.redo()
    expect(state.ops.map((o) => o.kind)).toEqual(['union', 'fillet'])
  })

  it('remove → undo restores the op AT INDEX with the suppressed flag intact', () => {
    const { state, commit } = makeChain()
    const mgr = new UndoManager()
    const removed: Op = { kind: 'pattern', suppressed: true }
    state.ops = [{ kind: 'union' }, removed, { kind: 'fillet' }]
    const forward = (s: State): State => ({ ...s, ops: s.ops.filter((_, i) => i !== 1) })
    commit(forward)
    mgr.record(
      new ReplayCommand(
        () => commit(forward),
        () => commit((s) => ({ ...s, ops: [...s.ops.slice(0, 1), removed, ...s.ops.slice(1)] })),
        'Delete kernel op'
      )
    )
    expect(state.ops.map((o) => o.kind)).toEqual(['union', 'fillet'])
    mgr.undo()
    expect(state.ops).toEqual([{ kind: 'union' }, { kind: 'pattern', suppressed: true }, { kind: 'fillet' }])
  })

  it('move → undo swaps the pair back', () => {
    const { state, commit } = makeChain()
    const mgr = new UndoManager()
    state.ops = [{ kind: 'union' }, { kind: 'pattern' }]
    const swap = (s: State): State => ({ ...s, ops: [s.ops[1]!, s.ops[0]!] })
    commit(swap)
    mgr.record(new ReplayCommand(() => commit(swap), () => commit(swap), 'Move kernel op'))
    expect(state.ops.map((o) => o.kind)).toEqual(['pattern', 'union'])
    mgr.undo()
    expect(state.ops.map((o) => o.kind)).toEqual(['union', 'pattern'])
  })

  it('update → undo → redo restores then re-applies the edited op', () => {
    const { state, commit } = makeChain()
    const mgr = new UndoManager()
    const previous: Op = { kind: 'fillet', r: 2 }
    state.ops = [{ kind: 'union' }, previous]
    const forward = (s: State): State => ({ ...s, ops: [s.ops[0]!, { kind: 'fillet', r: 7 }] })
    commit(forward)
    mgr.record(
      new ReplayCommand(
        () => commit(forward),
        () => commit((s) => ({ ...s, ops: [s.ops[0]!, previous] })),
        'Edit kernel op'
      )
    )
    expect(state.ops[1]).toEqual({ kind: 'fillet', r: 7 })
    mgr.undo()
    expect(state.ops[1]).toEqual({ kind: 'fillet', r: 2 })
    mgr.redo()
    expect(state.ops[1]).toEqual({ kind: 'fillet', r: 7 })
  })

  it('rollback → undo restores the previous marker', () => {
    const { state, commit } = makeChain()
    const mgr = new UndoManager()
    state.ops = [{ kind: 'union' }, { kind: 'pattern' }, { kind: 'sub' }]
    state.rolledBackTo = undefined
    const forward = (s: State): State => ({ ...s, rolledBackTo: 0 })
    const pre = structuredClone(state)
    commit(forward)
    mgr.record(
      new ReplayCommand(
        () => commit(forward),
        () => commit((s) => ({ ...s, rolledBackTo: pre.rolledBackTo })),
        'Move roll-back marker'
      )
    )
    expect(state.rolledBackTo).toBe(0)
    mgr.undo()
    expect(state.rolledBackTo).toBeUndefined()
  })
})
