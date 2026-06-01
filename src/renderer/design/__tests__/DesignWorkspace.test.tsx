/**
 * DesignWorkspace — CAD → CAM hand-off pin (UNIFY 1).
 *
 * The DesignWorkspace owns three contracts that this pin protects:
 *
 *   1. `Send to CAM` is rendered as a `.btn .btn-primary` with the
 *      canonical `data-testid="design-workspace-send-to-cam"` ONLY when
 *      the host wires the `onSendToCam` prop. The button is disabled
 *      until `lastTessellation.meshes[0]` is present (you cannot hand
 *      off a model you have not built).
 *   2. The pure orchestrator `performSendToCam(mesh, cadExport,
 *      onSendToCam)` calls `cadExport` FIRST with the mesh's `handle`
 *      and a freshly-generated design-output path, then — on success
 *      ONLY — invokes `onSendToCam` with the path the sidecar echoed
 *      back. The call order is the load-bearing fact: any future
 *      refactor that reorders or short-circuits these calls would
 *      desync the CAM workspace from the freshly-exported STL.
 *   3. `buildDesignOutputStlPath` derives a cross-platform path
 *      (Windows `\` or POSIX `/`) in the same directory as the source
 *      STL, with a `design-output-{stamp}-{rand}.stl` filename so
 *      parallel clicks never collide.
 *
 * Why a pure orchestrator instead of an in-component flow?
 *
 *   The component uses `useState` / `useCallback`, which means it
 *   cannot be driven from a `node`-environment vitest run without
 *   jsdom or react-test-renderer (neither is a project dep — see
 *   useUndo-pin.test.ts and the Cycle 149 [ID-0225] rationale). Pull-
 *   ing the export + handoff logic into a pure helper preserves the
 *   call-order pin without expanding the test dep surface.
 *
 * Cross-cuts all three target machines (CLAUDE.md "My-Shop-Only"):
 *   - K2 Plus (FDM): a CadQuery part exported via Send-to-CAM lands in
 *     the active plate ready for OrcaSlicer; a desync between
 *     `cad.export` and the host's `stlStage` would either silently
 *     drop the design or upload the previous run's STL.
 *   - Laguna Swift 5x10 (RichAuto A-series): same path, except the
 *     hand-off feeds the OCL toolpath generator. A wrong-order call
 *     would slice yesterday's STL on today's stock.
 *   - Makera Carvera + 4-axis: same path, except the hand-off lands
 *     into a rotary-stock job. A wrong-order call would post-process
 *     the previous part with the new operation list — the worst
 *     possible regression because the operator never sees the swap.
 */

import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  DesignWorkspace,
  STARTER_SCRIPT,
  buildDesignOutputStlPath,
  performSendToCam,
  type SendToCamOutcome
} from '../DesignWorkspace'
import type {
  CadExecuteScriptMesh,
} from '../../../shared/sidecar-protocol'
import type { CadExportResponse } from '../../../main/ipc-cad'

// ── Fixtures ───────────────────────────────────────────────────────────────

function fakeMesh(overrides: Partial<CadExecuteScriptMesh> = {}): CadExecuteScriptMesh {
  return {
    handle: 'script:abcdef',
    stlPath: '/tmp/wt-cad-session/output.stl',
    triangleCount: 12,
    bbox: { min: [0, 0, 0], max: [10, 10, 10] },
    ...overrides
  }
}

function okExport(outPath: string, bytesWritten = 684): CadExportResponse {
  return { ok: true, result: { outPath, bytesWritten } }
}

function errExport(error: string, hint?: string): CadExportResponse {
  return { ok: false, error, ...(hint !== undefined ? { hint } : {}) }
}

// ── (A) Module shape ───────────────────────────────────────────────────────

describe('DesignWorkspace — UNIFY 1 module surface', () => {
  it('exports DesignWorkspace, STARTER_SCRIPT, buildDesignOutputStlPath, performSendToCam', () => {
    expect(typeof DesignWorkspace).toBe('function')
    expect(typeof STARTER_SCRIPT).toBe('string')
    expect(typeof buildDesignOutputStlPath).toBe('function')
    expect(typeof performSendToCam).toBe('function')
  })

  it('STARTER_SCRIPT mentions cadquery so the empty-state seeded script actually runs', () => {
    expect(STARTER_SCRIPT).toContain('import cadquery as cq')
    expect(STARTER_SCRIPT).toContain('show_object(')
  })
})

// ── (B) buildDesignOutputStlPath — pure path-derivation pin ────────────────

