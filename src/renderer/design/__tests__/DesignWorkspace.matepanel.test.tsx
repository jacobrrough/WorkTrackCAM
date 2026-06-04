/**
 * DesignWorkspace — mate-creation-surface reachability pin (CAD V1 Wire phase).
 *
 * Proves the previously-dormant {@link AssemblyMatePanel} is now REACHABLE on
 * the live `assemble` route: when the Design workspace opens on the Assembly
 * tab AND the assembly has at least one part, the panel mounts inside the
 * assembly tab-panel. When the assembly is empty (or the active view is Part /
 * Drawing) the panel is ABSENT — the AssemblyView owns its own empty-state and
 * mounting a mate surface against zero parts would be meaningless.
 *
 * It also pins the "inert when there's no handle" contract: with parts present
 * but no assembly handle yet (the running-shell state before AssemblyView's
 * async build effect reports a handle), the panel still renders but its Solve
 * button is DISABLED — so no spurious `cad.add_assembly_mate` IPC can fire and
 * there is no boot regression.
 *
 * Why `renderToStaticMarkup`? Same rationale as every sibling Design pin — the
 * project's node-env vitest ships no DOM. The mate panel reads `window.fab`
 * only inside the Solve click handler, which a static render never fires, so
 * the suite is hermetic (no IPC, no jsdom). Tab-switch behaviour is exercised
 * via the `initialViewMode` seed (same lever `DesignWorkspace.tabbar.test.tsx`
 * uses).
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { DesignWorkspace, STARTER_SCRIPT } from '../DesignWorkspace'
import type { AssemblyPart } from '../AssemblyView'

// ── window.fab shim ────────────────────────────────────────────────────────
// DesignWorkspace + AssemblyView read `window.fab` for their `cad.*` effects.
// Effects never run under renderToStaticMarkup, but the module-level accessor
// must resolve to a defined object so the render path never touches undefined.
const gAsRecord = globalThis as unknown as Record<string, unknown>
if (gAsRecord['window'] === undefined) {
  gAsRecord['window'] = globalThis
}
if (gAsRecord['fab'] === undefined) {
  gAsRecord['fab'] = { cad: {} }
}

const part = (id: string, name: string): AssemblyPart => ({ id, name, handle: `script:${id}` })
const ONE_PART: readonly AssemblyPart[] = [part('p1', 'Bracket')]
const TWO_PARTS: readonly AssemblyPart[] = [part('p1', 'Bracket'), part('p2', 'Plate')]

describe('DesignWorkspace — mate surface reachability on the assemble route', () => {
  it('mounts the AssemblyMatePanel inside the assembly tab when parts are present', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: TWO_PARTS,
        // Seed a handle so the running-shell "built assembly" state is exercised.
        initialAssemblyHandle: 'asm:1',
      }),
    )
    // The AssemblyView itself is present…
    expect(html).toContain('data-testid="design-assembly-view"')
    // …AND the mate-creation surface is mounted alongside it (the wiring).
    expect(html).toContain('data-testid="assembly-mate-panel"')
    // It sits inside the assembly tab-panel wrapper.
    expect(html).toMatch(
      /id="design-workspace-panel-assembly"[^>]*role="tabpanel"|role="tabpanel"[^>]*id="design-workspace-panel-assembly"/,
    )
    // The kind picker + part selects are wired through (panel is interactive).
    expect(html).toContain('data-testid="assembly-mate-kind"')
    expect(html).toContain('data-testid="assembly-mate-part1"')
  })

  it('with a handle present, the panel Solve button is ENABLED (operator can create a mate)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: TWO_PARTS,
        initialAssemblyHandle: 'asm:1',
      }),
    )
    const match = html.match(/data-testid="assembly-mate-solve"[^>]*>/)
    expect(match).not.toBeNull()
    // Strip aria-disabled (always present) and assert the real `disabled`
    // attribute is NOT set.
    const tagWithoutAria = match?.[0].replace(/aria-disabled="[^"]*"/, '') ?? ''
    expect(/[\s"]disabled(=|>|\s|$)/.test(tagWithoutAria)).toBe(false)
  })

  it('with parts but NO handle yet, the panel mounts but Solve is DISABLED (inert, no spurious IPC)', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: TWO_PARTS,
        // No initialAssemblyHandle → null → the running-shell state before the
        // async build effect has reported a handle.
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-panel"')
    // The Solve button is present but disabled — clicking it is a no-op, so no
    // `cad.add_assembly_mate` round-trip can fire before the assembly exists.
    expect(html).toMatch(/data-testid="assembly-mate-solve"[^>]*disabled/)
  })

  it('does NOT mount the mate panel when the assembly is empty', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: [],
      }),
    )
    // AssemblyView still renders its own empty-state…
    expect(html).toContain('data-testid="design-assembly-view"')
    expect(html).toContain('data-testid="design-assembly-empty"')
    // …but there is nothing to mate, so the panel is absent.
    expect(html).not.toContain('data-testid="assembly-mate-panel"')
  })

  it('does NOT mount the mate panel on the Part view even with parts seeded', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'part',
        initialAssemblyParts: TWO_PARTS,
        initialAssemblyHandle: 'asm:1',
      }),
    )
    // Part editor is up; the assembly mate surface is not on this tab.
    expect(html).toContain('design-workspace__editor-col')
    expect(html).not.toContain('data-testid="assembly-mate-panel"')
  })

  it('does NOT mount the mate panel on the Drawing view', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'drawing',
        initialAssemblyParts: TWO_PARTS,
      }),
    )
    expect(html).toContain('data-testid="design-drawing-view"')
    expect(html).not.toContain('data-testid="assembly-mate-panel"')
  })

  it('renders the single-part assembly panel-less but with the AssemblyView present', () => {
    // One part: the assembly exists (AssemblyView populated), and the panel
    // mounts but reports its own "need a second part" hint. We assert the
    // panel IS reachable (one part is enough to mount it) yet the form is
    // gated — proving the mount condition is "parts.length > 0", not ">= 2".
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        initialViewMode: 'assembly',
        initialAssemblyParts: ONE_PART,
        initialAssemblyHandle: 'asm:1',
      }),
    )
    expect(html).toContain('data-testid="assembly-mate-panel"')
    // With <2 parts the panel shows its "need a second part" hint, not the form.
    expect(html).toContain('data-testid="assembly-mate-need-parts"')
    expect(html).not.toContain('data-testid="assembly-mate-kind"')
  })

  it('does not emit console errors/warnings rendering the wired assembly route', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(DesignWorkspace, {
          initialScript: STARTER_SCRIPT,
          initialViewMode: 'assembly',
          initialAssemblyParts: TWO_PARTS,
          initialAssemblyHandle: 'asm:1',
          onMateAdded: vi.fn(),
          onToast: vi.fn(),
        }),
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
