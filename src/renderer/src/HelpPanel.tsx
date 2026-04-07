/**
 * HelpPanel -- Slide-out reference panel with keyboard shortcuts,
 * CAM terminology glossary, operation descriptions, and workflow tips.
 *
 * Triggered by F1 or the Help toolbar button. Reads shortcuts from
 * the shared shortcut registry for an always-current reference.
 */
import React, { useState } from 'react'
import { APP_KEYBOARD_SHORTCUT_GROUPS } from '../../shared/app-keyboard-shortcuts'

// ── Section tab type ─────────────────────────────────────────────────────────
type HelpTab = 'shortcuts' | 'glossary' | 'operations' | 'tips'

const HELP_TABS: { id: HelpTab; label: string; icon: string }[] = [
  { id: 'shortcuts',  label: 'Shortcuts',  icon: '\u2328' },
  { id: 'glossary',   label: 'Glossary',   icon: '\u{1F4D6}' },
  { id: 'operations', label: 'Operations', icon: '\u2699' },
  { id: 'tips',       label: 'Tips',       icon: '\u{1F4A1}' },
]

// ── CAM glossary entries ─────────────────────────────────────────────────────
const GLOSSARY: { term: string; definition: string }[] = [
  { term: 'Feed Rate', definition: 'Speed at which the cutter moves laterally through the material, measured in mm/min. Higher feed rates increase MRR but can cause chatter.' },
  { term: 'Plunge Rate', definition: 'Speed at which the cutter descends into the material along the Z axis, typically slower than feed rate to reduce tool deflection.' },
  { term: 'Stepover', definition: 'Lateral distance between adjacent passes. Expressed in mm or as a percentage of tool diameter. Smaller stepover = finer finish.' },
  { term: 'Depth of Cut (DOC)', definition: 'Vertical distance the tool cuts per pass (Z step). Deeper cuts remove more material but increase tool load.' },
  { term: 'Safe Z', definition: 'Height above the stock where rapid moves occur without risk of collision. Typically 5-10 mm above the top of the stock.' },
  { term: 'WCS (Work Coordinate System)', definition: 'The coordinate origin used to align the machine with the workpiece. Usually set at the top-center or corner of the stock.' },
  { term: 'Stock', definition: 'The raw material block from which the part is machined. Defined by X, Y, Z dimensions in mm.' },
  { term: 'Toolpath', definition: 'The calculated path the cutting tool follows. Generated from operations and converted to G-code.' },
  { term: 'Post-Processor', definition: 'Converts internal toolpath data to machine-specific G-code dialect (e.g., Grbl, LinuxCNC, Mach3).' },
  { term: 'MRR (Material Removal Rate)', definition: 'Volume of material removed per unit time. Depends on DOC, stepover, and feed rate.' },
  { term: 'Scallop Height', definition: 'Ridge height left between adjacent passes. Determined by tool geometry and stepover distance.' },
  { term: 'Rest Machining', definition: 'A finishing technique that only machines areas left uncut by a larger previous tool.' },
  { term: 'Adaptive Clearing', definition: 'A roughing strategy that maintains constant tool engagement for consistent chip load and reduced tool wear.' },
  { term: 'Climb vs. Conventional Milling', definition: 'Climb milling feeds with the cutter rotation (preferred for CNC). Conventional feeds against it.' },
  { term: 'Chuck Depth', definition: 'How far the stock extends into the rotary chuck for 4-axis work. Affects machinable length.' },
]

