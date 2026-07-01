/**
 * FEATURE RE-EDIT · Interactive proof (happy-dom) of the full re-edit loop —
 * the behaviour source pins can never reach:
 *
 *   click a timeline row's ✎ → the matching feature dialog opens PRE-FILLED
 *   with the op's CURRENT parameters → type a new value → Apply → the op at
 *   that index is REPLACED IN PLACE (same position, nothing appended).
 *
 * The harness composes the REAL components exactly as `DesignWorkspace` wires
 * them: `FeatureTree` (the timeline rows + the ✎ button) and
 * `EditKernelOpDialog` (spec mapper → real dialog / generic fallback), with the
 * same five lines of state glue the workspace uses (`editing` index + an
 * update-at-index sink). Run with
 * `npx vitest run --config vitest.dom.config.ts <this file>`.
 */

import { useState, type JSX } from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeatureTree } from '../../FeatureTree'
import { EditKernelOpDialog } from '../EditKernelOpDialog'
import type { KernelPostSolidOp } from '../../../../shared/part-features-schema'

const unionBox = (): KernelPostSolidOp => ({
  kind: 'boolean_union_box',
  xMinMm: 0,
  xMaxMm: 10,
  yMinMm: 0,
  yMaxMm: 10,
  zMinMm: 0,
  zMaxMm: 5
})

function TimelineEditHarness({
  initialOps
}: {
  readonly initialOps: readonly KernelPostSolidOp[]
}): JSX.Element {
  const [ops, setOps] = useState<readonly KernelPostSolidOp[]>(initialOps)
  const [editing, setEditing] = useState<number | null>(null)
  const editingOp = editing !== null ? (ops[editing] ?? null) : null
  return (
    <div>
      <FeatureTree operations={[]} kernelOps={ops} onKernelEdit={setEditing} />
      {editing !== null && editingOp !== null && (
        <EditKernelOpDialog
          index={editing}
          op={editingOp}
          selectionInfo={{ selection: null, label: null }}
          onUpdateKernelOp={(index, op) => {
            // The same replace-at-index the session's updateKernelOpAt performs.
            setOps((prev) => prev.map((o, i) => (i === index ? op : o)))
            setEditing(null)
          }}
        />
      )}
      <output data-testid="ops-json">{JSON.stringify(ops)}</output>
    </div>
  )
}

function readOps(): KernelPostSolidOp[] {
  return JSON.parse(screen.getByTestId('ops-json').textContent ?? '[]') as KernelPostSolidOp[]
}

