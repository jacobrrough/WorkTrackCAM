/**
 * FG-1 · React layer for the Context Engine.
 *
 * `command-engine.ts` is pure (no React) so it unit-tests in the `node` vitest
 * env. This file is the thin React adapter that:
 *   1. Aggregates the three *separate* live contexts into one
 *      {@link CommandContext}:
 *        - workspace   ← the `useWorkspaceRouter` instance AppShell owns
 *                        (passed in, so there is exactly one router)
 *        - machineKind ← `useMachineSession().sessionMachine` → env registry
 *                        (`getEnvironmentForMachine`) → `deriveMachineKind`
 *        - selection / sketch mode ← pushed up from the Design workspace via
 *                        {@link useCommandSurface} (the Design layer calls the
 *                        returned setter; until then the defaults are "none").
 *   2. Exposes {@link useCommandContext} (read the aggregated context) and
 *      {@link useResolvedCommands} (the ribbon/palette join).
 *   3. Owns the {@link DeepLinkRouter} so a handler can `navigate + arm`.
 *
 * Why selection/sketch are *pushed up* instead of read from a shared selection
 * context: today selection + sketch-stage live as local `useState` inside
 * `DesignWorkspace` (`design/selection-state.ts` is pure; there is no selection
 * *context provider*). Rather than hoist that large component's state in this
 * cycle, the provider holds a small "surface" cell that the Design layer
 * updates through a stable setter. That keeps FG-1 self-contained and the
 * mechanism demonstrably live, and leaves a clean seam for Wave 2 to wire the
 * real viewport selection straight in.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode
} from 'react'
import type { WorkspaceId } from '../app/useWorkspaceRouter'
import { useMachineSession } from '../contexts/MachineSessionContext'
import { getEnvironmentForMachine } from '../src/environments/env-routing'
import {
  type CommandContext,
  type DeepLinkRequest,
  type DeepLinkRouter,
  type ResolveCommandsOptions,
  type ResolvedCommand,
  type ResolvedCommandGroup,
  deriveMachineKind,
  resolveCommandGroups,
  resolveCommands,
  runCommand as runCommandOnRegistry
} from './command-engine'

/**
 * The mutable "surface" the Design workspace pushes selection + sketch-mode
 * into. Kept tiny and serializable so it is cheap to update from a render-loop.
 */
export interface CommandSurfaceState {
  readonly hasSelection: boolean
  readonly selectionKind?: string
  readonly sketchMode?: boolean
}

const EMPTY_SURFACE: CommandSurfaceState = { hasSelection: false }

interface CommandContextValue {
  /** The aggregated, live command context. */
  readonly context: CommandContext
  /** Run a command id against the current aggregated context. */
  readonly run: (id: string) => boolean
  /** Deep-link: switch workspace then arm a tool. */
  readonly deepLink: DeepLinkRouter
  /** Push selection / sketch-mode up from a workspace (stable identity). */
  readonly setSurface: (next: CommandSurfaceState) => void
  /** Resolve catalog × handlers × enablement for the current context. */
  readonly resolve: (opts?: ResolveCommandsOptions) => ResolvedCommand[]
  /** Resolve + group by ribbon for the current context (ribbon entry point). */
  readonly resolveGroups: (opts?: ResolveCommandsOptions) => ResolvedCommandGroup[]
}

const Ctx = createContext<CommandContextValue | null>(null)

export interface CommandContextProviderProps {
  /** Active shell workspace (from the AppShell-owned `useWorkspaceRouter`). */
  readonly workspace: WorkspaceId
  /** Switch the shell workspace (the same router's `setActiveWorkspace`). */
  readonly onNavigate: (workspace: WorkspaceId) => void
  /**
   * Arm a tool in the (already-navigated) target workspace. Optional: when
   * absent, a deep-link only navigates. Wave 2 wires this to the Design
   * workspace's sketch/constraint tool arming.
   */
  readonly onArmTool?: (toolId: string, workspace: WorkspaceId) => void
  readonly children: ReactNode
}

/**
 * Provider that aggregates the live contexts and exposes the engine to the
 * subtree. Mount it high in the shell (around `WorkspaceHost`) so every
 * workspace, the ribbon, and the palette share one context + one registry.
 */
