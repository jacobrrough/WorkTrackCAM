/**
 * FG-4b · Palette row model — the pure join that the live shell palette renders.
 *
 * The live `NewShellCommandPalette` used to hand-list ~17 rows. This module is
 * the pure (no-React) core that lets it render the **entire** command surface
 * through one code path:
 *   - the synthetic *shell* commands (workspace navigation, Settings/Help/Theme)
 *     described by {@link ShellCommandMeta} / `SHELL_COMMANDS`, and
 *   - every {@link FusionStyleCommand} in `FUSION_STYLE_COMMAND_CATALOG`, joined
 *     with its registered handler + computed enablement by the Context Engine
 *     ({@link ResolvedCommand} from `resolveCommands`).
 *
 * Both collapse into one {@link PaletteRow} so the palette's filter / recency /
 * keyboard model operate uniformly. A catalog row with no registered handler is
 * still listed (it carries its parity `status`) but is reported `enabled: false`
 * so the UI greys it out — the honest "shows but not wired yet" contract from
 * the Context Engine, surfaced to the operator.
 *
 * Kept React-agnostic (same tenet as `command-palette-search.ts` /
 * `command-engine.ts`) so it unit-tests in the existing `node` vitest env.
 */

import type {
  CommandParityStatus,
  FusionStyleCommand
} from '../../shared/fusion-style-command-catalog'
import { COMMAND_CATALOG_RIBBON_FILTER_OPTIONS } from '../../shared/fusion-style-command-catalog'
import type { ResolvedCommand } from './command-engine'
import type { ShellCommandMeta } from './starter-commands'
import { orderRowsByRecent, rowMatchesPaletteQuery } from './command-palette-search'

/**
 * A single renderable palette row. Unifies a synthetic shell command and a
 * resolved catalog command so the palette has one row type to filter, order,
 * highlight, and dispatch.
 */
export interface PaletteRow {
  /** Command id dispatched through the engine (`runCommand(id, ctx)`). */
  readonly id: string
  /** User-visible label. */
  readonly label: string
  /** Section header the row groups under (e.g. `'Navigate'`, `'Solid · Create'`). */
  readonly group: string
  /** Leading glyph (shell rows carry one; catalog rows fall back to a dot). */
  readonly icon?: string
  /** Right-aligned context line (catalog: `workspace · CREATE`). */
  readonly meta?: string
  /** Parity status badge — catalog rows only; shell actions are always live. */
  readonly status?: CommandParityStatus
  /** False ⇒ greyed/disabled (no handler, or `enabled(ctx)` returned false). */
  readonly enabled: boolean
  /** True when a handler is registered (regardless of `enabled`). */
  readonly hasHandler: boolean
  /** Display-only keybinding hint, when the handler declares one. */
  readonly keybinding?: string
}

/** Section label for the synthetic shell rows is taken from their `group`. */
const RIBBON_LABEL = new Map<string, string>(
  COMMAND_CATALOG_RIBBON_FILTER_OPTIONS.map((o) => [o.id, o.label])
)

/** Human label for a catalog ribbon group (falls back to the raw key). */
export function ribbonGroupLabel(ribbon: FusionStyleCommand['ribbon']): string {
  return RIBBON_LABEL.get(ribbon) ?? ribbon
}

/** Map a shell-command metadata row into a {@link PaletteRow} (always enabled). */
export function shellRow(meta: ShellCommandMeta): PaletteRow {
  return {
    id: meta.id,
    label: meta.label,
    group: meta.group,
    icon: meta.icon,
    enabled: true,
    hasHandler: true
  }
}

/** Map a resolved catalog command into a {@link PaletteRow}. */
export function catalogRow(resolved: ResolvedCommand): PaletteRow {
  const { command, handler, enabled, hasHandler } = resolved
  const meta = command.fusionRibbon
    ? `${command.workspace} · ${command.fusionRibbon}`
    : command.workspace
  return {
    id: command.id,
    label: command.label,
    group: ribbonGroupLabel(command.ribbon),
    meta,
    status: command.status,
    enabled,
    hasHandler,
    keybinding: handler?.keybinding
  }
}