describe('feature timeline re-edit — interactive (happy-dom)', () => {
  it('edits a fillet radius in place: pre-filled dialog, update at index, NO append', async () => {
    const user = userEvent.setup()
    render(
      <TimelineEditHarness
        initialOps={[unionBox(), { kind: 'fillet_all', radiusMm: 2 }]}
      />
    )

    // Every timeline row carries the ✎ button; click the fillet's (index 1).
    const editButtons = screen.getAllByTestId('cad-kernel-edit')
    expect(editButtons).toHaveLength(2)
    await user.click(editButtons[1]!)

    // The REAL FilletDialog opens PRE-FILLED with the op's current radius.
    expect(screen.getByTestId('fd-fillet')).toBeTruthy()
    const radius = screen.getByTestId('fd-fillet-radius') as HTMLInputElement
    expect(radius.value).toBe('2')

    // Change 2 → 7 and apply.
    await user.clear(radius)
    await user.type(radius, '7')
    await user.click(screen.getByTestId('fd-fillet-apply'))

    // The op at index 1 changed IN PLACE; nothing was appended; index 0 intact.
    const ops = readOps()
    expect(ops).toHaveLength(2)
    expect(ops[1]).toEqual({ kind: 'fillet_all', radiusMm: 7 })
    expect(ops[0]).toEqual(unionBox())
    // Apply closed the editor.
    expect(screen.queryByTestId('fd-edit-host')).toBeNull()
  })

  it('pre-fills select-mode fillets (mode + axis bucket) and keeps them on apply', async () => {
    const user = userEvent.setup()
    render(
      <TimelineEditHarness
        initialOps={[{ kind: 'fillet_select', radiusMm: 3, edgeDirection: '-Y' }]}
      />
    )

    await user.click(screen.getByTestId('cad-kernel-edit'))

    // Mode + axis bucket arrive pre-selected from the persisted op.
    const mode = screen.getByTestId('fd-fillet-mode') as HTMLSelectElement
    expect(mode.value).toBe('select')
    expect(screen.getByTestId('fd-fillet-dir--Y').getAttribute('data-active')).toBe('true')
    expect((screen.getByTestId('fd-fillet-radius') as HTMLInputElement).value).toBe('3')

    const radius = screen.getByTestId('fd-fillet-radius')
    await user.clear(radius)
    await user.type(radius, '4.5')
    await user.click(screen.getByTestId('fd-fillet-apply'))

    expect(readOps()).toEqual([
      { kind: 'fillet_select', radiusMm: 4.5, edgeDirection: '-Y' }
    ])
  })

  it('falls back to the generic editor for a dialog-less kind (sheet_fold) and updates in place', async () => {
    const user = userEvent.setup()
    render(
      <TimelineEditHarness
        initialOps={[
          {
            kind: 'sheet_fold',
            bendLineYMm: 0,
            bendRadiusMm: 2,
            bendAngleDeg: 90,
            kFactor: 0.44,
            bendAllowanceMode: 'k_factor'
          }
        ]}
      />
    )

    await user.click(screen.getByTestId('cad-kernel-edit'))

    // Generic editor, seeded from the persisted op.
    expect(screen.getByTestId('fd-generic-edit')).toBeTruthy()
    const angle = screen.getByTestId('fd-generic-input-bendAngleDeg') as HTMLInputElement
    expect(angle.value).toBe('90')

    await user.clear(angle)
    await user.type(angle, '45')
    await user.click(screen.getByTestId('fd-generic-apply'))

    const ops = readOps()
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({
      kind: 'sheet_fold',
      bendAngleDeg: 45,
      bendRadiusMm: 2,
      bendAllowanceMode: 'k_factor'
    })
  })

  it('generic editor gates Apply on the REAL schema (invalid value never lands)', async () => {
    const user = userEvent.setup()
    render(
      <TimelineEditHarness
        initialOps={[
          {
            kind: 'sheet_fold',
            bendLineYMm: 0,
            bendRadiusMm: 2,
            bendAngleDeg: 90,
            kFactor: 0.44,
            bendAllowanceMode: 'k_factor'
          }
        ]}
      />
    )

    await user.click(screen.getByTestId('cad-kernel-edit'))
    const angle = screen.getByTestId('fd-generic-input-bendAngleDeg')
    await user.clear(angle)
    await user.type(angle, '999') // schema caps |bendAngleDeg| at 170
    await user.click(screen.getByTestId('fd-generic-apply'))

    // Rejected inline: error shown, editor still open, op unchanged.
    expect(screen.getByTestId('fd-generic-error')).toBeTruthy()
    expect(screen.getByTestId('fd-edit-host')).toBeTruthy()
    expect(readOps()[0]).toMatchObject({ bendAngleDeg: 90 })
  })

  it('routes a picked-edge fillet to the generic editor and PRESERVES the picked ids', async () => {
    const user = userEvent.setup()
    render(
      <TimelineEditHarness
        initialOps={[
          {
            kind: 'fillet_select',
            radiusMm: 2,
            edgeDirection: '+Z',
            pickedEdgeIds: ['e:abc']
          }
        ]}
      />
    )

    await user.click(screen.getByTestId('cad-kernel-edit'))

    // NOT the FilletDialog (it would drop the picked ids) — the generic editor,
    // with the picked ids surfaced read-only.
    expect(screen.queryByTestId('fd-fillet')).toBeNull()
    expect(screen.getByTestId('fd-generic-edit')).toBeTruthy()
    expect(screen.getByTestId('fd-generic-readonly-pickedEdgeIds').textContent).toContain(
      'e:abc'
    )

    const radius = screen.getByTestId('fd-generic-input-radiusMm')
    await user.clear(radius)
    await user.type(radius, '5')
    await user.click(screen.getByTestId('fd-generic-apply'))

    expect(readOps()).toEqual([
      { kind: 'fillet_select', radiusMm: 5, edgeDirection: '+Z', pickedEdgeIds: ['e:abc'] }
    ])
  })
})
