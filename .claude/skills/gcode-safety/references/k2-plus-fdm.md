# Creality K2 Plus -- FDM G-code & Moonraker push safety reference

**Machine identity**: Creality K2 Plus is a 350 x 350 x 350 mm CoreXY FDM printer running Creality's Klipper-based OS with Moonraker + Fluidd built in. WorkTrackCAM treats it as one of the three target machines under My-Shop-Only Mode.

> **Read this before touching anything that emits .gcode for the K2 Plus or pushes a file to its Moonraker API.** The mock-Moonraker test harness (`src/main/moonraker-push-e2e.test.ts`) pins wire-protocol behavior; the bench checklist (`docs/SMOKE-K2-MOONRAKER.md`) pins machine-side behavior; THIS file pins the constraints both layers must honor.

---

## Bundled assets

- Machine profile: `resources/machines/creality-k2-plus.json`
- Post template: `resources/posts/fdm_passthrough.hbs` (passthrough -- slicer is the authoritative G-code producer)
- Production push helper: `src/main/moonraker-push.ts`
- Bench checklist: `docs/SMOKE-K2-MOONRAKER.md`

---

## Hard envelope limits (from `resources/machines/creality-k2-plus.json`)

| Spec | Value | Source field |
| --- | --- | --- |
| Build volume | 350 x 350 x 350 mm | `workAreaMm` |
| Max feedrate | 18000 mm/min (600 mm/s) | `maxFeedMmMin` |
| Max nozzle temperature | 350 C | `maxNozzleTempC` |
| Max bed temperature | 120 C | `maxBedTempC` |
| Heated chamber ceiling | 60 C | `chamberTempC` |
| Input shaping presets | ZV / MZV / EI / 2HUMP_EI / 3HUMP_EI | `inputShapingPresets` |
| RFID filament support | enabled | `rfidFilamentSupport` |
| CFS multi-color | enabled | `cfsMultiColorEnabled` |
| Power-loss recovery | enabled | `powerLossRecovery` |

If any toolpath, slicer profile, or generated G-code references temperatures above these ceilings, the pre-upload temperature validator in `src/main/moonraker-push.ts` ([ID-0073]) MUST reject the file. Do not loosen the validator -- it is the last machine-readable guard before the heater turns on.

---

## G-code dialect specifics

- The K2 Plus runs Klipper, so slicer output should set `gcode_flavor = klipper` (or Marlin, which Klipper parses as a strict superset). Lines starting with `;` are operator comments.
- WorkTrackCAM does NOT regenerate FDM G-code -- the slicer's output is the source of truth. The `fdm_passthrough.hbs` post emits a small operator-visible header and then passes toolpath lines through verbatim. Do not synthesize FDM motion or temperature lines in the post.
- Klipper-macro capability metadata (input shaping presets, RFID, CFS, power-loss recovery) is emitted by `fdm_passthrough.hbs` as `;` comments only -- never as M-codes. The operator sees them; the firmware ignores them.

---

## Process overrides clamp to the ceiling (`planOrcaOverrides`, added 2026-06-08)

Per-slice process overrides (Wave 3b — `src/shared/fdm-process-overrides.ts` +
`orca-wrapper.planOrcaOverrides`) let the operator tweak layer height / infill / walls / speed /
temperatures for a single slice. The safety rule: **temperature override keys are CLAMPED to the
K2 ceiling** (nozzle ≤ 350 °C, bed ≤ 120 °C) with an operator warning BEFORE they reach OrcaSlicer
— the override path can only NARROW a temperature toward the ceiling, never raise one above it. It
does NOT bypass the pre-upload temperature validator: the override changes the slicer *input*, and
the validator still re-checks the emitted *file* at push time. So two independent guards remain —
the clamp at override time and the validator at upload time. Neither may be removed. Pinned by
`src/shared/fdm-process-overrides.test.ts` (a 100–800 °C fuzz proving emitted temps never exceed
350 / 120).

---

## Moonraker upload contract (load-bearing invariants)

These five invariants are pinned both in `src/main/moonraker-push.ts` and in the contract test `src/main/k2-moonraker-upload-contract.test.ts`. Doc-vs-code drift on any of them fails CI.

