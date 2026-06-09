/**
 * FG-5b · FeatureDialogHost render + spec-routing contract.
 *
 * The host selects exactly ONE dialog per `spec.kind` and tags the wrapper with
 * `data-fd-kind` so a parent (and these tests) can verify which dialog mounted.
 * Routing of the emitted change to the kernel-op vs script-param sink is a pure
 * switch on `FeatureDialogChange.target`; we cover the sink wiring at the
 * DesignWorkspace integration layer + the pure op-builders, and here we pin that
 * each kind mounts its matching dialog (and only that one).
 */

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  FeatureDialogHost,
  FEATURE_DIALOG_HOST_TESTID,
  type FeatureDialogSpec
} from '../FeatureDialogHost'
import type { FeatureDialogSelectionInfo } from '../feature-dialog-types'

const NO_SELECTION: FeatureDialogSelectionInfo = { selection: null, label: null }
const noop = (): void => undefined

/** Every spec kind paired with the dialog testid it must render. */
const CASES: ReadonlyArray<{
  readonly spec: FeatureDialogSpec
  readonly dialogTestId: string
}> = [
  { spec: { kind: 'extrude', params: { depthMm: 10 } }, dialogTestId: 'fd-extrude' },
  { spec: { kind: 'revolve', params: { angleDeg: 360 } }, dialogTestId: 'fd-revolve' },
  { spec: { kind: 'fillet', params: { radiusMm: 2 } }, dialogTestId: 'fd-fillet' },
  { spec: { kind: 'chamfer', params: { lengthMm: 1 } }, dialogTestId: 'fd-chamfer' },
  { spec: { kind: 'shell', params: { thicknessMm: 2 } }, dialogTestId: 'fd-shell' },
  { spec: { kind: 'hole', params: { profileIndex: 0 } }, dialogTestId: 'fd-hole' },
  { spec: { kind: 'datum_plane', params: { basePlane: 'XY', offsetMm: 0 } }, dialogTestId: 'fd-datum-plane' },
  { spec: { kind: 'datum_axis', params: { axis: 'Z' } }, dialogTestId: 'fd-datum-axis' },
  { spec: { kind: 'datum_point', params: {} }, dialogTestId: 'fd-datum-point' }
]

describe('FeatureDialogHost — spec → dialog routing', () => {
  for (const { spec, dialogTestId } of CASES) {
    it(`renders the ${spec.kind} dialog and tags the wrapper`, () => {
      const html = renderToStaticMarkup(
        createElement(FeatureDialogHost, {
          spec,
          selectionInfo: NO_SELECTION,
          onAppendKernelOp: noop,
          onScriptParams: noop
        })
      )
      expect(html).toContain(`data-testid="${FEATURE_DIALOG_HOST_TESTID}"`)
      expect(html).toContain(`data-fd-kind="${spec.kind}"`)
      expect(html).toContain(`data-testid="${dialogTestId}"`)
    })
  }

  it('renders ONLY the requested dialog (no sibling dialogs leak)', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureDialogHost, {
        spec: { kind: 'fillet', params: { radiusMm: 2 } },
        selectionInfo: NO_SELECTION,
        onAppendKernelOp: noop,
        onScriptParams: noop
      })
    )
    expect(html).toContain('data-testid="fd-fillet"')
    expect(html).not.toContain('data-testid="fd-extrude"')
    expect(html).not.toContain('data-testid="fd-hole"')
  })

  it('forwards the disabled flag into the active dialog', () => {
    const html = renderToStaticMarkup(
      createElement(FeatureDialogHost, {
        spec: { kind: 'shell', params: { thicknessMm: 2 } },
        selectionInfo: NO_SELECTION,
        onAppendKernelOp: noop,
        onScriptParams: noop,
        disabled: true
      })
    )
    expect(html).toMatch(/data-testid="fd-shell-apply"[^>]*disabled/)
  })
})
