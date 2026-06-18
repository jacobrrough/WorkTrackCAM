/**
 * WorkspaceHost — onboarding Design-seed wiring pins.
 *
 * The "Start a parametric design" onboarding card reads the machine-specific
 * bundled CAD sample (`wizard:readCadSample`) and AppShell stashes its
 * `scriptText` in `seedDesignScript`, handing it down here. This host owns the
 * design-session script state (`designScript` → `DesignWorkspaceHost.initialScript`),
 * so it is the only place that can inject the starter into the editor — and it
 * must do so WITHOUT clobbering a loaded project's on-disk sketch or a manual
 * in-session edit.
 *
 * The seed effect gates on the CAD-first boot case (queued script + no project +
 * editor still on the generic STARTER_SCRIPT) and bumps the DesignWorkspaceHost
 * remount token (DesignWorkspace seeds its editor from `initialScript` mount-only,
 * so a remount is what loads the new script), then acks via `onSeedDesignConsumed`.
 *
 * WorkspaceHost stands up the full CAD provider chain (DesignSessionProvider +
 * the command context), impractical under the node-env `renderToStaticMarkup`
 * harness — so, exactly like the sibling `AppShell.*` wiring pins, the WIRING is
 * source-pinned here while the pure handoff seams live in
 * `workspace-host-handoff.test.ts`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(join(__dirname, '..', 'WorkspaceHost.tsx'), 'utf-8')

describe('WorkspaceHost — onboarding Design-seed wiring', () => {
  it('declares the optional seedDesignScript + onSeedDesignConsumed props', () => {
    expect(SRC).toContain('seedDesignScript = null,')
    expect(SRC).toContain('onSeedDesignConsumed')
    expect(SRC).toContain('seedDesignScript?: string | null')
    expect(SRC).toContain('onSeedDesignConsumed?: () => void')
  })

  it('gates the seed to the CAD-first boot case (queued + no project + untouched editor)', () => {
    expect(SRC).toContain('if (seedDesignScript == null) return')
    // Never overwrite a loaded project's on-disk sketch.
    expect(SRC).toContain('if (projectDir !== null) return')
    // Never clobber a manual edit made before the seed lands.
    expect(SRC).toContain('if (designScript !== STARTER_SCRIPT) return')
  })

  it('injects the script + bumps the remount token + acks consumption', () => {
    expect(SRC).toContain('setDesignScript(seedDesignScript)')
    // The DesignWorkspaceHost key includes hydrateToken; bumping it remounts the
    // host so DesignWorkspace re-seeds its (mount-only) editor from initialScript.
    expect(SRC).toContain('setHydrateToken((t) => t + 1)')
    expect(SRC).toContain('onSeedDesignConsumed?.()')
  })

  it('lists the load-bearing deps on the seed effect', () => {
    expect(SRC).toContain('}, [seedDesignScript, projectDir, designScript, onSeedDesignConsumed])')
  })

  it('still feeds designScript into the DesignWorkspaceHost as initialScript', () => {
    // The seed lands via the SAME initialScript path the manual STARTER_SCRIPT
    // default uses — the effect just changes which string designScript holds.
    expect(SRC).toContain('initialScript={designScript}')
    expect(SRC).toContain('key={`design-${active}-${hydrateToken}`}')
  })
})