/** A `FusionStyleCommand`-shaped view of a row, for reuse of the search helpers. */
function asSearchRow(row: PaletteRow): FusionStyleCommand {
  return {
    id: row.id,
    label: row.label,
    // The search haystack joins label/id/ribbon/fusionRibbon/notes; feed the
    // section label + meta through those slots so shell rows ("Go to Design",
    // "Switch theme: …") and catalog rows match the same way.
    ribbon: 'inspect',
    workspace: 'utilities',
    status: row.status ?? 'planned',
    fusionRibbon: row.group,
    notes: row.meta
  }
}

/** Inputs to {@link buildPaletteRows}. */
export interface BuildPaletteRowsInput {
  /** Synthetic shell rows (navigation / app / theme). */
  readonly shell: readonly ShellCommandMeta[]
  /** Resolved catalog commands (catalog × handlers × enablement). */
  readonly catalog: readonly ResolvedCommand[]
  /** Current search text. */
  readonly query: string
  /** Recent command ids (most-recent first); promotes rows on an empty query. */
  readonly recentIds: readonly string[]
  /**
   * When true, drop catalog rows whose parity status is not `implemented`.
   * Shell rows are always kept (they are real, live actions). Default behavior
   * is decided by the caller; the live palette defaults this **off** so the full
   * catalog (and the honest greying of unwired ids) is visible.
   */
  readonly implementedOnly: boolean
}

/**
 * Build the ordered, filtered, deduplicated palette row list. Pure: same inputs
 * → same output, no DOM, no storage.
 *
 * Order of operations:
 *   1. Project shell + catalog into {@link PaletteRow}s.
 *   2. Apply the `implementedOnly` gate to catalog rows (shell rows are exempt).
 *   3. Apply the shared fuzzy/alias query matcher (`rowMatchesPaletteQuery`).
 *   4. On an empty query, promote recently-run rows to the top
 *      (`orderRowsByRecent`).
 *
 * Shell rows are listed before catalog rows so the familiar navigation / theme
 * actions stay at the top when no query is typed (recency can still pull a
 * catalog row above them once it has been run).
 */
export function buildPaletteRows(input: BuildPaletteRowsInput): PaletteRow[] {
  const { shell, catalog, query, recentIds, implementedOnly } = input

  const rows: PaletteRow[] = [
    ...shell.map(shellRow),
    ...catalog
      .filter((r) => (implementedOnly ? r.command.status === 'implemented' : true))
      .map(catalogRow)
  ]

  const qEmpty = query.trim() === ''
  const matched = rows.filter((row) => rowMatchesPaletteQuery(asSearchRow(row), query))

  if (qEmpty) {
    // Reuse the recency ordering by round-tripping through the search-row shape,
    // then map the promoted ids back to their PaletteRow.
    const byId = new Map(matched.map((r) => [r.id, r]))
    const promoted = orderRowsByRecent(
      matched.map(asSearchRow),
      [...recentIds],
      true
    )
    return promoted.map((r) => byId.get(r.id)).filter((r): r is PaletteRow => r !== undefined)
  }
  return matched
}

/**
 * Group rows by their `group` label, preserving first-seen group order and
 * intra-group order. Mirrors the legacy palette's section grouping so the UX is
 * unchanged, just over the full surface.
 */
export interface PaletteRowGroup {
  readonly group: string
  readonly rows: PaletteRow[]
}

export function groupPaletteRows(rows: readonly PaletteRow[]): PaletteRowGroup[] {
  const order: string[] = []
  const byGroup = new Map<string, PaletteRow[]>()
  for (const row of rows) {
    let bucket = byGroup.get(row.group)
    if (!bucket) {
      bucket = []
      byGroup.set(row.group, bucket)
      order.push(row.group)
    }
    bucket.push(row)
  }
  return order.map((group) => ({ group, rows: byGroup.get(group) ?? [] }))
}
