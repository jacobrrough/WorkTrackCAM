/**
 * App-level keyboard shortcuts (shell / palette / cross-workspace).
 * Keep in sync with `docs/KEYBOARD_SHORTCUTS.md` narrative; this file is the source for the in-app table.
 */

export type AppShortcutGroup = {
  id: string
  title: string
  rows: { action: string; keysWin: string; keysMac: string; context?: string }[]
}

/**
 * Sketch S3 -- shared context copy for the sketch-canvas hotkey rows. The
 * handler is strictly canvas-scoped: it fires only while the sketch canvas
 * wrap is hovered or holds focus, and never while a typable control has
 * focus (`isTypableKeyboardTarget` gate).
 */
export const SKETCH_CANVAS_HOTKEY_CONTEXT =
  'Sketch canvas only - while the canvas is hovered or focused; ignored while typing in a field'

export const APP_KEYBOARD_SHORTCUT_GROUPS: AppShortcutGroup[] = [
  {
    id: 'global',
    title: 'Global',
    rows: [
      {
        action: 'Command palette — search / run catalog entries',
        keysWin: 'Ctrl+K',
        keysMac: '⌘K',
        context: 'Toggle open/closed'
      },
      {
        action: 'Keyboard shortcuts (this reference)',
        keysWin: 'Ctrl+Shift+?',
        keysMac: '⌘⇧?',
        context: 'Opens shortcuts dialog; ignored while focus is in a text field'
      },
      {
        action: 'New project',
        keysWin: 'Ctrl+N',
        keysMac: '⌘N',
        context: 'Resets to a blank project; prompts to save unsaved changes'
      },
      {
        action: 'Open project file',
        keysWin: 'Ctrl+O',
        keysMac: '⌘O',
        context: 'Opens file picker; ignored while focus is in a text field'
      },
      {
        action: 'Save project file',
        keysWin: 'Ctrl+S',
        keysMac: '⌘S',
        context: 'Saves current session; ignored while focus is in a text field'
      },
      {
        action: 'Generate G-code / Slice',
        keysWin: 'F5 or Ctrl+Enter',
        keysMac: 'F5 or ⌘↩',
        context: 'Jobs view only; disabled while a generation is running'
      },
      {
        action: 'Undo last change',
        keysWin: 'Ctrl+Z',
        keysMac: '⌘Z',
        context: 'Ignored while focus is in a text field'
      },
      {
        action: 'Redo last undone change',
        keysWin: 'Ctrl+Y or Ctrl+Shift+Z',
        keysMac: '⌘⇧Z',
        context: 'Ignored while focus is in a text field'
      }
    ]
  },
  {
    id: 'navrail',
    title: 'Workspaces',
    rows: [
      {
        action: 'Design',
        keysWin: '1',
        keysMac: '1',
        context: 'Ignored while focus is in a text field or a dialog is open'
      },
      {
        action: 'Assemble',
        keysWin: '2',
        keysMac: '2',
        context: 'Ignored while focus is in a text field or a dialog is open'
      },
      {
        action: 'Make',
        keysWin: '3',
        keysMac: '3',
        context: 'Ignored while focus is in a text field or a dialog is open'
      },
      {
        action: 'Drawings',
        keysWin: '4',
        keysMac: '4',
        context: 'Ignored while focus is in a text field or a dialog is open'
      },
      {
        action: 'Workshop',
        keysWin: '5',
        keysMac: '5',
        context: 'Ignored while focus is in a text field or a dialog is open'
      },
      {
        action: 'Utilities',
        keysWin: '6',
        keysMac: '6',
        context: 'Ignored while focus is in a text field or a dialog is open'
      },
      {
        action: 'Help panel',
        keysWin: 'F1',
        keysMac: 'F1',
        context: 'Toggle open/closed'
      }
    ]
  },
  {
    id: 'palette',
    title: 'While command palette is open',
    rows: [
      { action: 'Close palette', keysWin: 'Esc', keysMac: 'Esc' },
      { action: 'Move selection', keysWin: '↑ / ↓', keysMac: '↑ / ↓' },
      { action: 'Page through results', keysWin: 'PgUp / PgDn', keysMac: 'PgUp / PgDn' },
      { action: 'Jump to first / last result', keysWin: 'Home / End', keysMac: 'Home / End' },
      { action: 'Run highlighted command', keysWin: 'Enter', keysMac: 'Return' },
      {
        action: 'Move focus between search, filters, and results',
        keysWin: 'Tab',
        keysMac: 'Tab',
        context: 'Focus wraps inside the palette'
      }
    ]
  },
  {
    id: 'file_tabs',
    title: 'File workspace (tab strip)',
    rows: [
      {
        action: 'Next / previous tab',
        keysWin: '← / → or ↑ / ↓',
        keysMac: '← / → or ↑ / ↓',
        context: 'When a File tab is focused (Project, Settings)'
      },
      {
        action: 'First / last tab',
        keysWin: 'Home / End',
        keysMac: 'Home / End',
        context: 'File tab strip'
      }
    ]
  },
  {
    id: 'manufacture_tabs',
    title: 'Manufacture workspace (tab strip)',
    rows: [
      {
        action: 'Next / previous tab',
        keysWin: '← / → or ↑ / ↓',
        keysMac: '← / → or ↑ / ↓',
        context: 'When a Manufacture tab is focused (Plan, Slice, CAM, Tools)'
      },
      {
        action: 'First / last tab',
        keysWin: 'Home / End',
        keysMac: 'Home / End',
        context: 'Manufacture tab strip'
      }
    ]
  },
  {
    id: 'design',
    title: 'Design workspace',
    rows: [
      {
        action: 'Switch to Design environment (parametric CAD)',
        keysWin: 'Ctrl+Shift+D',
        keysMac: '⌘⇧D',
        context: 'Opens the CadQuery editor / FeatureTree workspace; ignored while focus is in a text field'
      },
      {
        action: 'Run CadQuery script',
        keysWin: 'Ctrl+Enter',
        keysMac: '⌘↩',
        context: 'When focused in the Design workspace script editor'
      },
      {
        action: 'Save CadQuery script',
        keysWin: 'Ctrl+S',
        keysMac: '⌘S',
        context:
          'Persists the Design script to disk; fires from the script editor or any non-typable Design surface (ignored while typing in another field)'
      },
      {
        action: 'Cancel constraint / pick point mode',
        keysWin: 'Esc',
        keysMac: 'Esc',
        context: 'After clicking a point/segment slot in the ribbon'
      },
      {
        action: 'Clear 3D Measure / Section picks',
        keysWin: 'Esc',
        keysMac: 'Esc',
        context: 'When Measure or Section is active under 3D preview'
      }
    ]
  },
  {
    id: 'sketch_canvas',
    title: 'Sketch canvas (2D sketcher)',
    rows: [
      { action: 'Select tool', keysWin: 'S', keysMac: 'S', context: SKETCH_CANVAS_HOTKEY_CONTEXT },
      {
        action: 'Polyline tool',
        keysWin: 'L',
        keysMac: 'L',
        context: SKETCH_CANVAS_HOTKEY_CONTEXT
      },
      {
        action: 'Rectangle tool',
        keysWin: 'R',
        keysMac: 'R',
        context: SKETCH_CANVAS_HOTKEY_CONTEXT
      },
      { action: 'Circle tool', keysWin: 'C', keysMac: 'C', context: SKETCH_CANVAS_HOTKEY_CONTEXT },
      {
        action: 'Arc (3-point) tool',
        keysWin: 'A',
        keysMac: 'A',
        context: SKETCH_CANVAS_HOTKEY_CONTEXT
      },
      {
        action: 'Ellipse tool',
        keysWin: 'E',
        keysMac: 'E',
        context: SKETCH_CANVAS_HOTKEY_CONTEXT
      },
      {
        action: 'Toggle object snap (OSNAP)',
        keysWin: 'F3',
        keysMac: 'F3',
        context: SKETCH_CANVAS_HOTKEY_CONTEXT
      },
      {
        action: 'Toggle grid snap',
        keysWin: 'G',
        keysMac: 'G',
        context: SKETCH_CANVAS_HOTKEY_CONTEXT
      }
    ]
  }
]

