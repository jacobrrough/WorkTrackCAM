# UI/UX Rebuild — tabbed IA + minimal/guided

Tracking doc for the renderer UI/UX rebuild. Full plan:
`~/.claude/plans/completely-start-over-on-jaunty-snowglobe.md`.

## Goal

Replace the confusing 3-enum navigation (EnvironmentSplash gate → NavRail
`NavSection` → UIContext `ViewKind` → per-panel `panelTab`) with ONE
**pro tabbed layout** (Home · Prepare · Manufacture · Output · Library) whose
content is **minimal & guided** (few controls, progressive disclosure via
"Advanced" expanders, big primary actions). Backend (`window.fab` IPC + Zod
schemas + slice/CAM/calibration/nesting/send) is reused untouched.

## Phase 0 recon findings (verified against `main`)

**Live shell (what the user sees on `npm run dev`):**
`main.tsx` → `ShopApp.tsx` (2,389 L) → EnvironmentSplash gate → `cc-shell`
→ AppHeader + NavRail (jobs/tools/workshop/myshop/library/settings) +
LeftPanel | inline tools panel | **WorkshopDashboard** (the one wired-in rich
surface) + ViewportArea + OpSequencer + PropertyPanel + Library/Settings/MyShop
drawers + overlays.

**ORPHANED rich surfaces (built by agents, imported by NOTHING in
`src/renderer/src/`, so currently unreachable in the live app):**
- `manufacture/ManufactureWorkspace.tsx` + ~20 siblings (Fusion-style CAM)
- `manufacture/ManufactureOperationList.tsx` (full 25-op-kind editor)
- `manufacture/CalibrationPanel.tsx` (K2 8-test calibration suite)
- `manufacture/LagunaNestingPanel.tsx` (true-shape nesting)
- `manufacture/PlateTabs.tsx` + multi-plate (`plate-state.ts`)
- multi-setup wizard, CAM simulation panel

→ The rebuild's biggest *functional* win is wiring these into the new tabs
(Manufacture / Output / Library), not just re-skinning.

**Nav enums to unify:** `NavSection` (NavRail), `ViewKind` (UIContext —
only `'jobs'` still read), `ManufacturePanelTab` (demote to internal),
`phase:'splash'|'app'` (collapse to always-`'app'` + Home empty-state).

**Pin-test safety:** no `shop-app-*-pin` source-text pin exists; the 23
renderer `readFileSync` pins target helpers (env-routing, registry, useUndo,
window-state, setup-sheet, stock-bounds, moonraker-payload, brand-bar badge).
Decomposing ShopApp will NOT break source pins; update per-phase as surfaces move.

**Design system:** keep `tokens.css` + `primitives/{Button,IconButton,Badge,
Spinner,Tooltip}`. Drain `workspace.css` (4,654 L) per tab. Kill fragmented
button classes (`.tb-btn`, `.cc-header__*-btn`) once Grep shows 0 usages.

## Feature flag

`ufs_shell_v3` localStorage flag (helpers in `shell/workspaceMemory.ts`):
- OFF (default, Phases 1-4): legacy EnvironmentSplash + cc-shell.
- ON: new AppShell with tabbed IA.
- Phase 5 flips default ON; Phase 6 removes the flag + legacy shell.

## Phase tracker

- [x] **Phase 0** — recon + `ufs_shell_v3` flag + this doc.
- [ ] **Phase 1** — `useShopState` extraction + `AppShell` + `WorkspaceTabBar` +
  `workspace-tabs.ts` SSOT + header machine dropdown (behind flag).
- [ ] **Phase 2** — Prepare tab (import + SharedViewport + stock/setup + orient).
- [ ] **Phase 3** — Manufacture tab (wire orphaned op list/plates/sim) + retire NavRail/ViewKind.
- [ ] **Phase 4** — Output tab (preview + Send/export) + single SharedViewport.
- [ ] **Phase 5** — Home + Library tabs (wire calibration/nesting) + flip flag ON + drop splash.
- [ ] **Phase 6** — delete legacy shell + CSS cleanup + remove flag.
