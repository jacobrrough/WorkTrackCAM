# Plan — CarveraCLI abort verb (watch + future wiring)

> **Stack:** D · **Status:** ⛔ Blocked (upstream) · **Effort:** S (watch now) / M (wire on unblock)
> **Machines:** Makera Carvera (3-axis + 4-axis) · **Created:** 2026-06-02 · **Owner:** Jacob · **Mode:** plan-only

The Carvera E-stop path is blocked: upstream `carvera-cli` exposes no abort/stop verb, so `machine:estop`
returns a structured advisory and the operator uses the physical E-stop. This plan **confirms the blocker**,
specifies the **exact wiring** for when upstream ships an abort verb, and sets up a **watch mechanism**. Do the
documentation/watch half now (S); defer the code half until the verb exists.

---

## 1. Current state

- **`src/main/ipc-machine.ts`:** `KNOWN_MACHINE_IDS` whitelist (`:64`). `carveraAbortFallback()` (`:179`)
  returns `{ ok:false, error:'no_cli_abort', hint:'Carvera abort wired but the CLI does not expose an abort
  command; physically e-stop the machine.' }`. `dispatchEstop()` (`:210`) branches per machine; the Carvera
  branch (`:230`) `console.warn`s + calls the fallback (never reaches `spawnBounded`). K2 path:
  `postMoonrakerEmergencyStop()` (`:110`) POSTs `/printer/emergency_stop` with a 3 s `AbortSignal.timeout`.
  Laguna: `lagunaNoRemoteAbort()` (`:195`) → `no_remote_abort`.
- **`src/renderer/src/AppHeader.tsx`:** E-stop button renders when `onEstop` + non-empty `currentMachineId`
  (`:236`); click → `onEstop` (`:275`), gated by a native confirm in `ShopApp.handleEstop`; the advisory vs
  success toast is chosen from `result.error === 'no_cli_abort'`.
- **`src/preload/index.ts`:** `window.fab.machine.estop` → `ipcRenderer.invoke('machine:estop', …)`
  (`:863–864`). **Doc bug:** `docs/MACHINES.md:184` cites `fab:estop` — the real channel is `machine:estop`.
- **`src/main/carvera-cli-run.ts`:** `buildCarveraUploadArgs()` (`:42`) puts global flags before the subcommand
  (`:63`); `carveraUpload()` (`:96`) uses `spawnBounded`. An abort verb follows the same shape.
- **Tests:** `ipc-machine.test.ts:224` pins the fallback (`ok:false`, `no_cli_abort`, `/physically e-stop/i`);
  `:287–300` pin `dispatchEstop` → `no_cli_abort` for both Carvera IDs. `carvera-cli-run-pin.test.ts` pins the
  upload argv exhaustively (groups A–J) — **no abort group yet** (correct; nothing to pin).
