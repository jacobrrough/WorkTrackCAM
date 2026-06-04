import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { useUI } from '../contexts/UIContext'
import { applyTheme } from '../theme/useTheme'
import { THEMES } from '../theme/theme-registry'
import type { WorkspaceId } from './useWorkspaceRouter'

/**
 * Command-palette wrapper for the new WorkTrack3D shell.
 *
 * ## Why this file inlines `CommandPalette`
 * The shell pivot has TWO components named `CommandPalette`:
 *
 *  1. `src/renderer/commands/CommandPalette.tsx` — the *exported* one. Its real
 *     props are `{ open, onClose, onPick }` and it renders over the static
 *     `FUSION_STYLE_COMMAND_CATALOG`; it does **not** accept a caller-supplied
 *     `commands` array. So it cannot be driven by a hand-built command list.
 *  2. A module-private `CommandPalette` inside `ShopApp.tsx` (~line 625) whose
 *     props are exactly `{ commands: Command[]; onClose: () => void }` with
 *     element shape `{ id, group, label, icon, action }`. That is the contract
 *     this new shell wants — but it is not exported and cannot be imported.
 *
 * The agreed contract for this file is to render
 * `<CommandPalette commands={...} onClose={() => setCmdOpen(false)} />` against
 * the `{ id, group, label, icon?, action }` element shape. To honor that exactly
 * without editing any other file, the matching presentational palette is inlined
 * below — a faithful copy of the ShopApp private component's prop contract and
 * keyboard/grouping behavior. When the legacy `ShopApp` palette is eventually
 * extracted into a shared export, swap the local definition for that import; the
 * `ShellCommand` shape and the JSX usage are already identical.
 */

/** Element shape consumed by the palette (mirrors ShopApp's private `Command`). */
export interface ShellCommand {
  id: string
  group: string
  label: string
  /** Optional leading glyph (emoji / symbol). Defaults to a neutral dot. */
  icon?: string
  action: () => void
}

/**
 * Presentational command palette. Self-contained copy of the legacy ShopApp
 * palette's contract: `{ commands, onClose }`, fuzzy filter over label+group,
 * grouped listbox, arrow-key navigation, Enter to run, Esc to close.
 */
function CommandPalette({
  commands,
  onClose
}: {
  commands: ShellCommand[]
  onClose: () => void
}): ReactElement {
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    )
  }, [query, commands])
  useEffect(() => {
    setActiveIdx(0)
  }, [filtered.length])

  const groups = useMemo(() => {
    const map = new Map<string, ShellCommand[]>()
    for (const c of filtered) {
      const a = map.get(c.group) ?? []
      a.push(c)
      map.set(c.group, a)
    }
    return map
  }, [filtered])

  const handleKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1))
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    }
    if (e.key === 'Enter') {
      filtered[activeIdx]?.action()
      onClose()
    }
    if (e.key === 'Escape') onClose()
  }

  const hl = (text: string, q: string): React.ReactNode => {
    if (!q.trim()) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx < 0) return text
    return (
      <>
        {text.slice(0, idx)}
        <mark className="cmd-highlight">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    )
  }

  let gi = 0
  return (
    <div
      className="cmd-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
      onClick={onClose}
    >
      <div className="cmd-box" onClick={(e) => e.stopPropagation()}>
        <div className="cmd-input-row">
          <span className="cmd-icon" aria-hidden="true">
            {'⌘'}
          </span>
          <input
            type="text"
            ref={inputRef}
            className="cmd-input"
            placeholder={'Type a command…'}
            aria-label="Search commands"
            role="combobox"
            aria-expanded={filtered.length > 0}
            aria-autocomplete="list"
            aria-controls="cmd-results-list"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
          />
          <kbd className="cmd-esc-hint" aria-hidden="true">
            Esc
          </kbd>
        </div>
        <div className="cmd-results" id="cmd-results-list" role="listbox">
          {filtered.length === 0 && <div className="text-muted cmd-empty">No commands match</div>}
          {Array.from(groups.entries()).map(([group, cmds]) => (
            <Fragment key={group}>
              <div className="cmd-group-label" role="presentation">
                {group}
              </div>
              {cmds.map((cmd) => {
                const myIdx = gi++
                return (
                  <div
                    key={cmd.id}
                    role="option"
                    aria-selected={myIdx === activeIdx}
                    className={`cmd-item${myIdx === activeIdx ? ' cmd-item--active' : ''}`}
                    onMouseEnter={() => setActiveIdx(myIdx)}
                    onClick={() => {
                      cmd.action()
                      onClose()
                    }}
                  >
                    <span className="cmd-item-icon" aria-hidden="true">
                      {cmd.icon ?? '•'}
                    </span>
                    <span className="cmd-item-label">{hl(cmd.label, query)}</span>
                  </div>
                )
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Human-readable label per workspace (mirrors `WorkspaceNav` labels). */
const WORKSPACE_LABELS: Readonly<Record<WorkspaceId, string>> = {
  design: 'Design',
  assemble: 'Assemble',
  manufacture: 'Make',
  drawings: 'Drawings',
  workshop: 'Workshop',
  utilities: 'Utilities'
}

/** Stable iteration order for the "Go to <Workspace>" rows. */
const WORKSPACE_ORDER: readonly WorkspaceId[] = [
  'design',
  'assemble',
  'manufacture',
  'drawings',
  'workshop',
  'utilities'
]

/**
 * New-shell command palette. Renders nothing unless `useUI().cmdOpen` is true.
 * Builds the command list (navigation, settings, help, theme switching) and
 * feeds it to the presentational {@link CommandPalette}. Every action also
 * closes the palette via `setCmdOpen(false)`.
 */
export function NewShellCommandPalette({
  onNavigate,
  onOpenSettings,
  onOpenHelp
}: {
  onNavigate: (w: WorkspaceId) => void
  onOpenSettings: () => void
  onOpenHelp: () => void
}): ReactElement | null {
  const { cmdOpen, setCmdOpen } = useUI()

  const close = (): void => setCmdOpen(false)

  const commands = useMemo<ShellCommand[]>(() => {
    const c: ShellCommand[] = []

    // Navigation — one "Go to <Workspace>" per WorkspaceId.
    for (const id of WORKSPACE_ORDER) {
      c.push({
        id: `goto_${id}`,
        group: 'Navigate',
        label: `Go to ${WORKSPACE_LABELS[id]}`,
        icon: '\u{1F9ED}', // compass
        action: () => {
          onNavigate(id)
          setCmdOpen(false)
        }
      })
    }

    // App-level overlays.
    c.push({
      id: 'open_settings',
      group: 'App',
      label: 'Open Settings',
      icon: '⚙', // gear
      action: () => {
        onOpenSettings()
        setCmdOpen(false)
      }
    })
    c.push({
      id: 'open_help',
      group: 'App',
      label: 'Open Help',
      icon: '❓', // question mark
      action: () => {
        onOpenHelp()
        setCmdOpen(false)
      }
    })

    // Theme switching — one row per registered theme.
    for (const theme of THEMES) {
      c.push({
        id: `theme_${theme.id}`,
        group: 'Theme',
        label: `Switch theme: ${theme.label}`,
        icon: '\u{1F3A8}', // palette
        action: () => {
          applyTheme(theme.id)
          setCmdOpen(false)
        }
      })
    }

    return c
  }, [onNavigate, onOpenSettings, onOpenHelp, setCmdOpen])

  if (!cmdOpen) return null

  return <CommandPalette commands={commands} onClose={close} />
}
