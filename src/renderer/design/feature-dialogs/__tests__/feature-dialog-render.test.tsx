/**
 * FG-5b · Render-pin contracts for the six feature dialogs.
 *
 * The vitest env is `node` (no jsdom), so — like every Design render test — we
 * use `renderToStaticMarkup` (one-shot SSR) and assert on the emitted HTML.
 * Click-driven emit behavior is covered by the pure op-builder tests
 * (`feature-dialog-ops.test.ts`); here we pin the *markup contract*: the
 * mockup `.dc-prop-card` styling, `<button type="button">` everywhere (CLAUDE.md
 * rule), the field testids, unit suffixes, selection-aware rendering, and the
 * honest capability-gap notes.
 */

import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExtrudeDialog } from '../ExtrudeDialog'
import { RevolveDialog } from '../RevolveDialog'
import { FilletDialog } from '../FilletDialog'
import { ChamferDialog } from '../ChamferDialog'
import { ShellDialog } from '../ShellDialog'
import { HoleDialog } from '../HoleDialog'
import type { FeatureDialogSelectionInfo } from '../feature-dialog-types'
import { makeEdgeSelection, makeFaceSelection } from '../../selection-state'

const NO_SELECTION: FeatureDialogSelectionInfo = { selection: null, label: null }
/** A face pick WITHOUT a stable occtHash (legacy / id-only). */
const FACE_SELECTION: FeatureDialogSelectionInfo = {
  selection: makeFaceSelection(4),
  label: 'Face 4 · 25.0 mm²'
}
/** FG-5b: a face pick WITH a stable "f:<hex>" id — drives shell by id. */
const FACE_SELECTION_STABLE: FeatureDialogSelectionInfo = {
  selection: makeFaceSelection(4, 'f:cap42'),
  label: 'Face 4 · 25.0 mm²'
}
/** FG-5b: an edge pick WITH a stable "e:<hex>" id — drives fillet/chamfer by id. */
const EDGE_SELECTION_STABLE: FeatureDialogSelectionInfo = {
  selection: makeEdgeSelection(7, 'e:rail7'),
  label: 'Edge 7'
}
const noop = (): void => undefined

/** Assert EVERY `<button>` in the markup carries `type="button"`. */
function expectAllButtonsTyped(html: string): void {
  // Find each <button ...> open tag and assert it includes type="button".
  const openTags = html.match(/<button[^>]*>/g) ?? []
  for (const tag of openTags) {
    expect(tag).toContain('type="button"')
  }
}

function render(el: ReactElement): string {
  return renderToStaticMarkup(el)
}

