import { useCallback, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import {
  readShellBrowserWidth,
  readShellPropertiesWidth,
  SHELL_BROWSER_MAX,
  SHELL_BROWSER_MIN,
  SHELL_PROPERTIES_MAX,
  SHELL_PROPERTIES_MIN,
  writeShellBrowserWidth,
  writeShellPropertiesWidth
} from './shellLayoutStorage'

function clampBrowser(n: number): number {
  return Math.min(SHELL_BROWSER_MAX, Math.max(SHELL_BROWSER_MIN, Math.round(n)))
}

function clampProperties(n: number): number {
  return Math.min(SHELL_PROPERTIES_MAX, Math.max(SHELL_PROPERTIES_MIN, Math.round(n)))
}

export function useShellResizableColumns(showProperties: boolean) {
  const [browserPx, setBrowserPx] = useState(readShellBrowserWidth)
  const [propertiesPx, setPropertiesPx] = useState(readShellPropertiesWidth)

  const browserPxRef = useRef(browserPx)
  browserPxRef.current = browserPx
  const propertiesPxRef = useRef(propertiesPx)
  propertiesPxRef.current = propertiesPx

  const onBrowserResizePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = browserPxRef.current

    const onMove = (ev: globalThis.PointerEvent) => {
      const delta = ev.clientX - startX
      setBrowserPx(clampBrowser(startW + delta))
    }
    const onUp = (ev: globalThis.PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('shell-col-resizing')
      writeShellBrowserWidth(browserPxRef.current)
    }

    document.body.classList.add('shell-col-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [])

  const onPropertiesResizePointerDown = useCallback((e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!showProperties) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startW = propertiesPxRef.current

    const onMove = (ev: globalThis.PointerEvent) => {
      const delta = startX - ev.clientX
      setPropertiesPx(clampProperties(startW + delta))
    }
    const onUp = (ev: globalThis.PointerEvent) => {
      el.releasePointerCapture(ev.pointerId)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      document.body.classList.remove('shell-col-resizing')
      writeShellPropertiesWidth(propertiesPxRef.current)
    }

    document.body.classList.add('shell-col-resizing')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [showProperties])

  return {
    browserPx,
    propertiesPx,
    onBrowserResizePointerDown,
    onPropertiesResizePointerDown
  }
}