// ── Operation descriptions ───────────────────────────────────────────────────
const OPERATIONS: { kind: string; name: string; description: string }[] = [
  { kind: 'cnc_parallel',        name: 'Parallel',         description: 'Roughing or finishing with parallel linear passes across the stock. Good general-purpose 2.5D strategy.' },
  { kind: 'cnc_contour',         name: 'Contour',          description: 'Follows the outline of a 2D profile at specified depths. Used for cutting parts from sheet stock.' },
  { kind: 'cnc_pocket',          name: 'Pocket',           description: 'Clears an enclosed area by spiraling inward or using a zigzag pattern. Used for cavities and recesses.' },
  { kind: 'cnc_drill',           name: 'Drill',            description: 'Plunges the tool straight down at specified points. Used for holes, pilot points, and through-holes.' },
  { kind: 'cnc_adaptive',        name: 'Adaptive',         description: 'High-efficiency roughing that maintains constant tool engagement. Reduces tool wear and allows faster feeds.' },
  { kind: 'cnc_waterline',       name: 'Waterline',        description: '3D finishing strategy using horizontal slices at constant Z levels. Best for steep walls.' },
  { kind: 'cnc_raster',          name: 'Raster',           description: '3D finishing with parallel passes that follow the surface contour. Good for gently curved surfaces.' },
  { kind: 'cnc_pencil',          name: 'Pencil',           description: 'Traces along internal corners and fillets with a small tool. Used as a detail finishing pass.' },
  { kind: 'cnc_3d_rough',        name: '3D Roughing',      description: 'Bulk material removal for 3D parts with stock allowance. Leaves material for finishing passes.' },
  { kind: 'cnc_3d_finish',       name: '3D Finishing',      description: 'Final surface pass for 3D parts. Combines raster, waterline, or pencil strategies for smooth results.' },
  { kind: 'cnc_4axis_roughing',  name: '4-Axis Roughing',  description: 'Rotary roughing for cylindrical/wrapped stock. Removes bulk material while rotating the A axis.' },
  { kind: 'cnc_4axis_finishing', name: '4-Axis Finishing',  description: 'Rotary finishing pass for smooth surface quality on 4-axis parts.' },
  { kind: 'cnc_4axis_contour',   name: '4-Axis Contour',   description: 'Profile cutting around rotary stock. Follows the part outline while rotating.' },
  { kind: 'cnc_4axis_indexed',   name: '4-Axis Indexed',   description: 'Machines at fixed rotary angles (e.g., 0/90/180/270). Combines 3-axis cutting at multiple orientations.' },
  { kind: 'fdm_slice',           name: 'FDM Slice',        description: 'Slices the model into layers for FDM 3D printing. Uses CuraEngine with configurable presets.' },
  { kind: 'export_stl',          name: 'Export STL',        description: 'Exports the staged STL model to a file. No machining parameters required.' },
]

// ── Workflow tips ─────────────────────────────────────────────────────────────
const TIPS: { title: string; body: string }[] = [
  {
    title: 'Recommended CNC workflow',
    body: '1. Select your machine from the splash screen.\n2. Import your STL model (drag-and-drop or browse).\n3. Set stock dimensions to match your raw material.\n4. Select a material to auto-calculate feeds and speeds.\n5. Add operations (roughing first, then finishing).\n6. Generate G-code and review the output.',
  },
  {
    title: 'Material auto-apply',
    body: 'When you select a material from the toolbar, cut parameters (feed rate, plunge rate, stepover, DOC) are automatically calculated based on the tool diameter and material properties. Use the lightning bolt button to re-apply after changing tools.',
  },
  {
    title: 'Fit model to stock',
    body: 'Press F in the viewport to auto-orient and scale your model to fit within the stock boundaries. Useful after importing a model with unknown dimensions.',
  },
  {
    title: 'Command palette',
    body: 'Press Ctrl+K to open the command palette. Search for any command, operation, machine, or material by typing part of its name.',
  },
  {
    title: 'Setup sheets',
    body: 'After generating G-code, click the clipboard icon in the toolbar to generate an HTML setup sheet. This includes all operation parameters, tool info, and G-code statistics for shop floor reference.',
  },
  {
    title: 'Viewport controls',
    body: 'G = Move, R = Rotate, S = Scale, F = Fit to stock, Esc = Deselect gizmo. Hold Shift while scrubbing a value label for 10x speed, or Ctrl for 0.1x precision.',
  },
  {
    title: 'Multi-operation jobs',
    body: 'Add multiple operations to a single job for complex parts. Operations run in order: rough first, then finish. Each operation can use a different tool from your library.',
  },
  {
    title: 'Saving and loading sessions',
    body: 'Use Ctrl+S to save your entire session (all jobs, operations, and settings) to a .fabsession file. Use Ctrl+O to reload it later. Jobs are also auto-saved to browser storage.',
  },
]


// ── Component ────────────────────────────────────────────────────────────────

