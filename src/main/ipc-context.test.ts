import { describe, expect, it } from 'vitest'
import type { MainIpcWindowContext } from './ipc-context'

describe('ipc-context', () => {
  it('MainIpcWindowContext has a getMainWindow method', () => {
    const ctx: MainIpcWindowContext = {
      getMainWindow: () => null
    }
    expect(typeof ctx.getMainWindow).toBe('function')
    expect(ctx.getMainWindow()).toBeNull()
  })

  it('getMainWindow can return a window-like object', () => {
    const fakeWindow = { id: 1, isDestroyed: () => false } as unknown
    const ctx: MainIpcWindowContext = {
      getMainWindow: () => fakeWindow as ReturnType<MainIpcWindowContext['getMainWindow']>
    }
    expect(ctx.getMainWindow()).toBe(fakeWindow)
  })

  it('getMainWindow returns null when no window exists', () => {
    const ctx: MainIpcWindowContext = {
      getMainWindow: () => null
    }
    const result = ctx.getMainWindow()
    expect(result).toBeNull()
  })
})
