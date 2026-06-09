/**
 * Pin: the consume-once contract of the Design → Manufacture STL hand-off
 * mailbox (`cam-handoff-store`), which `CamHandoffContext` wraps behind a React
 * provider. The renderer test env is node (no DOM renderer), so the load-bearing
 * state machine is pinned here directly — exactly the way `design-ribbon-go-live`
 * pins the command action bag without React.
 *
 * Contract:
 *   - set → consume returns the queued request AND clears the slot,
 *   - a second consume returns null (consume-once / idempotent),
 *   - a malformed (blank stlPath) set is rejected and never clobbers a queued
 *     valid request,
 *   - the latest valid set wins,
 *   - clear empties the slot without consuming,
 *   - the onChange notifier fires on every slot change (so the React provider's
 *     setState mirror stays in sync).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  createCamHandoffStore,
  normalizePendingCamImport,
  type PendingCamImport
} from '../cam-handoff-store'

describe('normalizePendingCamImport', () => {
  it('keeps a non-empty stlPath and a non-blank sourceName', () => {
    expect(normalizePendingCamImport({ stlPath: '/tmp/a.stl', sourceName: 'Widget' })).toEqual({
      stlPath: '/tmp/a.stl',
      sourceName: 'Widget'
    })
  })

  it('drops a blank sourceName to a minimal object', () => {
    expect(normalizePendingCamImport({ stlPath: '/tmp/a.stl', sourceName: '   ' })).toEqual({
      stlPath: '/tmp/a.stl'
    })
    expect(normalizePendingCamImport({ stlPath: '/tmp/a.stl' })).toEqual({ stlPath: '/tmp/a.stl' })
  })

  it('rejects a missing / blank stlPath', () => {
    expect(normalizePendingCamImport({ stlPath: '' })).toBeNull()
    expect(normalizePendingCamImport({ stlPath: '   ' })).toBeNull()
    // Defensive: a malformed runtime payload missing the field entirely.
    expect(normalizePendingCamImport({} as PendingCamImport)).toBeNull()
  })
})

describe('createCamHandoffStore — consume-once', () => {
  it('starts empty', () => {
    const store = createCamHandoffStore()
    expect(store.get()).toBeNull()
    expect(store.consume()).toBeNull()
  })

  it('set → consume returns the request and clears the slot', () => {
    const store = createCamHandoffStore()
    expect(store.set({ stlPath: '/tmp/part.stl', sourceName: 'Bracket' })).toBe(true)
    expect(store.get()).toEqual({ stlPath: '/tmp/part.stl', sourceName: 'Bracket' })

    const first = store.consume()
    expect(first).toEqual({ stlPath: '/tmp/part.stl', sourceName: 'Bracket' })
    // Slot is now empty…
    expect(store.get()).toBeNull()
    // …and a second consume yields null (consume-once).
    expect(store.consume()).toBeNull()
  })

  it('rejects a malformed set without disturbing a queued valid request', () => {
    const store = createCamHandoffStore()
    store.set({ stlPath: '/tmp/good.stl' })
    expect(store.set({ stlPath: '   ' })).toBe(false)
    // The good request is still queued.
    expect(store.get()).toEqual({ stlPath: '/tmp/good.stl' })
    expect(store.consume()).toEqual({ stlPath: '/tmp/good.stl' })
  })

  it('latest valid set wins', () => {
    const store = createCamHandoffStore()
    store.set({ stlPath: '/tmp/a.stl', sourceName: 'A' })
    store.set({ stlPath: '/tmp/b.stl', sourceName: 'B' })
    expect(store.consume()).toEqual({ stlPath: '/tmp/b.stl', sourceName: 'B' })
  })

  it('clear empties the slot without consuming', () => {
    const store = createCamHandoffStore()
    store.set({ stlPath: '/tmp/a.stl' })
    store.clear()
    expect(store.get()).toBeNull()
    expect(store.consume()).toBeNull()
  })
})

describe('createCamHandoffStore — onChange notifier', () => {
  it('fires with the new value on set, and with null on consume + clear', () => {
    const onChange = vi.fn<(next: PendingCamImport | null) => void>()
    const store = createCamHandoffStore(onChange)

    store.set({ stlPath: '/tmp/a.stl', sourceName: 'A' })
    expect(onChange).toHaveBeenLastCalledWith({ stlPath: '/tmp/a.stl', sourceName: 'A' })

    store.consume()
    expect(onChange).toHaveBeenLastCalledWith(null)

    store.set({ stlPath: '/tmp/b.stl' })
    store.clear()
    expect(onChange).toHaveBeenLastCalledWith(null)

    // set(rejected) must NOT notify.
    onChange.mockClear()
    store.set({ stlPath: '' })
    expect(onChange).not.toHaveBeenCalled()

    // clear() on an already-empty slot must NOT notify.
    store.clear()
    expect(onChange).not.toHaveBeenCalled()
  })
})