export function CommandContextProvider({
  workspace,
  onNavigate,
  onArmTool,
  children
}: CommandContextProviderProps): ReactElement {
  const { sessionMachine } = useMachineSession()
  const [surface, setSurfaceState] = useState<CommandSurfaceState>(EMPTY_SURFACE)

  // Derive machineKind from the active machine via its shop environment. The
  // environment is the authoritative router/mill4/fdm signal (a bare `cnc`
  // kind cannot separate the Laguna router from the Carvera mill).
  const machineKind = useMemo(() => {
    const env = getEnvironmentForMachine(sessionMachine?.id ?? null)
    return deriveMachineKind(env?.id ?? null)
  }, [sessionMachine?.id])

  const context = useMemo<CommandContext>(
    () => ({
      workspace,
      machineKind,
      hasSelection: surface.hasSelection,
      selectionKind: surface.selectionKind,
      sketchMode: surface.sketchMode
    }),
    [workspace, machineKind, surface.hasSelection, surface.selectionKind, surface.sketchMode]
  )

  // Keep a ref to the freshest context so the stable `run` / `deepLink`
  // identities always dispatch against current state (handlers fired from a
  // long-lived palette closure must see up-to-date selection/workspace).
  const ctxRef = useRef(context)
  ctxRef.current = context

  const setSurface = useCallback((next: CommandSurfaceState) => {
    setSurfaceState((prev) =>
      prev.hasSelection === next.hasSelection &&
      prev.selectionKind === next.selectionKind &&
      prev.sketchMode === next.sketchMode
        ? prev
        : next
    )
  }, [])

  const run = useCallback((id: string): boolean => runCommandOnRegistry(id, ctxRef.current), [])

  const deepLink = useMemo<DeepLinkRouter>(
    () => ({
      navigateAndArm: (request: DeepLinkRequest) => {
        onNavigate(request.workspace)
        if (request.armToolId && onArmTool) {
          onArmTool(request.armToolId, request.workspace)
        }
      }
    }),
    [onNavigate, onArmTool]
  )

  // `resolve` / `resolveGroups` read the freshest context via `ctxRef`, so they
  // can be stable (no deps). Consumers recompute because the context value
  // object below is re-memoized on `context`, which changes their `engine` dep.
  const resolve = useCallback((opts?: ResolveCommandsOptions) => resolveCommands(ctxRef.current, opts), [])
  const resolveGroups = useCallback(
    (opts?: ResolveCommandsOptions) => resolveCommandGroups(ctxRef.current, opts),
    []
  )

  const value = useMemo<CommandContextValue>(
    () => ({ context, run, deepLink, setSurface, resolve, resolveGroups }),
    [context, run, deepLink, setSurface, resolve, resolveGroups]
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

function useCommandEngineValue(): CommandContextValue {
  const ctx = useContext(Ctx)
  if (!ctx) {
    throw new Error('useCommandContext must be used within a <CommandContextProvider>')
  }
  return ctx
}

/**
 * Read the aggregated {@link CommandContext} (workspace ∪ machineKind ∪
 * selection ∪ sketch mode). The primary hook consumers use to know "what is the
 * operator doing right now".
 */
export function useCommandContext(): CommandContext {
  return useCommandEngineValue().context
}

/**
 * Full engine handle: the context plus `run`, `deepLink`, `setSurface`, and the
 * resolve helpers. Use this when a surface needs to dispatch commands or push
 * selection state up (e.g. the palette, the ribbon, the Design workspace).
 */
export function useCommandEngine(): CommandContextValue {
  return useCommandEngineValue()
}

/**
 * Push selection / sketch-mode up into the command context. Returns the stable
 * setter; call it from a workspace whenever its selection or sketch stage
 * changes. (Wave 2 calls this from the mounted viewport's selection flow.)
 */
export function useCommandSurface(): (next: CommandSurfaceState) => void {
  return useCommandEngineValue().setSurface
}

/**
 * The ribbon/palette join: catalog × registered handlers × computed enablement,
 * filtered to a context and grouped by ribbon group.
 *
 * Defaults to the *current* aggregated context (the common case — the ribbon
 * renders for "now"). Pass an explicit `ctx` to resolve for a hypothetical
 * context (tests, previews). `opts.filterByWorkspace = false` resolves the
 * whole catalog regardless of route (the global palette).
 */
export function useResolvedCommands(
  ctx?: CommandContext,
  opts?: ResolveCommandsOptions
): ResolvedCommandGroup[] {
  const engine = useCommandEngineValue()
  const explicit = ctx ?? null
  return useMemo(() => {
    if (explicit) return resolveCommandGroups(explicit, opts)
    return engine.resolveGroups(opts)
  }, [explicit, engine, opts])
}