- **Upstream (researched 2026-06-02):** no public index hit for `hagmonk/carvera-cli`; no PyPI `carvera-cli`.
  `carvera-controller-community` (PyPI/GitHub, Carvera-Community org) is the **GUI** controller, not a headless
  CLI. Firmware-level optional-stop (`M01`, community-firmware issue #15) exists but is not a CLI verb. The repo
  is private/deleted/unindexed. CLAUDE.md's "carvera-cli upstream lacks an abort verb" is **uncontradicted**.

## 2. Goal

When upstream ships an abort verb: replace `carveraAbortFallback()` in `dispatchEstop()` with a real
`spawnBounded` abort call, keeping the advisory as a fallback for installs without an abort-capable CLI, and
preserving the structured envelope so renderer toasts are unchanged. Until then: a documented watch item +
the doc-bug fix.

## 3. Approach

- **Phase 0 — watch only (now).** No code. Record the blocker; keep the fallback; confirm interim behavior is
  correct/safe. Fix the `fab:estop` → `machine:estop` doc reference.
- **Phase 1 — wire on unblock.** Add `buildCarveraAbortArgs()` + `carveraAbort()` to `carvera-cli-run.ts`
  mirroring the upload path. In `dispatchEstop()` call `carveraAbort(...)` wrapped in try/catch that folds back
  to `no_cli_abort` on ENOENT/non-zero/timeout — E-stop must never throw and always give an actionable toast.

**Argv shape (verify against the real `--help` at unblock — do not guess the verb):**
`carvera-cli [--wifi|--usb] [--device <ip|port>] [--timeout <sec>] abort` — abort is the last positional, no
file path follows. Reuse the upload path's sanitization verbatim: trim `device` (omit flag if empty),
`Math.max(1, Math.ceil(timeoutMs/1000))`, `--wifi`/`--usb`/none, `carveraCliPath.trim() || 'carvera-cli'`,
extra-args JSON prefix. Use a **short** timeout (10–15 s), not the 120 s upload budget.

## 4. Touchpoints

| File | When | Change |
|---|---|---|
| `docs/PRE-LAUNCH-READINESS.md` | now | Add an **Upstream Watch Items** table row (see §7). |
| `docs/SECURITY.md` | now | Add an **Upstream Dependency Watch** one-liner for `carvera-cli`. |
| `docs/MACHINES.md:184` | now | Fix `fab:estop` → `machine:estop`. |
| `src/main/carvera-cli-run.ts` | unblock | Add `buildCarveraAbortArgs()` + `carveraAbort()`. |
| `src/main/ipc-machine.ts:230–237` | unblock | Call `carveraAbort(...)`; keep ENOENT/missing-CLI fallback. |
| `src/main/carvera-cli-run.test.ts` | unblock | Happy-path abort argv test. |
| `src/main/carvera-cli-run-pin.test.ts` | unblock | New group (K) abort-argv contract; bump group (J) size bounds. |
| `src/main/ipc-machine.test.ts:287–300` | unblock | CLI-success → `ok:true`; ENOENT → `no_cli_abort` fallback. |
| `docs/SMOKE-CARVERA-CLI.md:5a` | unblock | Update wording from "not verified" to "wired; verify CLI version". |

No changes to `AppHeader.tsx`, the preload channel name, posts, profiles, or slicer profiles.

## 5. Risks & mitigations

- **R1 verb name unknown** (`abort`/`stop`/`cancel`/`halt`?) — fallback is the safety net; don't implement
  Phase 1 until `carvera-cli --help` confirms the verb + flags; pin the exact verb + version in a code comment.
- **R2 wire-protocol drift across CLI versions** (`SMOKE-CARVERA-CLI.md:128`) — keep the bench drill mandatory;
  surface the CLI version in the success toast.
- **R3 transport contention with Makera Controller** — ENOENT/non-zero fallback covers it; add a transport-held hint.
- **R4 `machine:estop` vs `fab:estop` doc confusion** — fix the doc in the same PR as the wiring.
- **R5 pin-test size bounds** — group (J) caps `carvera-cli-run.ts` at ~130 lines/4 KB; adding the abort funcs
  (~30 lines) requires bumping those bounds (cosmetic).

## 6. Test strategy

- **Now (must stay green):** the fallback test (`:224`) and the two `dispatchEstop` → `no_cli_abort` tests
  (`:287–300`) are the regression guard. No abort-argv tests yet (correct).
- **On unblock:** `buildCarveraAbortArgs` for wifi+device / usb+COM / auto; timeout rounding; empty-device omit;
  `dispatchEstop` with mocked `spawnBounded` → success (`ok:true`), ENOENT (fallback `no_cli_abort`),
  non-zero+stderr (`ok:false` + transport hint). Update group (J) bounds + add the abort literals to the whitelist.

## 7. Watch mechanism

Add to `docs/PRE-LAUNCH-READINESS.md` (new **Upstream Watch Items** table):

| Item | Upstream | Check | Unblock action |
|---|---|---|---|
| Carvera E-stop real wiring | `hagmonk/carvera-cli` (private/unindexed as of 2026-06-02) | CHANGELOG/README for an `abort`/`stop`/`cancel`/`halt` verb in a new release | Implement `buildCarveraAbortArgs()` + replace `carveraAbortFallback()` per this plan |

And one line in `docs/SECURITY.md` (**Upstream Dependency Watch**): "`carvera-cli`: monitoring for an abort
verb. Until it ships, `machine:estop` for Carvera returns `no_cli_abort` and the operator uses the physical
E-stop. Re-check each CLI release."

**Scheduled poll?** Not worth it while the repo is unindexed (a cron GitHub-releases poll would fail silently on
a private repo). Recommend a **manual quarterly check** by Jacob (checklist item). Revisit a `schedule`-skill
poll if the repo becomes public.

## Effort & open questions

**Effort: S** for the watch docs (≈30 min, no code) · **M** for Phase 1 once the verb is known.

1. Is `hagmonk/carvera-cli` public or private? If private, who has access and how does the unblock signal reach Jacob?
2. Does abort require the machine to be mid-program, or is it safe at any state (idle → graceful non-zero)?
3. Does abort block until ack or return immediately? Sets the `spawnBounded` timeout budget (10–15 s).
4. Any abort difference between stock Smoothieware and community firmware (`SMOKE-CARVERA-CLI.md:128`)?

**Interim behavior confirmed correct:** `dispatchEstop` always returns a structured envelope (never throws); the
renderer toasts "physically e-stop the machine"; the confirm dialog is already Carvera-specific. Safety preserved.