describe('FG-5b — ExtrudeDialog render contract', () => {
  it('renders a .dc-prop-card with a depth field (mm suffix) + apply button', () => {
    const html = render(
      createElement(ExtrudeDialog, {
        params: { depthMm: 10 },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('dc-prop-card')
    expect(html).toContain('data-testid="fd-extrude"')
    expect(html).toContain('data-testid="fd-extrude-depth"')
    expect(html).toContain('data-testid="fd-extrude-apply"')
    expect(html).toContain('mm')
    expectAllButtonsTyped(html)
  })

  it('names the script parameter it drives in the note', () => {
    const html = render(
      createElement(ExtrudeDialog, {
        params: { depthMm: 5, depthParamKey: 'plateThicknessMm' },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('plateThicknessMm')
  })

  it('disables apply + shows an honest hint when disabled (no project)', () => {
    const html = render(
      createElement(ExtrudeDialog, {
        params: { depthMm: 10 },
        selectionInfo: NO_SELECTION,
        onApply: noop,
        disabled: true
      })
    )
    expect(html).toMatch(/data-testid="fd-extrude-apply"[^>]*disabled/)
    expect(html).toContain('Open a project')
  })
})

describe('FG-5b — RevolveDialog render contract', () => {
  it('renders an angle field with a degree suffix', () => {
    const html = render(
      createElement(RevolveDialog, {
        params: { angleDeg: 360 },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-revolve-angle"')
    expect(html).toContain('°') // ° degree sign
    expect(html).not.toContain('data-testid="fd-revolve-axis"') // hidden without axis params
    expectAllButtonsTyped(html)
  })

  it('shows the axis field only when axis params are supplied', () => {
    const html = render(
      createElement(RevolveDialog, {
        params: { angleDeg: 180, axisXMm: 0, axisXParamKey: 'axisXmm' },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-revolve-axis"')
    expect(html).toContain('axisXmm')
  })
})

describe('FG-5b — FilletDialog render contract', () => {
  it('renders radius (mm) + an edges mode select + apply', () => {
    const html = render(
      createElement(FilletDialog, {
        params: { radiusMm: 2 },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-fillet"')
    expect(html).toContain('data-testid="fd-fillet-radius"')
    expect(html).toContain('data-testid="fd-fillet-mode"')
    expect(html).toContain('data-testid="fd-fillet-apply"')
    expectAllButtonsTyped(html)
  })

  it('renders the axis-bucket picker (all 6 dirs) when mode starts as select', () => {
    const html = render(
      createElement(FilletDialog, {
        params: { radiusMm: 2, mode: 'select', edgeDirection: '+Z' },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    for (const dir of ['+X', '-X', '+Y', '-Y', '+Z', '-Z']) {
      expect(html).toContain(`data-testid="fd-fillet-dir-${dir}"`)
    }
    // The active bucket is aria-pressed.
    expect(html).toMatch(/data-testid="fd-fillet-dir-\+Z"[^>]*aria-pressed="true"/)
    expectAllButtonsTyped(html)
  })

  it('does NOT show the axis picker in "all" mode', () => {
    const html = render(
      createElement(FilletDialog, {
        params: { radiusMm: 2, mode: 'all' },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).not.toContain('data-testid="fd-fillet-dir-+Z"')
  })

  it('shows a context note when a (non-edge) face is selected, and the empty prompt when nothing is', () => {
    // A face pick can't drive a fillet (fillet targets edges), so the note
    // says so honestly and routes the operator to pick an edge / use the bucket.
    const withSel = render(
      createElement(FilletDialog, {
        params: { radiusMm: 2 },
        selectionInfo: FACE_SELECTION,
        onApply: noop
      })
    )
    expect(withSel).toContain('data-testid="fd-fillet-selection-note"')
    expect(withSel).toContain('Pick an edge to fillet it by id')
    expect(withSel).toContain('Face 4 · 25.0 mm²')
    // The retired honesty-gap copy must be gone (the kernel DOES support it now).
    expect(withSel).not.toContain('not supported by the kernel yet')

    const withoutSel = render(
      createElement(FilletDialog, {
        params: { radiusMm: 2 },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(withoutSel).not.toContain('data-testid="fd-fillet-selection-note"')
    expect(withoutSel).toContain('data-testid="fd-fillet-selection-empty"')
  })

  it('FG-5b: a picked edge with a stable id drives the kernel (note says so) in select mode', () => {
    const html = render(
      createElement(FilletDialog, {
        params: { radiusMm: 2, mode: 'select', edgeDirection: '+Z' },
        selectionInfo: EDGE_SELECTION_STABLE,
        onApply: noop
      })
    )
    expect(html).toContain('Filleting the picked edge')
    expect(html).not.toContain('not supported by the kernel yet')
  })
})

describe('FG-5b — ChamferDialog render contract', () => {
  it('renders length (mm) + mode + apply, axis picker in select mode', () => {
    const html = render(
      createElement(ChamferDialog, {
        params: { lengthMm: 1, mode: 'select', edgeDirection: '-X' },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-chamfer-length"')
    expect(html).toContain('data-testid="fd-chamfer-mode"')
    expect(html).toContain('data-testid="fd-chamfer-dir--X"')
    expect(html).toMatch(/data-testid="fd-chamfer-dir--X"[^>]*aria-pressed="true"/)
    expect(html).toContain('data-testid="fd-chamfer-apply"')
    expectAllButtonsTyped(html)
  })

  it('shows a context note for a non-edge selection (no retired honesty-gap copy)', () => {
    const html = render(
      createElement(ChamferDialog, {
        params: { lengthMm: 1 },
        selectionInfo: FACE_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('Pick an edge to chamfer it by id')
    expect(html).not.toContain('not supported by the kernel yet')
  })

  it('FG-5b: a picked edge with a stable id drives the kernel in select mode', () => {
    const html = render(
      createElement(ChamferDialog, {
        params: { lengthMm: 1, mode: 'select', edgeDirection: '-X' },
        selectionInfo: EDGE_SELECTION_STABLE,
        onApply: noop
      })
    )
    expect(html).toContain('Chamfering the picked edge')
  })
})

describe('FG-5b — ShellDialog render contract', () => {
  it('renders thickness (mm) + the open-direction axis picker + apply', () => {
    const html = render(
      createElement(ShellDialog, {
        params: { thicknessMm: 2 },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-shell-thickness"')
    expect(html).toContain('data-testid="fd-shell-dir-+Z"')
    expect(html).toContain('data-testid="fd-shell-apply"')
    expectAllButtonsTyped(html)
  })

  it('a face pick WITHOUT a stable id falls back to the axis bucket (no retired gap copy)', () => {
    const html = render(
      createElement(ShellDialog, {
        params: { thicknessMm: 2 },
        selectionInfo: FACE_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('no stable id yet')
    expect(html).not.toContain('not supported by the kernel yet')
  })

  it('FG-5b: a face pick WITH a stable id drives the open cap by id', () => {
    const html = render(
      createElement(ShellDialog, {
        params: { thicknessMm: 2 },
        selectionInfo: FACE_SELECTION_STABLE,
        onApply: noop
      })
    )
    expect(html).toContain('Opening the picked face')
    expect(html).not.toContain('not supported by the kernel yet')
  })
})

describe('FG-5b — HoleDialog render contract', () => {
  it('renders profile index + mode + zstart + apply (through-all hides depth)', () => {
    const html = render(
      createElement(HoleDialog, {
        params: { profileIndex: 0, mode: 'through_all' },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-hole-profile"')
    expect(html).toContain('data-testid="fd-hole-mode"')
    expect(html).toContain('data-testid="fd-hole-zstart"')
    expect(html).toContain('data-testid="fd-hole-apply"')
    expect(html).not.toContain('data-testid="fd-hole-depth"') // hidden in through-all
    expectAllButtonsTyped(html)
  })

  it('shows the depth field in depth mode', () => {
    const html = render(
      createElement(HoleDialog, {
        params: { profileIndex: 0, mode: 'depth', depthMm: 12 },
        selectionInfo: NO_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('data-testid="fd-hole-depth"')
  })

  it('flags the missing face-pick placement when a face is selected', () => {
    const html = render(
      createElement(HoleDialog, {
        params: { profileIndex: 0 },
        selectionInfo: FACE_SELECTION,
        onApply: noop
      })
    )
    expect(html).toContain('not supported yet')
  })
})

describe('FG-5b — global markup invariants', () => {
  it('no dialog leaks inline styles (themed tokens only)', () => {
    const dialogs: ReactElement[] = [
      createElement(ExtrudeDialog, { params: { depthMm: 10 }, selectionInfo: NO_SELECTION, onApply: noop }),
      createElement(RevolveDialog, { params: { angleDeg: 360 }, selectionInfo: NO_SELECTION, onApply: noop }),
      createElement(FilletDialog, { params: { radiusMm: 2, mode: 'select' }, selectionInfo: FACE_SELECTION, onApply: noop }),
      createElement(ChamferDialog, { params: { lengthMm: 1, mode: 'select' }, selectionInfo: FACE_SELECTION, onApply: noop }),
      createElement(ShellDialog, { params: { thicknessMm: 2 }, selectionInfo: FACE_SELECTION, onApply: noop }),
      createElement(HoleDialog, { params: { profileIndex: 0, mode: 'depth', depthMm: 5 }, selectionInfo: FACE_SELECTION, onApply: noop })
    ]
    for (const el of dialogs) {
      const html = render(el)
      expect(html).not.toMatch(/style="/)
    }
  })

  it('does not throw or log warnings on a typical render', () => {
    const warns: unknown[] = []
    const errs: unknown[] = []
    const origWarn = console.warn
    const origErr = console.error
    console.warn = ((...a: unknown[]) => { warns.push(a) }) as typeof console.warn
    console.error = ((...a: unknown[]) => { errs.push(a) }) as typeof console.error
    try {
      render(createElement(FilletDialog, { params: { radiusMm: 2 }, selectionInfo: FACE_SELECTION, onApply: noop }))
      render(createElement(HoleDialog, { params: { profileIndex: 0 }, selectionInfo: NO_SELECTION, onApply: noop }))
      expect(warns).toEqual([])
      expect(errs).toEqual([])
    } finally {
      console.warn = origWarn
      console.error = origErr
    }
  })
})
