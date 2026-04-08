import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import type { ViewKind } from '../src/shop-types'
import { loadWindowState, saveWindowState } from '../src/window-state'

const LEFT_PANEL_DEFAULT = 264
const LEFT_PANEL_MIN = 180
const LEFT_PANEL_MAX = 500

type UIContextValue = {
  view: ViewKind
  setView: (v: ViewKind) => void
  cmdOpen: boolean
  setCmdOpen: React.Dispatch<React.SetStateAction<boolean>>
  showShortcuts: boolean
  setShowShortcuts: React.Dispatch<React.SetStateAction<boolean>>
  helpOpen: boolean
  setHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  showOnboarding: boolean
  setShowOnboarding: React.Dispatch<React.SetStateAction<boolean>>
  logOpen: boolean
  setLogOpen: React.Dispatch<React.SetStateAction<boolean>>
  gcodeViewerOpen: boolean
  setGcodeViewerOpen: React.Dispatch<React.SetStateAction<boolean>>
  leftPanelWidth: number
  setLeftPanelWidth: (w: number) => void
  savedIndicator: boolean
  setSavedIndicator: React.Dispatch<React.SetStateAction<boolean>>
}

const Ctx = createContext<UIContextValue | null>(null)

export function UIProvider({ children }: { children: ReactNode }) {
  const ws = loadWindowState()
  const VIEW_KINDS: ViewKind[] = ['jobs', 'library', 'settings']
  const restoredView: ViewKind = VIEW_KINDS.includes(ws.view as ViewKind) ? (ws.view as ViewKind) : 'jobs'

  const [view, setViewRaw] = useState<ViewKind>(restoredView)
  const setView = useCallback((v: ViewKind) => { setViewRaw(v); saveWindowState({ view: v }) }, [])

  const [cmdOpen, setCmdOpen] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [savedIndicator, setSavedIndicator] = useState(false)

  const [logOpen, setLogOpenRaw] = useState(ws.logOpen ?? false)
  const setLogOpen: React.Dispatch<React.SetStateAction<boolean>> = useCallback(
    (v: boolean | ((prev: boolean) => boolean)) => {
      setLogOpenRaw(prev => {
        const next = typeof v === 'function' ? v(prev) : v
        saveWindowState({ logOpen: next })
        return next
      })
    }, [])

  const [gcodeViewerOpen, setGcodeViewerOpen] = useState(false)

  const [leftPanelWidth, setLeftPanelWidthRaw] = useState(
    typeof ws.leftPanelWidth === 'number' && ws.leftPanelWidth >= LEFT_PANEL_MIN && ws.leftPanelWidth <= LEFT_PANEL_MAX
      ? ws.leftPanelWidth
      : LEFT_PANEL_DEFAULT
  )
  const setLeftPanelWidth = useCallback((w: number) => {
    const clamped = Math.max(LEFT_PANEL_MIN, Math.min(LEFT_PANEL_MAX, Math.round(w)))
    setLeftPanelWidthRaw(clamped)
    saveWindowState({ leftPanelWidth: clamped })
  }, [])

  return (
    <Ctx.Provider value={{
      view, setView,
      cmdOpen, setCmdOpen,
      showShortcuts, setShowShortcuts,
      helpOpen, setHelpOpen,
      showOnboarding, setShowOnboarding,
      logOpen, setLogOpen,
      gcodeViewerOpen, setGcodeViewerOpen,
      leftPanelWidth, setLeftPanelWidth,
      savedIndicator, setSavedIndicator,
    }}>
      {children}
    </Ctx.Provider>
  )
}

export function useUI(): UIContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useUI must be used within UIProvider')
  return ctx
}