describe('buildDesignOutputStlPath — design-output path contract', () => {
  it('keeps the parent directory of the source STL', () => {
    const out = buildDesignOutputStlPath('/tmp/wt-cad/output.stl')
    expect(out.startsWith('/tmp/wt-cad/')).toBe(true)
    expect(out.endsWith('.stl')).toBe(true)
  })

  it('uses the design-output-{stamp}-{rand}.stl filename convention', () => {
    const out = buildDesignOutputStlPath('/tmp/output.stl')
    // /tmp/design-output-{base36-stamp}-{6-char-rand}.stl
    expect(out).toMatch(/\/design-output-[0-9a-z]+-[0-9a-z]{6}\.stl$/)
  })

  it('preserves POSIX separators on POSIX-style input', () => {
    const out = buildDesignOutputStlPath('/var/folders/x/wt/output.stl')
    expect(out.startsWith('/var/folders/x/wt/')).toBe(true)
    // No backslashes leak into a POSIX path.
    expect(out.includes('\\')).toBe(false)
  })

  it('preserves Windows separators on Windows-style input', () => {
    const out = buildDesignOutputStlPath('C:\\Users\\jrr\\AppData\\Local\\Temp\\output.stl')
    expect(out.startsWith('C:\\Users\\jrr\\AppData\\Local\\Temp\\')).toBe(true)
    // No forward-slashes leak into a Windows path.
    expect(out.includes('/')).toBe(false)
  })

  it('handles a bare filename (no separators) by emitting a relative path', () => {
    const out = buildDesignOutputStlPath('output.stl')
    expect(out).toMatch(/^design-output-[0-9a-z]+-[0-9a-z]{6}\.stl$/)
  })

  it('generates a unique filename across rapid-fire calls (no collision)', () => {
    const seen = new Set<string>()
    for (let i = 0; i < 50; i++) {
      seen.add(buildDesignOutputStlPath('/tmp/output.stl'))
    }
    // At least 90% of the calls produced distinct filenames — random
    // suffix means we tolerate a small collision rate but it should
    // be far below 50 / 50.
    expect(seen.size).toBeGreaterThanOrEqual(45)
  })
})

// ── (C) performSendToCam — call-order pin (the load-bearing contract) ──────

describe('performSendToCam — export + handoff call order', () => {
  it('invokes cadExport FIRST, then onSendToCam — never the other way', async () => {
    const mesh = fakeMesh()
    const callOrder: string[] = []
    const cadExport = vi.fn(async (payload: {
      handle: string
      outPath: string
      format: 'stl'
    }): Promise<CadExportResponse> => {
      callOrder.push('cad.export')
      // Echo the outPath the caller asked for so onSendToCam receives it.
      return okExport(payload.outPath)
    })
    const onSendToCam = vi.fn(() => {
      callOrder.push('onSendToCam')
    })
    const outcome = await performSendToCam(mesh, cadExport, onSendToCam)
    expect(outcome.ok).toBe(true)
    expect(callOrder).toEqual(['cad.export', 'onSendToCam'])
  })

  it('passes the mesh handle through to cad.export verbatim', async () => {
    const mesh = fakeMesh({ handle: 'script:zzz999' })
    const cadExport = vi.fn(async (payload): Promise<CadExportResponse> => {
      return okExport(payload.outPath)
    })
    await performSendToCam(mesh, cadExport, vi.fn())
    expect(cadExport).toHaveBeenCalledTimes(1)
    expect(cadExport.mock.calls[0][0].handle).toBe('script:zzz999')
  })

  it('always requests format: "stl"', async () => {
    const mesh = fakeMesh()
    const cadExport = vi.fn(async (payload): Promise<CadExportResponse> => {
      return okExport(payload.outPath)
    })
    await performSendToCam(mesh, cadExport, vi.fn())
    expect(cadExport.mock.calls[0][0].format).toBe('stl')
  })

  it('generates the outPath in the same directory as the source STL', async () => {
    const mesh = fakeMesh({ stlPath: '/var/wt-cad/output.stl' })
    const cadExport = vi.fn(async (payload): Promise<CadExportResponse> => {
      return okExport(payload.outPath)
    })
    await performSendToCam(mesh, cadExport, vi.fn())
    const requestedPath = cadExport.mock.calls[0][0].outPath
    expect(requestedPath.startsWith('/var/wt-cad/')).toBe(true)
    expect(requestedPath).toMatch(/design-output-/)
  })

  it('forwards the sidecar-echoed outPath into onSendToCam', async () => {
    const mesh = fakeMesh()
    // The sidecar MAY canonicalize the path (e.g. resolve symlinks).
    // The hand-off MUST use the echoed value, not the value we asked
    // for — otherwise the CAM workspace can stage a stale path.
    const sidecarEchoed = '/var/wt-cad/canonical-output.stl'
    const cadExport = vi.fn(async (): Promise<CadExportResponse> => {
      return okExport(sidecarEchoed)
    })
    const onSendToCam = vi.fn()
    await performSendToCam(mesh, cadExport, onSendToCam)
    expect(onSendToCam).toHaveBeenCalledTimes(1)
    expect(onSendToCam.mock.calls[0][0].stlPath).toBe(sidecarEchoed)
    expect(onSendToCam.mock.calls[0][0].mesh).toBe(mesh)
  })

  it('does NOT invoke onSendToCam when cad.export returns ok: false', async () => {
    const mesh = fakeMesh()
    const cadExport = vi.fn(async (): Promise<CadExportResponse> => {
      return errExport('sidecar_error', 'CadQuery raised during export')
    })
    const onSendToCam = vi.fn()
    const outcome = await performSendToCam(mesh, cadExport, onSendToCam)
    expect(outcome.ok).toBe(false)
    if (outcome.ok === false) {
      expect(outcome.error).toBe('sidecar_error')
      expect(outcome.hint).toBe('CadQuery raised during export')
    }
    expect(onSendToCam).not.toHaveBeenCalled()
  })

  it('surfaces the underlying error code/hint untouched on failure', async () => {
    const mesh = fakeMesh()
    const cadExport = vi.fn(async (): Promise<CadExportResponse> => {
      return errExport('invalid_handle')
    })
    const outcome: SendToCamOutcome = await performSendToCam(mesh, cadExport, vi.fn())
    expect(outcome).toEqual({ ok: false, error: 'invalid_handle' })
  })

  it('runs cad.export exactly once even when onSendToCam throws synchronously', async () => {
    const mesh = fakeMesh()
    const cadExport = vi.fn(async (payload): Promise<CadExportResponse> => {
      return okExport(payload.outPath)
    })
    const onSendToCam = vi.fn(() => {
      throw new Error('host crashed during handoff')
    })
    // The helper does NOT swallow host-callback errors — they bubble
    // up to the component's outer try/catch so the operator sees the
    // toast. We just verify cad.export still ran exactly once.
    await expect(performSendToCam(mesh, cadExport, onSendToCam)).rejects.toThrow(
      'host crashed during handoff'
    )
    expect(cadExport).toHaveBeenCalledTimes(1)
  })
})

