/**
 * Regression pins for the "sketches disappearing" bug (post-S3 hands-on report).
 *
 * ROOT CAUSE: `WorkspaceHost` mounted `<DesignSessionProvider onStatus={(m) =>
 * pushToast('ok', m)} />` — a NEW arrow identity every parent render. The
 * session's design-load effect listed `onStatus` in its dependency array and,
 * on every run, dispatched `{ type: 'replace', design: <on-disk> }`. Drawing a
 * vector only updates the in-memory reducer (it is not written to disk until an
 * explicit Save), so any re-render re-ran the load effect and replaced the live
 * design with the empty/old on-disk copy — silently wiping the sketch (and
 * cascading into "undo is broken" / "selection drops", since the model reset
 * underneath them).
 *
 * THE FIX (three layers, all pinned here):
 *   1. `designLoadKey(projectDir, rev)` — the load effect remembers the last key
 *      and SKIPS a redundant reload when it is unchanged, so even a spurious
 *      re-fire can never clobber unsaved edits. (Unit-tested below.)
 *   2. The effect reads `onStatus` through `onStatusRef` and no longer lists it
 *      as a dependency, so the churn that caused the re-fire is gone.
 *   3. `WorkspaceHost` memoizes `onStatus` (belt-and-suspenders).
 *
 * The renderer test env is `node` (no jsdom / @testing-library), so the effect
 * itself can't be mounted — the load-key SEMANTICS are unit-tested and the
 * effect/mount-site WIRING is source-pinned (the established convention here).
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { designLoadKey } from '../DesignSessionContext'

const SESSION_SRC = readFileSync(
  join(__dirname, '..', 'DesignSessionContext.tsx'),
  'utf-8'
)
const WORKSPACE_HOST_SRC = readFileSync(
  join(__dirname, '..', '..', 'app', 'WorkspaceHost.tsx'),
  'utf-8'
)

describe('designLoadKey — the anti-clobber identity', () => {
  it('no project open → null (nothing to load, nothing to clobber)', () => {
    expect(designLoadKey(null, 0)).toBeNull()
    expect(designLoadKey(null, undefined)).toBeNull()
    expect(designLoadKey(null, 7)).toBeNull()
  })

  it('same (projectDir, revision) → identical key (a re-render must NOT reload)', () => {
    const a = designLoadKey('/proj/alpha', 0)
    const b = designLoadKey('/proj/alpha', 0)
    expect(a).not.toBeNull()
    expect(a).toBe(b)
  })

  it('undefined revision is treated as 0 (stable across renders before any bump)', () => {
    expect(designLoadKey('/proj/alpha', undefined)).toBe(designLoadKey('/proj/alpha', 0))
  })

  it('a different project → different key (a genuine reload)', () => {
    expect(designLoadKey('/proj/alpha', 0)).not.toBe(designLoadKey('/proj/beta', 0))
  })

  it('a bumped disk revision → different key (a genuine reload after an external merge)', () => {
    expect(designLoadKey('/proj/alpha', 0)).not.toBe(designLoadKey('/proj/alpha', 1))
  })

  it('Windows-style paths with backslashes key cleanly (no escape collisions)', () => {
    const a = designLoadKey('C:\\Users\\jacob\\proj', 2)
    const b = designLoadKey('C:\\Users\\jacob\\proj', 2)
    expect(a).toBe(b)
    expect(a).not.toBe(designLoadKey('C:\\Users\\jacob\\proj2', 2))
  })
})

describe('load effect is stabilized against the inline-onStatus re-fire', () => {
  it('the load effect deps are exactly [fab, projectDir, designDiskRevision] — onStatus is GONE', () => {
    expect(SESSION_SRC).toContain('}, [fab, projectDir, designDiskRevision])')
    // The pre-fix dep array (with onStatus) must never come back.
    expect(SESSION_SRC).not.toContain('[fab, projectDir, onStatus, designDiskRevision]')
  })

  it('onStatus is read through a latest-value ref, not the prop, inside effects', () => {
    expect(SESSION_SRC).toContain('const onStatusRef = useRef(onStatus)')
    expect(SESSION_SRC).toContain('onStatusRef.current = onStatus')
    expect(SESSION_SRC).toContain("onStatusRef.current?.(errs.join(' · '))")
  })

  it('the load effect carries the (projectDir, revision) anti-clobber guard', () => {
    expect(SESSION_SRC).toContain('const loadKey = designLoadKey(projectDir, designDiskRevision)')
    expect(SESSION_SRC).toContain(
      'if (loadKey !== null && lastDesignLoadKeyRef.current === loadKey) return'
    )
    // …and resets the key when the project closes so reopening the SAME project reloads.
    expect(SESSION_SRC).toContain('lastDesignLoadKeyRef.current = null')
  })

  it('the asset-import effect no longer depends on onStatus identity either', () => {
    expect(SESSION_SRC).toContain('}, [projectDir, loaded, assetMeshPathsKey, fab])')
    expect(SESSION_SRC).not.toContain('[projectDir, loaded, assetMeshPathsKey, fab, onStatus]')
  })
})

describe('WorkspaceHost mounts the provider with a STABLE onStatus', () => {
  it('passes a memoized handler, not a fresh inline arrow', () => {
    expect(WORKSPACE_HOST_SRC).toContain('onStatus={handleDesignStatus}')
    expect(WORKSPACE_HOST_SRC).toContain(
      'const handleDesignStatus = useCallback((m: string) => pushToast(\'ok\', m), [pushToast])'
    )
    // The old churning form must be gone.
    expect(WORKSPACE_HOST_SRC).not.toContain('onStatus={(m) => pushToast(\'ok\', m)}')
  })
})