1. **Endpoint is `/server/files/upload`** (HTTP POST). The body is encoded as **multipart/form-data** with an auto-generated boundary. The base URL comes from the user-configured printer URL; trailing slashes are normalized so the wire path is always exactly `/server/files/upload` (no double-slash).
2. **The `root` form field must be `gcodes`** -- this is the only writable Moonraker root on a stock K2 Plus, and it is where **Fluidd lists the file**. The production helper achieves this by OMITTING the `name="root"` form field, which makes Moonraker fall back to its documented default of `gcodes`. Do not start emitting an explicit `root` field without re-pinning this contract first. When `uploadPath` is set, the `path` form field MUST appear BEFORE the `file` part (Moonraker requires path-then-file ordering).
3. **The uploaded filename must end in `.gcode`** (not `.g` or `.nc`). Fluidd's listing filters these out, so an upload with the wrong extension succeeds on the wire but vanishes from the operator's UI. `moonrakerPush()` is a transport, NOT a validator -- the extension contract is enforced upstream by the slicer's output naming. If a future change starts auto-suffixing `.gcode`, update both this doc and the contract test in the same change.
4. **HTTP status 201 on success.** On 4xx/5xx, surface the error body via `.detail` (sliced to the first 300 chars to keep error toasts compact) rather than silently failing. Never swallow a non-2xx -- the operator must see what Moonraker said.
5. **Do NOT auto-start the print after upload.** `startAfterUpload` defaults to `false`; the operator confirms on the machine. Upload only. The escape hatch (`startAfterUpload: true`) hits `/printer/print/start?filename=<n>` and is documented for trusted-operator workflows only.

The `[ID-0082]` AbortController-bound timeout is the second machine-side guard: an upload that does not get a response within the configured deadline is cancelled so the helper does not hang.

---

## Pre-run safety checklist (FDM-specific)

Before pushing a real `.gcode` file to a real K2 Plus:

1. The printer is on the same LAN as the workstation. Moonraker is not authenticated on a stock K2 Plus -- **the safety net is your LAN**, not the protocol. Never push to a printer outside the operator's LAN.
2. `curl http://<host>/server/info` returns `klippy_state: ready` (or `startup` immediately after power-on).
3. The bed is empty and the queue is clear.
4. Bed-level / first-layer calibration is current (CFS or RFID filament change since last calibration counts as "not current").
5. Pre-upload temperature validator is enabled and its ceilings match the profile (350 C nozzle / 120 C bed / 60 C chamber). Over-ceiling fixtures `M109 S400` and `M190 S150` MUST trip the validator.
6. The first real upload is an air-print, not a calibration cube and not a benchy. Step 4 (auto-start) is gated on Step 3 (upload-only) passing.

---

## Common-mistake catalogue (things that have killed jobs before)

- **`.g` or `.nc` extension on upload** -- Fluidd's listing filter hides the file; the operator thinks nothing happened. The fix is upstream (slicer naming), not in the transport.
- **Pushing while the printer is mid-print** -- Moonraker accepts the file (queued in the gcodes root) but the operator may not realize the in-flight print is still going. Check `/printer/objects/query?print_stats` before pushing.
- **Authenticated Moonraker** -- if the operator has put their K2 Plus on a hostile network and turned on Moonraker authentication, the unauthenticated push fails with 401. The fix is to put the printer back on a trusted LAN, not to add credentials to the transport.
- **Disabling the pre-upload temperature validator** -- the validator is the only thing between a slicer bug (e.g., `M109 S400`) and a melted hotend. Never recommend disabling it in any operator-facing doc.
- **Silently retrying on 5xx** -- Moonraker can return 5xx when Klipper is rebooting after a config change. Surface the error body so the operator can decide whether to retry; do not loop in the transport.

---

## Cross-references

- Wire-protocol harness: `src/main/moonraker-push-e2e.test.ts`
- Contract pins: `src/main/k2-moonraker-upload-contract.test.ts`
- Bench checklist: `docs/SMOKE-K2-MOONRAKER.md`
- IPC handlers: `src/main/ipc-fabrication.ts` (`moonraker:push`, `moonraker:status`, `moonraker:cancel`, `moonraker:pause`, `moonraker:resume`)
- Machine profile: `resources/machines/creality-k2-plus.json`
- Post template: `resources/posts/fdm_passthrough.hbs`