// ── (D) Component render contract ──────────────────────────────────────────

describe('DesignWorkspace — Send-to-CAM button render contract', () => {
  it('renders the Send-to-CAM button when onSendToCam is supplied', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onSendToCam: vi.fn()
      })
    )
    expect(html).toContain('data-testid="design-workspace-send-to-cam"')
    expect(html).toContain('Send to CAM')
  })

  it('hides the Send-to-CAM button when onSendToCam is omitted', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT
      })
    )
    expect(html).not.toContain('design-workspace-send-to-cam')
  })

  it('Send-to-CAM is disabled when no mesh has been built yet', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onSendToCam: vi.fn()
      })
    )
    // No lastTessellation in state → firstMesh is null → disabled.
    expect(html).toMatch(/data-testid="design-workspace-send-to-cam"[^>]*disabled/)
  })

  it('Send-to-CAM uses the .btn .btn-primary primitive classes', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onSendToCam: vi.fn()
      })
    )
    expect(html).toMatch(/class="btn btn-primary"[^>]*data-testid="design-workspace-send-to-cam"/)
  })

  it('renders the three-pane layout when initialScript is non-empty', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, {
        initialScript: STARTER_SCRIPT,
        onSendToCam: vi.fn()
      })
    )
    expect(html).toContain('design-workspace__editor-col')
    expect(html).toContain('design-workspace__viewport-col')
    expect(html).toContain('design-workspace__tree-col')
  })

  it('renders the empty-state branch when no script and no tessellation', () => {
    const html = renderToStaticMarkup(
      createElement(DesignWorkspace, { initialScript: '' })
    )
    // Empty-state reuses the shared EmptyState component (CLAUDE.md rule).
    expect(html).toContain('data-testid="design-workspace-empty"')
    expect(html).toContain('Start a parametric design')
  })

  it('does not throw and produces no console errors on a typical render', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { /* swallow */ })
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ })
    try {
      renderToStaticMarkup(
        createElement(DesignWorkspace, {
          initialScript: STARTER_SCRIPT,
          onSendToCam: vi.fn(),
          onToast: vi.fn()
        })
      )
      expect(errSpy).not.toHaveBeenCalled()
      expect(warnSpy).not.toHaveBeenCalled()
    } finally {
      errSpy.mockRestore()
      warnSpy.mockRestore()
    }
  })
})
