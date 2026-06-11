/**
 * CursorCoordsContext — Wave 3n unit + render contract.
 *
 * Node-env vitest (no jsdom): behavior that requires events/effects lives in
 * the source-level threading pin (`design/sketch-cursor-world-threading-pin`);
 * this file covers the PURE pieces (equality used by the setter's de-dupe
 * bail) and the SSR-renderable context contract (provider threads a value to
 * consumers; both hooks degrade honestly without a provider — the same
 * provider-tolerance convention as `useOptionalCommandSurface`).
 */
import { describe, expect, it } from 'vitest'
import { createElement, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  CursorCoordsProvider,
  cursorCoordsEqual,
  useCursorCoords,
  useOptionalSetCursorCoords,
  type CursorCoords
} from '../CursorCoordsContext'

const SKETCH: CursorCoords = { kind: 'sketch2d', xMm: 12.5, yMm: -3 }
const PICK: CursorCoords = { kind: 'pick3d', xMm: 1, yMm: 2, zMm: 3 }

describe('cursorCoordsEqual (the setter de-dupe bail)', () => {
  it('null/null are equal; null vs value are not', () => {
    expect(cursorCoordsEqual(null, null)).toBe(true)
    expect(cursorCoordsEqual(null, SKETCH)).toBe(false)
    expect(cursorCoordsEqual(PICK, null)).toBe(false)
  })

  it('same-kind same-fields compare equal across distinct objects', () => {
    expect(cursorCoordsEqual(SKETCH, { kind: 'sketch2d', xMm: 12.5, yMm: -3 })).toBe(true)
    expect(cursorCoordsEqual(PICK, { kind: 'pick3d', xMm: 1, yMm: 2, zMm: 3 })).toBe(true)
  })

  it('any differing field breaks equality', () => {
    expect(cursorCoordsEqual(SKETCH, { kind: 'sketch2d', xMm: 12.5, yMm: -3.01 })).toBe(false)
    expect(cursorCoordsEqual(PICK, { kind: 'pick3d', xMm: 1, yMm: 2, zMm: 3.5 })).toBe(false)
  })

  it('a sketch2d value never equals a pick3d value (kind discriminates)', () => {
    expect(
      cursorCoordsEqual({ kind: 'sketch2d', xMm: 1, yMm: 2 }, { kind: 'pick3d', xMm: 1, yMm: 2, zMm: 0 })
    ).toBe(false)
  })
})

/** Probe component: renders the live context value as inspectable text. */
function CoordsProbe(): ReactElement {
  const coords = useCursorCoords()
  return createElement(
    'span',
    { 'data-testid': 'coords-probe' },
    coords === null ? 'none' : `${coords.kind}:${coords.xMm},${coords.yMm}`
  )
}

/** Probe component: the optional setter must be callable render-side without a provider. */
function SetterProbe(): ReactElement {
  const set = useOptionalSetCursorCoords()
  return createElement('span', null, typeof set === 'function' ? 'setter-ok' : 'setter-missing')
}

describe('CursorCoordsProvider (SSR contract)', () => {
  it('threads a seeded value to useCursorCoords consumers', () => {
    const html = renderToStaticMarkup(
      createElement(CursorCoordsProvider, {
        initialCoords: SKETCH,
        children: createElement(CoordsProbe)
      })
    )
    expect(html).toContain('sketch2d:12.5,-3')
  })

  it('defaults to null (no source active) when not seeded', () => {
    const html = renderToStaticMarkup(
      createElement(CursorCoordsProvider, { children: createElement(CoordsProbe) })
    )
    expect(html).toContain('none')
  })

  it('useCursorCoords returns null WITHOUT a provider (never throws)', () => {
    expect(renderToStaticMarkup(createElement(CoordsProbe))).toContain('none')
  })

  it('useOptionalSetCursorCoords degrades to a callable no-op without a provider', () => {
    expect(renderToStaticMarkup(createElement(SetterProbe))).toContain('setter-ok')
  })
})