export function HelpPanel({ onClose }: { onClose: () => void }): React.ReactElement {
  const [tab, setTab] = useState<HelpTab>('shortcuts')

  return (
    <div className="help-panel" role="complementary" aria-label="Help reference">
      <div className="help-panel__header">
        <span className="help-panel__title">Help Reference</span>
        <kbd className="help-panel__shortcut">F1</kbd>
        <div className="flex-spacer" />
        <button
          type="button"
          className="btn btn-ghost btn-sm btn-icon"
          onClick={onClose}
          aria-label="Close help panel"
          title="Close help panel"
        >
          {'\u2715'}
        </button>
      </div>

      <div className="help-panel__tabs" role="tablist" aria-label="Help sections">
        {HELP_TABS.map(t => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`help-panel__tab${tab === t.id ? ' help-panel__tab--active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            <span className="help-panel__tab-icon">{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      <div className="help-panel__body" role="tabpanel">
        {tab === 'shortcuts' && <ShortcutsSection />}
        {tab === 'glossary' && <GlossarySection />}
        {tab === 'operations' && <OperationsSection />}
        {tab === 'tips' && <TipsSection />}
      </div>
    </div>
  )
}

// ── Sub-sections ─────────────────────────────────────────────────────────────

function ShortcutsSection(): React.ReactElement {
  return (
    <div className="help-section">
      {APP_KEYBOARD_SHORTCUT_GROUPS.map(group => (
        <div key={group.id} className="help-shortcuts-group">
          <h3 className="help-section__subtitle">{group.title}</h3>
          <table className="help-shortcuts-table">
            <tbody>
              {group.rows.map((row, i) => (
                <tr key={i} className="help-shortcuts-table__row">
                  <td className="help-shortcuts-table__action">{row.action}</td>
                  <td className="help-shortcuts-table__keys">
                    <kbd className="shortcuts-kbd">{row.keysWin}</kbd>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div className="help-shortcuts-group">
        <h3 className="help-section__subtitle">Viewport</h3>
        <table className="help-shortcuts-table">
          <tbody>
            <tr className="help-shortcuts-table__row">
              <td className="help-shortcuts-table__action">Move gizmo</td>
              <td className="help-shortcuts-table__keys"><kbd className="shortcuts-kbd">G</kbd></td>
            </tr>
            <tr className="help-shortcuts-table__row">
              <td className="help-shortcuts-table__action">Rotate gizmo</td>
              <td className="help-shortcuts-table__keys"><kbd className="shortcuts-kbd">R</kbd></td>
            </tr>
            <tr className="help-shortcuts-table__row">
              <td className="help-shortcuts-table__action">Scale gizmo</td>
              <td className="help-shortcuts-table__keys"><kbd className="shortcuts-kbd">S</kbd></td>
            </tr>
            <tr className="help-shortcuts-table__row">
              <td className="help-shortcuts-table__action">Fit model to stock</td>
              <td className="help-shortcuts-table__keys"><kbd className="shortcuts-kbd">F</kbd></td>
            </tr>
            <tr className="help-shortcuts-table__row">
              <td className="help-shortcuts-table__action">Deselect gizmo</td>
              <td className="help-shortcuts-table__keys"><kbd className="shortcuts-kbd">Esc</kbd></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GlossarySection(): React.ReactElement {
  const [filter, setFilter] = useState('')
  const terms = filter.trim()
    ? GLOSSARY.filter(g =>
        g.term.toLowerCase().includes(filter.toLowerCase()) ||
        g.definition.toLowerCase().includes(filter.toLowerCase())
      )
    : GLOSSARY

  return (
    <div className="help-section">
      <input
        type="text"
        className="help-search-input"
        placeholder="Filter terms\u2026"
        value={filter}
        onChange={e => setFilter(e.target.value)}
      />
      <dl className="help-glossary">
        {terms.map(g => (
          <div key={g.term} className="help-glossary__entry">
            <dt className="help-glossary__term">{g.term}</dt>
            <dd className="help-glossary__def">{g.definition}</dd>
          </div>
        ))}
        {terms.length === 0 && (
          <div className="text-muted help-glossary__empty">No terms match your filter.</div>
        )}
      </dl>
    </div>
  )
}

function OperationsSection(): React.ReactElement {
  return (
    <div className="help-section">
      <div className="help-ops-list">
        {OPERATIONS.map(op => (
          <div key={op.kind} className="help-ops-item">
            <div className="help-ops-item__name">{op.name}</div>
            <div className="help-ops-item__desc">{op.description}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function TipsSection(): React.ReactElement {
  return (
    <div className="help-section">
      {TIPS.map((tip, i) => (
        <details key={i} className="help-tip" open={i === 0}>
          <summary className="help-tip__title">{tip.title}</summary>
          <div className="help-tip__body">
            {tip.body.split('\n').map((line, j) => (
              <p key={j} className="help-tip__line">{line}</p>
            ))}
          </div>
        </details>
      ))}
    </div>
  )
}
