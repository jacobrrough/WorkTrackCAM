---
name: wire-feature-dialog
description: >
  Surface a built-but-dialog-less CAD kernel op as a reachable Fusion-style feature dialog. Use when
  wiring Tier-1 parity work from docs/PARITY-ROADMAP.md (loft, sweep, pipe, coil, thread, pattern-along-path,
  sheet-metal, boolean-combine, transform/move-copy) — i.e. a kernel op that ALREADY produces geometry in
  engines/occt/build_part.py but has no Properties-pane dialog or ribbon command. Also use for any new
  feature dialog. Encodes the exact schema→dialog→host-wiring→DOM-test→gate pattern so every dialog is
  consistent and verified by real interaction, not source pins.
---

# Wire a feature dialog

Turns an orphaned kernel op into a reachable dialog. The geometry already works; this is UI wiring +
verification. **Do NOT invent kernel geometry here** — if the op doesn't exist in `build_part.py`,
this is the wrong skill (that's a backend cycle). Honesty rule (CLAUDE.md): never fake a capability —
render disabled placeholders with a note if part of the op isn't exposed yet (see `ExtrudeDialog`).

## 0. Confirm the op is real (preflight)
- Find the op handler in `engines/occt/build_part.py` (`_OP_DISPATCH` dict) and its schema in
  `src/shared/part-features-schema.ts`. Note its exact params.
- Decide the emit **target** (`src/renderer/design/feature-dialogs/feature-dialog-types.ts`):
  - `kernelOp` — the op is a member of `KernelPostSolidOp` (fillet/chamfer/shell/hole/pattern/…). The
    dialog emits `{ target: 'kernelOp', op }`; the host appends it via `appendKernelOp`. Template:
    `FilletDialog.tsx` + its `buildFilletOp()` op-builder.
  - `scriptParams` — the value drives a CadQuery script parameter (extrude depth, revolve angle), no
    kernelOp variant. Emits `{ target: 'scriptParams', params }`. Template: `ExtrudeDialog.tsx`.

## 1. Build the dialog component
`src/renderer/design/feature-dialogs/<Name>Dialog.tsx`, mirroring the template above. Use ONLY the kit
in `FeatureDialogKit.tsx` (`FeatureDialogCard`, `DialogNumberField`, `DialogSelectField`,
`DialogApplyRow`) — they carry the `data-testid`s the DOM test needs (testId lands on the `<input>`/
button directly). Props come from `FeatureDialogBaseProps` (`selectionInfo`, `onApply`, `busy`,
`disabled`). Parse numerics with `parsePositiveMm` / `parseFiniteMm` / `parseClampedInt`. For a
`kernelOp` dialog, add a pure `build<Name>Op(params, selection?)` that returns the typed op.

## 2. Wire it into the host (the 5 seams)
1. `feature-dialog-types.ts` — add the kind to the `FeatureDialogKind` union + `FEATURE_DIALOG_COMMAND_ID`.
2. `feature-dialogs/FeatureDialogHost.tsx` — add a `case` that renders `<NameDialog>` for the kind.
3. `DesignWorkspace.tsx` — add a branch in the `featureDialogSpec` `useMemo` that seeds the dialog's
   opening params (read current script params via the `numericParam(...)` helper where relevant).
4. `app/DesignWorkspaceHost.tsx` — add the catalog id → kind entry in `FEATURE_DIALOG_KIND_BY_COMMAND`
   so the ribbon's `openFeatureDialog(catalogId)` opens it.
5. `commands/design-commands.ts` — ensure a ribbon command dispatches `openFeatureDialog` for it.

The picker was retired (features open from the ribbon → `requestedFeatureDialog` → `activeFeatureDialog`);
the dialog card carries its own ✕ close. Don't reintroduce an in-panel launcher.

## 3. Verify with REAL interaction (not source pins)
- **DOM interaction test** — `feature-dialogs/__tests__/<Name>Dialog.dom.spec.tsx`. Copy
  `ExtrudeDialog.dom.spec.tsx`: render the dialog, `userEvent.type` a value, `click` Apply, assert the
  exact `onApply` payload; add a test that Apply is gated on invalid input. Run `npm run test:dom`.
- **Op-builder unit test** (kernelOp dialogs) — pure `*.test.ts` asserting `build<Name>Op` returns the
  right typed op for given params.
- The host wiring (catalog id → kind → spec) — a node-env source/render pin if behaviour isn't
  DOM-reachable (mirror `DesignWorkspace.feature-dialogs.test.tsx`).

## 4. Gates (all must pass before commit)
- `npm run typecheck` — clean.
- `npm run test:dom` — the new interaction test green.
- `npm test` — full node suite, zero regressions.
- No G-code touched ⇒ the `gcode-safety` skill does NOT apply (this is CAD, not CAM).

## Scope discipline
One dialog per pass (or a tight batch of closely-related ones). Match the surrounding code's comment
density + honesty notes. Don't refactor the kit or the host beyond the 5 seams.