export function isTypableKeyboardTarget(el: EventTarget | null): boolean {
  if (el == null || typeof HTMLElement === 'undefined') return false
  if (!(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/** Heuristic for showing ⌘ vs Ctrl in UI copy (renderer / Electron). */
export function isLikelyApplePlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  const p = navigator.platform ?? ''
  const ua = navigator.userAgent ?? ''
  return /Mac|iPhone|iPad|iPod/i.test(p) || /Mac OS X/i.test(ua)
}

/** User-visible palette shortcut label (matches `APP_KEYBOARD_SHORTCUT_GROUPS` global rows). */
export function commandPaletteShortcutLabel(): 'Ctrl+K' | '⌘K' {
  return isLikelyApplePlatform() ? '⌘K' : 'Ctrl+K'
}

/** Toggle command palette (Ctrl+K / ⌘K). */
export function matchesCommandPaletteToggle(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k'
}

/** Open keyboard shortcuts reference (Ctrl+Shift+? / ⌘⇧?). */
export function matchesKeyboardShortcutsReference(e: KeyboardEvent): boolean {
  return (e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key === '?'
}

/** New project (Ctrl+N / ⌘N). */
export function matchesNewProject(e: KeyboardEvent): boolean {
  return !!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n'
}

/** Open project file (Ctrl+O / ⌘O). */
export function matchesOpenProject(e: KeyboardEvent): boolean {
  return !!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o'
}

/** Save project file (Ctrl+S / ⌘S). */
export function matchesSaveProject(e: KeyboardEvent): boolean {
  return !!(e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's'
}

/** Generate G-code / Slice (F5 or Ctrl+Enter / ⌘↩). Jobs view only. */
export function matchesGenerate(e: KeyboardEvent): boolean {
  if (e.key === 'F5' && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) return true
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === 'Enter') return true
  return false
}

/**
 * Undo (Ctrl+Z / ⌘Z). The bare Ctrl+Z (no Shift, no Alt) is the universal
 * industry-standard undo binding (Fusion 360, OrcaSlicer, every IDE, every
 * web app). Ctrl+Shift+Z is reserved for `matchesRedo`.
 */
export function matchesUndo(e: KeyboardEvent): boolean {
  return (
    !!(e.ctrlKey || e.metaKey) &&
    !e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'z'
  )
}

/**
 * Redo (Ctrl+Y or Ctrl+Shift+Z / ⌘⇧Z). Both bindings are industry standard:
 * Ctrl+Y comes from Windows/Office, Ctrl+Shift+Z comes from macOS/Adobe.
 * Most pro CAD apps (Fusion 360, SolidWorks, Mastercam) accept either.
 */
export function matchesRedo(e: KeyboardEvent): boolean {
  if (!(e.ctrlKey || e.metaKey)) return false
  if (e.altKey) return false
  if (!e.shiftKey && e.key.toLowerCase() === 'y') return true
  if (e.shiftKey && e.key.toLowerCase() === 'z') return true
  return false
}

/**
 * Switch to the Design environment (Ctrl+Shift+D / ⌘⇧D). The parametric
 * CAD workspace ships alongside the three machine environments — this
 * shortcut is the keyboard counterpart to the Design brand-bar button.
 * The handler should ignore the gesture while focus is in a text field
 * (so it does not hijack typing inside the CadQuery editor).
 */
export function matchesDesignEnvSwitch(e: KeyboardEvent): boolean {
  return (
    !!(e.ctrlKey || e.metaKey) &&
    e.shiftKey &&
    !e.altKey &&
    e.key.toLowerCase() === 'd'
  )
}

/** Tools reachable via the S3 single-key sketch hotkeys (a subset of the canvas SketchTool union). */
export type SketchCanvasHotkeyTool = 'select' | 'polyline' | 'rect' | 'circle' | 'arc' | 'ellipse'

/** What a matched sketch-canvas hotkey should do: arm a tool, or flip a snap toggle. */
export type SketchCanvasHotkeyAction =
  | { kind: 'tool'; tool: SketchCanvasHotkeyTool }
  | { kind: 'toggleOsnap' }
  | { kind: 'toggleGridSnap' }

/** Single-letter key -> sketch tool (AutoCAD / Fusion-style arming; Sketch S3). */
const SKETCH_TOOL_HOTKEY_MAP: Readonly<Partial<Record<string, SketchCanvasHotkeyTool>>> = {
  s: 'select',
  l: 'polyline',
  r: 'rect',
  c: 'circle',
  a: 'arc',
  e: 'ellipse'
}

/**
 * Sketch-canvas hotkeys (Sketch S3): plain S / L / R / C / A / E arm tools,
 * F3 toggles OSNAP (object snap), G toggles grid snap -- mapping onto the
 * EXISTING tool-arming + toggle state (no new behaviors). Any modifier chord
 * never matches (Ctrl+S stays Save, Ctrl+C stays copy, Shift is reserved for
 * gesture modifiers). The CALLER owns the canvas scoping: wrap hover/focus
 * plus the `isTypableKeyboardTarget` typing gate (see the
 * `sketch_canvas` rows in {@link APP_KEYBOARD_SHORTCUT_GROUPS}).
 */
export function matchesSketchCanvasHotkey(e: KeyboardEvent): SketchCanvasHotkeyAction | null {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null
  if (e.key === 'F3') return { kind: 'toggleOsnap' }
  if (e.key.length !== 1) return null
  const k = e.key.toLowerCase()
  if (k === 'g') return { kind: 'toggleGridSnap' }
  const tool = SKETCH_TOOL_HOTKEY_MAP[k]
  return tool ? { kind: 'tool', tool } : null
}
