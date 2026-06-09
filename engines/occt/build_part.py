#!/usr/bin/env python3
"""No-code CAD build consumer: kernel-op timeline JSON -> STEP + STL.

This is the file ``src/main/cad/build-kernel-part.ts`` spawns as::

    python engines/occt/build_part.py <payloadPath> <outputDir> <base>

It reads the ``KernelBuildPayload`` JSON written by
``src/shared/sketch-profile.ts`` (``buildKernelBuildPayload`` +
``attachKernelPostOpsToPayload``), builds the BASE solid from the sketch
profiles (extrude / revolve / loft), applies each post-solid op IN ORDER, places
the result with the same sketch-plane transform the renderer preview uses
(``sketchPreviewPlacementMatrix``), and writes ``<base>.step`` + ``<base>.stl``
into ``<outputDir>``.

Output contract (read by ``runPythonJson`` in ``src/main/cad/occt-import.ts``,
which parses the LAST non-empty stdout/stderr line as JSON)::

    {"ok": true, "stepPath": "...", "stlPath": "...",
     "loftStrategy"?: str, "flatPatternStrategy"?: str,
     "splitKeepHalfspace"?: {...}, "splitDiscardedStepPath"?: str,
     "splitDiscardedStlPath"?: str, "loftGuideRailsKernelMode"?: str,
     "warnings"?: [str, ...]}          # exit 0
    {"ok": false, "error": "...", "detail"?: "..."}   # exit 1

Error codes match ``KERNEL_BUILD_USER`` in ``src/shared/kernel-build-messages.ts``:
``usage``, ``payload_read_failed``, ``invalid_payload``, ``cadquery_not_installed``,
``unknown_solid_kind``, ``bad_payload_version``, ``no_solid``, ``build_failed``,
``output_dir_failed``.

THE KERNEL IS SACRED (CLAUDE.md Safety Rule 1). A bad post-solid op NEVER raises
and NEVER aborts the build: it is skipped with a non-fatal warning and the
prior solid is carried forward. Only a missing CadQuery, an unbuildable BASE
solid, or an export failure fails the whole build.
"""
from __future__ import annotations

import json
import math
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ── Package import bootstrap ─────────────────────────────────────────────────
#
# build-kernel-part.ts spawns this as a bare file path (engines/occt/build_part.py)
# with cwd = appRoot, so there is no package context. Add the repo root (the
# parent of ``engines/``) to sys.path and import the shared CAD helpers by their
# absolute package path. This keeps a SINGLE source of truth for the validated
# apply_*_select_op functions + the binary-STL writer (no re-implementation).
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Imported lazily inside main() AFTER the cadquery probe so a missing CadQuery
# yields the clean ``cadquery_not_installed`` envelope instead of an ImportError
# traceback on the wrong line.


# ── Result envelope (single JSON line, like step_to_stl.py) ──────────────────


def _emit_ok(payload: Dict[str, Any]) -> None:
    out = {"ok": True}
    out.update(payload)
    print(json.dumps(out))
    sys.exit(0)


def _emit_fail(error: str, detail: str = "") -> None:
    obj: Dict[str, Any] = {"ok": False, "error": error}
    if detail:
        obj["detail"] = detail
    print(json.dumps(obj))
    sys.exit(1)


# ── Payload validation ───────────────────────────────────────────────────────


def _require_finite_mm(value: Any, what: str) -> float:
    """Coerce ``value`` to a finite float or raise ``_PayloadError``.

    Mirrors the ``mm`` Zod scalar (``z.number().finite()``) named in
    ``part-features-schema.ts`` so a NaN/Inf that slipped past the TS layer is
    rejected here too rather than poisoning OCC geometry.
    """
    try:
        f = float(value)
    except (TypeError, ValueError):
        raise _PayloadError(f"{what} must be a number, got {value!r}")
    if not math.isfinite(f):
        raise _PayloadError(f"{what} must be finite, got {f!r}")
    return f


class _PayloadError(Exception):
    """Raised for a structurally invalid payload (-> ``invalid_payload``)."""


def _load_payload(path: str) -> Dict[str, Any]:
    try:
        raw = Path(path).read_text(encoding="utf-8")
    except OSError as exc:
        _emit_fail("payload_read_failed", f"could not read payload {path}: {exc}")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        _emit_fail("payload_read_failed", f"payload is not valid JSON: {exc}")
    if not isinstance(data, dict):
        _emit_fail("invalid_payload", "payload root must be a JSON object")
    return data  # type: ignore[return-value]


# ── Profile -> wire helpers ──────────────────────────────────────────────────


def _add_profile_to_workplane(wp: Any, profile: Dict[str, Any]) -> Any:
    """Add ONE closed profile (loop or circle) to a CadQuery workplane.

    Returns the workplane with a pending wire. Raises ``_PayloadError`` on a
    structurally bad profile so the BASE build can fail cleanly.
    """
    ptype = profile.get("type")
    if ptype == "circle":
        cx = _require_finite_mm(profile.get("cx"), "profile.cx")
        cy = _require_finite_mm(profile.get("cy"), "profile.cy")
        r = _require_finite_mm(profile.get("r"), "profile.r")
        if r <= 0:
            raise _PayloadError(f"circle radius must be > 0, got {r}")
        return wp.moveTo(cx, cy).circle(r)
    if ptype == "loop":
        pts_raw = profile.get("points")
        if not isinstance(pts_raw, list) or len(pts_raw) < 3:
            raise _PayloadError("loop profile needs >= 3 points")
        pts: List[Tuple[float, float]] = []
        for i, pt in enumerate(pts_raw):
            if not isinstance(pt, (list, tuple)) or len(pt) != 2:
                raise _PayloadError(f"loop point {i} must be [x, y]")
            pts.append(
                (
                    _require_finite_mm(pt[0], f"loop point {i}.x"),
                    _require_finite_mm(pt[1], f"loop point {i}.y"),
                )
            )
        return wp.polyline(pts).close()
    raise _PayloadError(f"unknown profile type {ptype!r}")


# ── BASE solid builders (canonical: profile on XY, extrude toward +Z) ────────


def _build_extrude(cq: Any, payload: Dict[str, Any]) -> Any:
    depth = _require_finite_mm(payload.get("extrudeDepthMm"), "extrudeDepthMm")
    if depth <= 0:
        raise _PayloadError(f"extrudeDepthMm must be > 0, got {depth}")
    profiles = payload["profiles"]
    wp = cq.Workplane("XY")
    for prof in profiles:
        wp = _add_profile_to_workplane(wp, prof)
    solid = wp.extrude(depth)
    return solid


def _build_revolve(cq: Any, payload: Dict[str, Any]) -> Any:
    revolve = payload.get("revolve") or {}
    angle = _require_finite_mm(revolve.get("angleDeg"), "revolve.angleDeg")
    axis_x = _require_finite_mm(revolve.get("axisX"), "revolve.axisX")
    if angle <= 0:
        raise _PayloadError(f"revolve.angleDeg must be > 0, got {angle}")
    profiles = payload["profiles"]
    # Revolve every closed loop around the sketch-plane vertical line X = axisX.
    # CadQuery's revolve takes an axis through two points; we revolve about the
    # line through (axisX, 0, 0) parallel to +Y. The profile is built on XY.
    wp = cq.Workplane("XY")
    for prof in profiles:
        if prof.get("type") == "circle":
            # A full circle revolve is a torus/degenerate self-intersection case
            # the TS layer already rejects (circle_revolve_use_polyline_approximation);
            # guard here too so a hand-rolled payload can't crash OCC.
            raise _PayloadError("revolve does not support circle profiles")
        wp = _add_profile_to_workplane(wp, prof)
    solid = wp.revolve(angle, (axis_x, 0.0, 0.0), (axis_x, 1.0, 0.0))
    return solid


# Keep in sync with LOFT_MAX_PROFILES in src/shared/sketch-profile.ts.
_LOFT_MAX_PROFILES = 16


def _build_loft(cq: Any, payload: Dict[str, Any]) -> Tuple[Any, str]:
    sep = _require_finite_mm(payload.get("loftSeparationMm"), "loftSeparationMm")
    if sep <= 0:
        raise _PayloadError(f"loftSeparationMm must be > 0, got {sep}")
    profiles = payload["profiles"]
    if len(profiles) < 2:
        raise _PayloadError("loft requires >= 2 profiles")
    if len(profiles) > _LOFT_MAX_PROFILES:
        raise _PayloadError(f"loft supports at most {_LOFT_MAX_PROFILES} profiles")
    # Chain the closed sections along +Z, separated by loftSeparationMm, then
    # loft(combine=True). This mirrors the renderer's stacked-section preview.
    wp = cq.Workplane("XY")
    for idx, prof in enumerate(profiles):
        if idx > 0:
            wp = wp.workplane(offset=sep)
        wp = _add_profile_to_workplane(wp, prof)
    solid = wp.loft(combine=True)
    strategy = (
        "two+smooth"
        if len(profiles) == 2
        else f"multi+union-chain:{len(profiles)}"
    )
    return solid, strategy


def _build_base_solid(cq: Any, payload: Dict[str, Any]) -> Tuple[Any, Dict[str, Any]]:
    """Build the canonical base solid. Returns ``(workplane, manifest_extras)``.

    ``manifest_extras`` may carry ``loftStrategy``. Raises ``_PayloadError`` or
    a ``_BuildError`` (no solid / OCC failure).
    """
    solid_kind = payload.get("solidKind")
    profiles = payload.get("profiles")
    if not isinstance(profiles, list) or not profiles:
        raise _PayloadError("payload.profiles must be a non-empty array")

    extras: Dict[str, Any] = {}
    try:
        if solid_kind == "extrude":
            wp = _build_extrude(cq, payload)
        elif solid_kind == "revolve":
            wp = _build_revolve(cq, payload)
        elif solid_kind == "loft":
            wp, strategy = _build_loft(cq, payload)
            extras["loftStrategy"] = strategy
        else:
            # Unknown kind is a hard error (the BASE could not be built).
            raise _UnknownSolidKind(f"unknown solidKind {solid_kind!r}")
    except _PayloadError:
        raise
    except _UnknownSolidKind:
        raise
    except Exception as exc:  # noqa: BLE001 - OCC raises arbitrary types
        raise _BuildError(f"{solid_kind} base build failed: {exc}", detail=str(exc))

    # Confirm we really have a solid before any post-op touches it.
    try:
        wp.findSolid()
    except Exception as exc:  # noqa: BLE001
        raise _BuildError(
            f"{solid_kind} produced no solid: {exc}", detail=str(exc)
        )
    return wp, extras


class _BuildError(Exception):
    def __init__(self, message: str, detail: str = "") -> None:
        super().__init__(message)
        self.detail = detail


class _UnknownSolidKind(Exception):
    pass


# ── Sketch-plane placement (canonical -> world, matches the renderer preview) ─


def _placement_basis(plane: Dict[str, Any]) -> Optional[
    Tuple[
        Tuple[float, float, float],
        Tuple[float, float, float],
        Tuple[float, float, float],
        Tuple[float, float, float],
    ]
]:
    """Return ``(u, v, n, origin)`` columns for the canonical->world transform.

    EXACTLY mirrors ``sketchPreviewPlacementMatrix`` in
    ``src/renderer/design/sketch-preview-placement.ts`` (pinned by
    ``sketch-preview-placement-pin.test.ts``):

      * datum XY / XZ: u=(1,0,0) v=(0,0,-1) n=(0,1,0)  -> world (x, z, -y)
      * datum YZ:      u=(0,1,0) v=(0,0,1)  n=(1,0,0)  -> world (z, x, y)
      * face:          orthonormalised (u, v=n x u, n) basis at ``origin``

    Returns ``None`` when the plane is missing/unknown -> caller leaves the
    solid in canonical space (identity) rather than guessing.
    """
    kind = plane.get("kind")
    if kind == "datum":
        datum = plane.get("datum")
        if datum in ("XY", "XZ"):
            return (1.0, 0.0, 0.0), (0.0, 0.0, -1.0), (0.0, 1.0, 0.0), (0.0, 0.0, 0.0)
        if datum == "YZ":
            return (0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 0.0, 0.0)
        return None
    if kind == "face":
        o = plane.get("origin")
        n_raw = plane.get("normal")
        x_raw = plane.get("xAxis")
        if not (_is_vec3(o) and _is_vec3(n_raw) and _is_vec3(x_raw)):
            return None
        n = _normalize3(tuple(float(c) for c in n_raw))
        if n is None:
            return None
        u = _normalize3(tuple(float(c) for c in x_raw))
        if u is None:
            u = (1.0, 0.0, 0.0)
        # Project u onto the plane perpendicular to n, then re-normalise.
        dot_un = u[0] * n[0] + u[1] * n[1] + u[2] * n[2]
        u = _normalize3((u[0] - dot_un * n[0], u[1] - dot_un * n[1], u[2] - dot_un * n[2]))
        if u is None:
            cand = _normalize3((0.0 - n[1] * 0.0, 1.0 - n[1] * n[1], 0.0 - n[1] * n[2]))
            u = cand if cand is not None else (0.0, 0.0, 1.0)
        v = _cross3(n, u)
        v = _normalize3(v)
        if v is None:
            return None
        # Right-handed correction: cross(u, v) . n must be >= 0.
        chk = _cross3(u, v)
        if (chk[0] * n[0] + chk[1] * n[1] + chk[2] * n[2]) < 0:
            v = (-v[0], -v[1], -v[2])
        origin = (float(o[0]), float(o[1]), float(o[2]))
        return u, v, n, origin
    return None


def _is_vec3(value: Any) -> bool:
    return (
        isinstance(value, (list, tuple))
        and len(value) == 3
        and all(isinstance(c, (int, float)) and math.isfinite(float(c)) for c in value)
    )


def _normalize3(vec: Tuple[float, float, float]) -> Optional[Tuple[float, float, float]]:
    mag = math.sqrt(vec[0] * vec[0] + vec[1] * vec[1] + vec[2] * vec[2])
    if mag <= 1e-9:
        return None
    return (vec[0] / mag, vec[1] / mag, vec[2] / mag)


def _cross3(
    a: Tuple[float, float, float], b: Tuple[float, float, float]
) -> Tuple[float, float, float]:
    return (
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    )


def _apply_placement(cq: Any, wp: Any, plane: Dict[str, Any]) -> Any:
    """Move the built solid from canonical space into world space.

    Identity when the plane is missing/unknown (canonical == world for the
    historical XY default would be wrong, so we ALWAYS apply the basis when the
    plane resolves — datum XY is NOT identity, it is world (x, z, -y)).
    """
    basis = _placement_basis(plane)
    if basis is None:
        return wp
    u, v, n, o = basis
    from OCP.gp import gp_Trsf  # noqa: PLC0415

    trsf = gp_Trsf()
    # gp_Trsf rotation columns = (u, v, n); translation = origin.
    # SetValues is row-major: (a11 a12 a13 a14 / a21 .. / a31 ..).
    trsf.SetValues(
        u[0], v[0], n[0], o[0],
        u[1], v[1], n[1], o[1],
        u[2], v[2], n[2], o[2],
    )
    try:
        solid = wp.findSolid()
        moved = solid.located(cq.Location(trsf))
        return cq.Workplane(obj=moved)
    except Exception:  # noqa: BLE001 - placement is best-effort; never crash a built solid
        return wp


# ── Post-solid op application (order-preserving, never-raise) ────────────────


def _coerce_wp(cq: Any, body: Any) -> Any:
    """Wrap a raw Solid/Compound in a Workplane so ``.findSolid()`` works."""
    if isinstance(body, cq.Workplane):
        return body
    return cq.Workplane(obj=body)


def _apply_post_solid_ops(
    cq: Any, wp: Any, ops: List[Dict[str, Any]], warnings: List[str]
) -> Tuple[Any, Dict[str, Any]]:
    """Apply ``ops`` in array order. NEVER raises: a bad op is skipped with a
    warning and the prior workplane is carried forward (the kernel is sacred).

    Returns ``(workplane, manifest_extras)`` where extras may carry
    ``flatPatternStrategy``, ``splitKeepHalfspace`` (+ discarded paths handled
    by the caller), ``loftGuideRailsKernelMode``.
    """
    # Imported here (after the cadquery probe) so a missing CadQuery never
    # reaches this code path. Single source of truth for the validated #15
    # fillet/chamfer/shell appliers.
    from engines.cad.cadquery_script import (  # noqa: PLC0415
        apply_chamfer_select_op,
        apply_fillet_select_op,
        apply_shell_inward_op,
    )

    extras: Dict[str, Any] = {}
    for index, op in enumerate(ops):
        if not isinstance(op, dict):
            warnings.append(f"op[{index}] skipped: not an object")
            continue
        kind = op.get("kind")
        try:
            handler = _OP_DISPATCH.get(kind)
            if handler is None:
                # fillet/chamfer/shell are dispatched directly to the validated
                # appliers below (they have their own (wp, warnings) contract).
                if kind == "fillet_select":
                    wp, w = apply_fillet_select_op(_coerce_wp(cq, wp), op)
                    _prefix_warnings(warnings, index, kind, w)
                elif kind == "chamfer_select":
                    wp, w = apply_chamfer_select_op(_coerce_wp(cq, wp), op)
                    _prefix_warnings(warnings, index, kind, w)
                elif kind == "shell_inward":
                    wp, w = apply_shell_inward_op(_coerce_wp(cq, wp), op)
                    _prefix_warnings(warnings, index, kind, w)
                else:
                    warnings.append(
                        f"op[{index}] {kind!r}: no kernel handler yet (skipped)"
                    )
                continue
            wp = handler(cq, wp, op, index, warnings, extras)
        except Exception as exc:  # noqa: BLE001 - sacred kernel: skip, never abort
            warnings.append(f"op[{index}] {kind!r} raised and was skipped: {exc}")
            continue
    return wp, extras


def _prefix_warnings(
    out: List[str], index: int, kind: Any, op_warnings: List[str]
) -> None:
    for w in op_warnings:
        out.append(f"op[{index}] {kind}: {w}")


# ── Individual op handlers ───────────────────────────────────────────────────
#
# Each handler signature: (cq, wp, op, index, warnings, extras) -> new_wp.
# A handler may append warnings; it should return ``wp`` UNCHANGED if it cannot
# proceed (so the build carries the prior solid forward). Handlers may raise —
# the dispatcher catches and converts to a skip-warning — but preferring an
# explicit warning + unchanged return gives a better operator message.


def _op_fillet_all(cq, wp, op, index, warnings, extras):
    radius = _require_finite_mm(op.get("radiusMm"), "fillet_all.radiusMm")
    if radius <= 0:
        warnings.append(f"op[{index}] fillet_all skipped: radiusMm must be > 0")
        return wp
    work = _coerce_wp(cq, wp)
    try:
        edges = work.edges()
        if not edges.objects:
            warnings.append(f"op[{index}] fillet_all skipped: solid has no edges")
            return wp
        return work.edges().fillet(radius)
    except Exception as exc:  # noqa: BLE001 - OCC may reject the global radius
        warnings.append(
            f"op[{index}] fillet_all failed (radius {radius}): {exc} (left unchanged)"
        )
        return wp


def _op_chamfer_all(cq, wp, op, index, warnings, extras):
    length = _require_finite_mm(op.get("lengthMm"), "chamfer_all.lengthMm")
    if length <= 0:
        warnings.append(f"op[{index}] chamfer_all skipped: lengthMm must be > 0")
        return wp
    work = _coerce_wp(cq, wp)
    try:
        if not work.edges().objects:
            warnings.append(f"op[{index}] chamfer_all skipped: solid has no edges")
            return wp
        return work.edges().chamfer(length)
    except Exception as exc:  # noqa: BLE001
        warnings.append(
            f"op[{index}] chamfer_all failed (length {length}): {exc} (left unchanged)"
        )
        return wp


def _box_tool(cq, op, prefix):
    x0 = _require_finite_mm(op.get("xMinMm"), f"{prefix}.xMinMm")
    x1 = _require_finite_mm(op.get("xMaxMm"), f"{prefix}.xMaxMm")
    y0 = _require_finite_mm(op.get("yMinMm"), f"{prefix}.yMinMm")
    y1 = _require_finite_mm(op.get("yMaxMm"), f"{prefix}.yMaxMm")
    z0 = _require_finite_mm(op.get("zMinMm"), f"{prefix}.zMinMm")
    z1 = _require_finite_mm(op.get("zMaxMm"), f"{prefix}.zMaxMm")
    if not (x1 > x0 and y1 > y0 and z1 > z0):
        raise _PayloadError(f"{prefix} requires strictly increasing min/max")
    cx, cy, cz = (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2
    return (
        cq.Workplane("XY")
        .transformed(offset=(cx, cy, cz))
        .box(x1 - x0, y1 - y0, z1 - z0)
    )


def _op_boolean_union_box(cq, wp, op, index, warnings, extras):
    tool = _box_tool(cq, op, "boolean_union_box")
    return _coerce_wp(cq, wp).union(tool)


def _op_boolean_subtract_box(cq, wp, op, index, warnings, extras):
    tool = _box_tool(cq, op, "boolean_subtract_box")
    return _coerce_wp(cq, wp).cut(tool)


def _op_boolean_intersect_box(cq, wp, op, index, warnings, extras):
    tool = _box_tool(cq, op, "boolean_intersect_box")
    return _coerce_wp(cq, wp).intersect(tool)


def _op_boolean_subtract_cylinder(cq, wp, op, index, warnings, extras):
    cx = _require_finite_mm(op.get("centerXMm"), "boolean_subtract_cylinder.centerXMm")
    cy = _require_finite_mm(op.get("centerYMm"), "boolean_subtract_cylinder.centerYMm")
    r = _require_finite_mm(op.get("radiusMm"), "boolean_subtract_cylinder.radiusMm")
    z0 = _require_finite_mm(op.get("zMinMm"), "boolean_subtract_cylinder.zMinMm")
    z1 = _require_finite_mm(op.get("zMaxMm"), "boolean_subtract_cylinder.zMaxMm")
    if r <= 0 or not (z1 > z0):
        raise _PayloadError("boolean_subtract_cylinder requires r>0 and zMaxMm>zMinMm")
    height = z1 - z0
    tool = (
        cq.Workplane("XY")
        .transformed(offset=(cx, cy, z0 + height / 2))
        .circle(r)
        .extrude(height)
    )
    return _coerce_wp(cq, wp).cut(tool)


def _op_split_keep_halfspace(cq, wp, op, index, warnings, extras):
    axis = str(op.get("axis", "")).upper()
    keep = str(op.get("keep", "")).lower()
    offset = _require_finite_mm(op.get("offsetMm"), "split_keep_halfspace.offsetMm")
    if axis not in ("X", "Y", "Z") or keep not in ("positive", "negative"):
        warnings.append(f"op[{index}] split_keep_halfspace skipped: bad axis/keep")
        return wp
    # Build a large box on the kept side of the plane and intersect.
    work = _coerce_wp(cq, wp)
    try:
        bb = work.findSolid().BoundingBox()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"op[{index}] split_keep_halfspace skipped: no bbox ({exc})")
        return wp
    pad = 10.0 + max(
        bb.xmax - bb.xmin, bb.ymax - bb.ymin, bb.zmax - bb.zmin, 1.0
    ) * 2.0
    lo = (bb.xmin - pad, bb.ymin - pad, bb.zmin - pad)
    hi = (bb.xmax + pad, bb.ymax + pad, bb.zmax + pad)
    keep_lo = list(lo)
    keep_hi = list(hi)
    aidx = {"X": 0, "Y": 1, "Z": 2}[axis]
    if keep == "positive":
        keep_lo[aidx] = offset
    else:
        keep_hi[aidx] = offset
    if not (keep_hi[aidx] > keep_lo[aidx]):
        warnings.append(
            f"op[{index}] split_keep_halfspace produced empty keep region (skipped)"
        )
        return wp
    cx = (keep_lo[0] + keep_hi[0]) / 2
    cy = (keep_lo[1] + keep_hi[1]) / 2
    cz = (keep_lo[2] + keep_hi[2]) / 2
    cutter = (
        cq.Workplane("XY")
        .transformed(offset=(cx, cy, cz))
        .box(
            keep_hi[0] - keep_lo[0],
            keep_hi[1] - keep_lo[1],
            keep_hi[2] - keep_lo[2],
        )
    )
    try:
        result = work.intersect(cutter)
        result.findSolid()
    except Exception as exc:  # noqa: BLE001
        warnings.append(
            f"op[{index}] split_keep_halfspace produced empty keep region: {exc} (skipped)"
        )
        return wp
    extras["splitKeepHalfspace"] = {"axis": axis, "offsetMm": offset, "keep": keep}
    return result


def _op_hole_from_profile(cq, wp, op, index, warnings, extras):
    profiles = _OP_CONTEXT.get("profiles") or []
    pidx = op.get("profileIndex")
    if not isinstance(pidx, int) or pidx < 0 or pidx >= len(profiles):
        warnings.append(
            f"op[{index}] hole_from_profile profileIndex out of range "
            f"({pidx}, have {len(profiles)}) (skipped)"
        )
        return wp
    prof = profiles[pidx]
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "hole_from_profile.zStartMm")
    mode = op.get("mode")
    work = _coerce_wp(cq, wp)
    try:
        bb = work.findSolid().BoundingBox()
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"op[{index}] hole_from_profile skipped: no bbox ({exc})")
        return wp
    if mode == "through_all":
        depth = (bb.zmax - bb.zmin) + 20.0
        cut_z0 = bb.zmin - 10.0
    elif mode == "depth":
        depth_val = op.get("depthMm")
        if depth_val is None:
            warnings.append(
                f"op[{index}] hole_from_profile depthMm required for depth mode (skipped)"
            )
            return wp
        depth = _require_finite_mm(depth_val, "hole_from_profile.depthMm")
        if depth <= 0:
            warnings.append(
                f"op[{index}] hole_from_profile depthMm must be > 0 (skipped)"
            )
            return wp
        cut_z0 = z_start
    else:
        warnings.append(f"op[{index}] hole_from_profile bad mode {mode!r} (skipped)")
        return wp
    tool_wp = cq.Workplane("XY").workplane(offset=cut_z0)
    tool_wp = _add_profile_to_workplane(tool_wp, prof)
    tool = tool_wp.extrude(depth)
    return work.cut(tool)


def _op_boolean_combine_profile(cq, wp, op, index, warnings, extras):
    profiles = _OP_CONTEXT.get("profiles") or []
    pidx = op.get("profileIndex")
    if not isinstance(pidx, int) or pidx < 0 or pidx >= len(profiles):
        warnings.append(
            f"op[{index}] boolean_combine_profile profileIndex out of range "
            f"({pidx}, have {len(profiles)}) (skipped)"
        )
        return wp
    prof = profiles[pidx]
    mode = op.get("mode")
    if mode not in ("union", "subtract", "intersect"):
        warnings.append(f"op[{index}] boolean_combine_profile bad mode {mode!r} (skipped)")
        return wp
    depth = _require_finite_mm(op.get("extrudeDepthMm"), "boolean_combine_profile.extrudeDepthMm")
    if depth <= 0:
        warnings.append(f"op[{index}] boolean_combine_profile extrudeDepthMm must be > 0 (skipped)")
        return wp
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "boolean_combine_profile.zStartMm")
    direction = op.get("extrudeDirection")
    if direction not in (None, "+Z", "-Z"):
        warnings.append(
            f"op[{index}] boolean_combine_profile extrudeDirection must be +Z or -Z (skipped)"
        )
        return wp
    tool_wp = cq.Workplane("XY").workplane(offset=z_start)
    tool_wp = _add_profile_to_workplane(tool_wp, prof)
    extrude_amt = -depth if direction == "-Z" else depth
    tool = tool_wp.extrude(extrude_amt)
    work = _coerce_wp(cq, wp)
    if mode == "union":
        return work.union(tool)
    if mode == "subtract":
        return work.cut(tool)
    return work.intersect(tool)


def _op_press_pull_profile(cq, wp, op, index, warnings, extras):
    profiles = _OP_CONTEXT.get("profiles") or []
    pidx = op.get("profileIndex")
    if not isinstance(pidx, int) or pidx < 0 or pidx >= len(profiles):
        warnings.append(
            f"op[{index}] press_pull_profile profileIndex out of range "
            f"({pidx}, have {len(profiles)}) (skipped)"
        )
        return wp
    prof = profiles[pidx]
    delta = _require_finite_mm(op.get("deltaMm"), "press_pull_profile.deltaMm")
    if delta == 0:
        warnings.append(f"op[{index}] press_pull_profile deltaMm must be non-zero (skipped)")
        return wp
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "press_pull_profile.zStartMm")
    tool_wp = cq.Workplane("XY").workplane(offset=z_start)
    tool_wp = _add_profile_to_workplane(tool_wp, prof)
    tool = tool_wp.extrude(abs(delta) if delta > 0 else -abs(delta))
    work = _coerce_wp(cq, wp)
    return work.union(tool) if delta > 0 else work.cut(tool)


def _op_transform_translate(cq, wp, op, index, warnings, extras):
    dx = _require_finite_mm(op.get("dxMm"), "transform_translate.dxMm")
    dy = _require_finite_mm(op.get("dyMm"), "transform_translate.dyMm")
    dz = _require_finite_mm(op.get("dzMm"), "transform_translate.dzMm")
    keep = bool(op.get("keepOriginal", False))
    work = _coerce_wp(cq, wp)
    moved = work.translate((dx, dy, dz))
    if keep:
        try:
            return work.union(moved)
        except Exception as exc:  # noqa: BLE001
            warnings.append(
                f"op[{index}] transform_translate keepOriginal union failed: {exc}"
            )
            return moved
    return moved


def _op_mirror_union_plane(cq, wp, op, index, warnings, extras):
    plane = op.get("plane")
    if plane not in ("YZ", "XZ", "XY"):
        warnings.append(f"op[{index}] mirror_union_plane bad plane {plane!r} (skipped)")
        return wp
    ox = _require_finite_mm(op.get("originXMm", 0.0), "mirror_union_plane.originXMm")
    oy = _require_finite_mm(op.get("originYMm", 0.0), "mirror_union_plane.originYMm")
    oz = _require_finite_mm(op.get("originZMm", 0.0), "mirror_union_plane.originZMm")
    work = _coerce_wp(cq, wp)
    solid = work.findSolid()
    base_pt = {"YZ": (ox, 0, 0), "XZ": (0, oy, 0), "XY": (0, 0, oz)}[plane]
    mirrored = solid.mirror(mirrorPlane=plane, basePointVector=base_pt)
    return work.union(cq.Workplane(obj=mirrored))


def _op_pattern_rectangular(cq, wp, op, index, warnings, extras):
    nx = int(op.get("countX", 1))
    ny = int(op.get("countY", 1))
    sx = _require_finite_mm(op.get("spacingXMm"), "pattern_rectangular.spacingXMm")
    sy = _require_finite_mm(op.get("spacingYMm"), "pattern_rectangular.spacingYMm")
    if nx < 1 or ny < 1 or (nx <= 1 and ny <= 1):
        warnings.append(f"op[{index}] pattern_rectangular needs countX>1 or countY>1 (skipped)")
        return wp
    work = _coerce_wp(cq, wp)
    base_solid = work.findSolid()
    acc = work
    for ix in range(nx):
        for iy in range(ny):
            if ix == 0 and iy == 0:
                continue
            inst = base_solid.translate((ix * sx, iy * sy, 0.0))
            acc = acc.union(cq.Workplane(obj=inst))
    return acc


def _op_pattern_circular(cq, wp, op, index, warnings, extras):
    count = int(op.get("count", 1))
    if count < 2:
        warnings.append(f"op[{index}] pattern_circular needs count>=2 (skipped)")
        return wp
    ccx = _require_finite_mm(op.get("centerXMm"), "pattern_circular.centerXMm")
    ccy = _require_finite_mm(op.get("centerYMm"), "pattern_circular.centerYMm")
    start = _require_finite_mm(op.get("startAngleDeg", 0.0), "pattern_circular.startAngleDeg")
    total = _require_finite_mm(op.get("totalAngleDeg", 360.0), "pattern_circular.totalAngleDeg")
    work = _coerce_wp(cq, wp)
    base_solid = work.findSolid()
    acc = work
    for i in range(1, count):
        ang = start + total * i / count
        inst = (
            base_solid.translate((-ccx, -ccy, 0.0))
            .rotate((0, 0, 0), (0, 0, 1), ang)
            .translate((ccx, ccy, 0.0))
        )
        acc = acc.union(cq.Workplane(obj=inst))
    return acc


def _op_pattern_linear_3d(cq, wp, op, index, warnings, extras):
    count = int(op.get("count", 1))
    if count < 2:
        warnings.append(f"op[{index}] pattern_linear_3d needs count>=2 (skipped)")
        return wp
    dx = _require_finite_mm(op.get("dxMm"), "pattern_linear_3d.dxMm")
    dy = _require_finite_mm(op.get("dyMm"), "pattern_linear_3d.dyMm")
    dz = _require_finite_mm(op.get("dzMm"), "pattern_linear_3d.dzMm")
    work = _coerce_wp(cq, wp)
    base_solid = work.findSolid()
    acc = work
    for i in range(1, count):
        inst = base_solid.translate((dx * i, dy * i, dz * i))
        acc = acc.union(cq.Workplane(obj=inst))
    return acc


def _op_pattern_path(cq, wp, op, index, warnings, extras):
    count = int(op.get("count", 1))
    pts = op.get("pathPoints")
    if count < 2 or not isinstance(pts, list) or len(pts) < 2:
        warnings.append(f"op[{index}] pattern_path needs count>=2 and >=2 path points (skipped)")
        return wp
    align = op.get("alignToPathTangent")
    if align is not None and not isinstance(align, bool):
        warnings.append(f"op[{index}] pattern_path alignToPathTangent must be a boolean (skipped)")
        return wp
    sampled = _sample_path(pts, count, bool(op.get("closedPath", False)))
    work = _coerce_wp(cq, wp)
    base_solid = work.findSolid()
    p0 = sampled[0]
    acc = work
    for i in range(1, len(sampled)):
        p = sampled[i]
        inst = base_solid.translate((p[0] - p0[0], p[1] - p0[1], 0.0))
        if align:
            # local +X follows tangent at the sample
            prev = sampled[i - 1]
            ang = math.degrees(math.atan2(p[1] - prev[1], p[0] - prev[0]))
            inst = (
                base_solid.translate((-p0[0], -p0[1], 0.0))
                .rotate((0, 0, 0), (0, 0, 1), ang)
                .translate((p[0], p[1], 0.0))
            )
        acc = acc.union(cq.Workplane(obj=inst))
    return acc


def _op_thread_wizard(cq, wp, op, index, warnings, extras):
    mode = op.get("mode", "modeled")
    if mode == "cosmetic":
        warnings.append(f"op[{index}] thread_wizard cosmetic: no geometry (marker only)")
        return wp
    cx = _require_finite_mm(op.get("centerXMm"), "thread_wizard.centerXMm")
    cy = _require_finite_mm(op.get("centerYMm"), "thread_wizard.centerYMm")
    major = _require_finite_mm(op.get("majorRadiusMm"), "thread_wizard.majorRadiusMm")
    pitch = _require_finite_mm(op.get("pitchMm"), "thread_wizard.pitchMm")
    length = _require_finite_mm(op.get("lengthMm"), "thread_wizard.lengthMm")
    depth = _require_finite_mm(op.get("depthMm"), "thread_wizard.depthMm")
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "thread_wizard.zStartMm")
    if major <= 0 or pitch <= 0 or length <= 0 or depth <= 0:
        warnings.append(f"op[{index}] thread_wizard skipped: non-positive dimension")
        return wp
    # Simplified modeled thread: stacked shallow ring cuts (cap at 256 rings).
    rings = min(256, max(1, int(length / pitch)))
    work = _coerce_wp(cq, wp)
    acc = work
    for i in range(rings):
        z = z_start + i * pitch
        ring = (
            cq.Workplane("XY")
            .transformed(offset=(cx, cy, z + pitch / 4))
            .circle(major)
            .circle(max(0.01, major - depth))
            .extrude(pitch / 2)
        )
        try:
            acc = acc.cut(ring)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"op[{index}] thread_wizard ring {i} cut failed: {exc}")
            break
    return acc


def _op_coil_cut(cq, wp, op, index, warnings, extras):
    cx = _require_finite_mm(op.get("centerXMm"), "coil_cut.centerXMm")
    cy = _require_finite_mm(op.get("centerYMm"), "coil_cut.centerYMm")
    major = _require_finite_mm(op.get("majorRadiusMm"), "coil_cut.majorRadiusMm")
    pitch = _require_finite_mm(op.get("pitchMm"), "coil_cut.pitchMm")
    turns = _require_finite_mm(op.get("turns"), "coil_cut.turns")
    depth = _require_finite_mm(op.get("depthMm"), "coil_cut.depthMm")
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "coil_cut.zStartMm")
    if major <= 0 or pitch <= 0 or turns <= 0 or depth <= 0:
        warnings.append(f"op[{index}] coil_cut skipped: non-positive dimension")
        return wp
    rings = min(1024, max(1, int(turns * 8)))
    work = _coerce_wp(cq, wp)
    acc = work
    total_h = pitch * turns
    for i in range(rings):
        z = z_start + total_h * i / rings
        ring = (
            cq.Workplane("XY")
            .transformed(offset=(cx, cy, z))
            .circle(major)
            .circle(max(0.01, major - depth))
            .extrude(max(0.05, total_h / rings))
        )
        try:
            acc = acc.cut(ring)
        except Exception as exc:  # noqa: BLE001
            warnings.append(f"op[{index}] coil_cut ring {i} failed: {exc}")
            break
    return acc


def _op_thicken_offset(cq, wp, op, index, warnings, extras):
    distance = _require_finite_mm(op.get("distanceMm"), "thicken_offset.distanceMm")
    if distance == 0:
        warnings.append(f"op[{index}] thicken_offset skipped: distanceMm must be non-zero")
        return wp
    work = _coerce_wp(cq, wp)
    try:
        solid = work.findSolid()
        offset = solid.thicken(distance) if hasattr(solid, "thicken") else None
        if offset is None:
            # Fall back to an OCC shell-less offset via CadQuery's shell on no faces.
            warnings.append(
                f"op[{index}] thicken_offset: kernel offset unavailable; left unchanged"
            )
            return wp
        return cq.Workplane(obj=offset)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"op[{index}] thicken_offset failed: {exc} (left unchanged)")
        return wp


def _op_sweep_profile_path_true(cq, wp, op, index, warnings, extras):
    profiles = _OP_CONTEXT.get("profiles") or []
    pidx = op.get("profileIndex")
    if not isinstance(pidx, int) or pidx < 0 or pidx >= len(profiles):
        warnings.append(
            f"op[{index}] sweep_profile_path_true profileIndex out of range "
            f"({pidx}, have {len(profiles)}) (skipped)"
        )
        return wp
    prof = profiles[pidx]
    pts = op.get("pathPoints")
    if not isinstance(pts, list) or len(pts) < 2:
        warnings.append(f"op[{index}] sweep_profile_path_true needs >=2 path points (skipped)")
        return wp
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "sweep_profile_path_true.zStartMm")
    # Build a true sweep along the XY polyline path.
    try:
        path_pts = [(float(p[0]), float(p[1])) for p in pts]
        path = cq.Workplane("XY").workplane(offset=z_start).polyline(path_pts)
        section = _add_profile_to_workplane(
            cq.Workplane("XY").workplane(offset=z_start), prof
        )
        swept = section.sweep(path, multisection=False)
        return _coerce_wp(cq, wp).union(swept)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"op[{index}] sweep_profile_path_true failed: {exc} (skipped)")
        return wp


def _op_pipe_path(cq, wp, op, index, warnings, extras):
    pts = op.get("pathPoints")
    outer = _require_finite_mm(op.get("outerRadiusMm"), "pipe_path.outerRadiusMm")
    if not isinstance(pts, list) or len(pts) < 2 or outer <= 0:
        warnings.append(f"op[{index}] pipe_path needs >=2 path points and outerRadiusMm>0 (skipped)")
        return wp
    wall = op.get("wallThicknessMm")
    z_start = _require_finite_mm(op.get("zStartMm", 0.0), "pipe_path.zStartMm")
    try:
        path_pts = [(float(p[0]), float(p[1])) for p in pts]
        path = cq.Workplane("XY").workplane(offset=z_start).polyline(path_pts)
        section = (
            cq.Workplane("XY")
            .workplane(offset=z_start)
            .moveTo(path_pts[0][0], path_pts[0][1])
            .circle(outer)
        )
        if wall is not None:
            wall_f = _require_finite_mm(wall, "pipe_path.wallThicknessMm")
            if 0 < wall_f < outer:
                section = section.circle(outer - wall_f)
        swept = section.sweep(path, multisection=False)
        return _coerce_wp(cq, wp).union(swept)
    except Exception as exc:  # noqa: BLE001
        warnings.append(f"op[{index}] pipe_path failed: {exc} (skipped)")
        return wp


def _op_sheet_tab_union(cq, wp, op, index, warnings, extras):
    cx = _require_finite_mm(op.get("centerXMm"), "sheet_tab_union.centerXMm")
    cy = _require_finite_mm(op.get("centerYMm"), "sheet_tab_union.centerYMm")
    z_base = _require_finite_mm(op.get("zBaseMm"), "sheet_tab_union.zBaseMm")
    length = _require_finite_mm(op.get("lengthMm"), "sheet_tab_union.lengthMm")
    width = _require_finite_mm(op.get("widthMm"), "sheet_tab_union.widthMm")
    height = _require_finite_mm(op.get("heightMm"), "sheet_tab_union.heightMm")
    if length <= 0 or width <= 0 or height <= 0:
        warnings.append(f"op[{index}] sheet_tab_union skipped: non-positive dimension")
        return wp
    tool = (
        cq.Workplane("XY")
        .workplane(offset=z_base)
        .moveTo(cx, cy)
        .rect(length, width)
        .extrude(height)
    )
    return _coerce_wp(cq, wp).union(tool)


def _op_sheet_fold(cq, wp, op, index, warnings, extras):
    # A true bend is out of scope for the consumer; emit a flat-pattern-aware
    # marker so the manifest records the fold without crashing the build.
    warnings.append(
        f"op[{index}] sheet_fold: bend modeled as marker (flat geometry unchanged)"
    )
    return wp


def _op_sheet_flat_pattern(cq, wp, op, index, warnings, extras):
    include = op.get("includeBendLines", True)
    extras["flatPatternStrategy"] = (
        "flat+bendlines" if include else "flat+nobendlines"
    )
    return wp


def _op_loft_guide_rails(cq, wp, op, index, warnings, extras):
    behavior = op.get("behavior")
    extras["loftGuideRailsKernelMode"] = (
        "marker" if behavior == "marker" else "sketch_xy_align"
    )
    return wp


# ── Construct datums (reference geometry — markers; never touch the solid) ────
#
# A datum is CONSTRUCTION GEOMETRY: it anchors later sketches/features but does
# not change the body. So each handler validates its fields, records a manifest
# marker in ``extras["datums"]``, and returns the workplane UNCHANGED (the
# kernel is sacred — a datum can never modify or crash the solid). A bad field
# is a skip-with-warning, exactly like the other marker ops.


def _append_datum(extras: Dict[str, Any], entry: Dict[str, Any]) -> None:
    bucket = extras.setdefault("datums", [])
    bucket.append(entry)


def _op_datum_plane(cq, wp, op, index, warnings, extras):
    base = str(op.get("basePlane", "")).upper()
    if base not in ("XY", "XZ", "YZ"):
        warnings.append(
            f"op[{index}] datum_plane skipped: basePlane must be XY/XZ/YZ"
        )
        return wp
    offset = _require_finite_mm(op.get("offsetMm", 0.0), "datum_plane.offsetMm")
    entry: Dict[str, Any] = {"kind": "datum_plane", "basePlane": base, "offsetMm": offset}
    label = op.get("label")
    if isinstance(label, str) and label:
        entry["label"] = label[:80]
    _append_datum(extras, entry)
    return wp


def _op_datum_axis(cq, wp, op, index, warnings, extras):
    axis = str(op.get("axis", "")).upper()
    if axis not in ("X", "Y", "Z"):
        warnings.append(f"op[{index}] datum_axis skipped: axis must be X/Y/Z")
        return wp
    ox = _require_finite_mm(op.get("originXMm", 0.0), "datum_axis.originXMm")
    oy = _require_finite_mm(op.get("originYMm", 0.0), "datum_axis.originYMm")
    oz = _require_finite_mm(op.get("originZMm", 0.0), "datum_axis.originZMm")
    entry: Dict[str, Any] = {
        "kind": "datum_axis",
        "axis": axis,
        "originMm": [ox, oy, oz],
    }
    label = op.get("label")
    if isinstance(label, str) and label:
        entry["label"] = label[:80]
    _append_datum(extras, entry)
    return wp


def _op_datum_point(cq, wp, op, index, warnings, extras):
    x = _require_finite_mm(op.get("xMm"), "datum_point.xMm")
    y = _require_finite_mm(op.get("yMm"), "datum_point.yMm")
    z = _require_finite_mm(op.get("zMm"), "datum_point.zMm")
    entry: Dict[str, Any] = {"kind": "datum_point", "pointMm": [x, y, z]}
    label = op.get("label")
    if isinstance(label, str) and label:
        entry["label"] = label[:80]
    _append_datum(extras, entry)
    return wp


def _op_plastic_rule_fillet(cq, wp, op, index, warnings, extras):
    radius = _require_finite_mm(op.get("radiusMm"), "plastic_rule_fillet.radiusMm")
    if radius <= 0:
        warnings.append(f"op[{index}] plastic_rule_fillet skipped: radiusMm must be > 0")
        return wp
    work = _coerce_wp(cq, wp)
    try:
        if not work.edges().objects:
            warnings.append(f"op[{index}] plastic_rule_fillet skipped: no edges")
            return wp
        return work.edges().fillet(radius)
    except Exception as exc:  # noqa: BLE001
        warnings.append(
            f"op[{index}] plastic_rule_fillet failed (radius {radius}): {exc} (left unchanged)"
        )
        return wp


def _op_plastic_boss(cq, wp, op, index, warnings, extras):
    cx = _require_finite_mm(op.get("centerXMm"), "plastic_boss.centerXMm")
    cy = _require_finite_mm(op.get("centerYMm"), "plastic_boss.centerYMm")
    z_base = _require_finite_mm(op.get("zBaseMm"), "plastic_boss.zBaseMm")
    outer = _require_finite_mm(op.get("outerRadiusMm"), "plastic_boss.outerRadiusMm")
    height = _require_finite_mm(op.get("heightMm"), "plastic_boss.heightMm")
    hole = op.get("holeRadiusMm")
    if outer <= 0 or height <= 0:
        warnings.append(f"op[{index}] plastic_boss skipped: non-positive dimension")
        return wp
    boss = (
        cq.Workplane("XY")
        .workplane(offset=z_base)
        .moveTo(cx, cy)
        .circle(outer)
        .extrude(height)
    )
    work = _coerce_wp(cq, wp).union(boss)
    if hole is not None:
        hole_f = _require_finite_mm(hole, "plastic_boss.holeRadiusMm")
        if 0 < hole_f < outer:
            bore = (
                cq.Workplane("XY")
                .workplane(offset=z_base)
                .moveTo(cx, cy)
                .circle(hole_f)
                .extrude(height)
            )
            work = work.cut(bore)
    return work


def _op_plastic_lip_groove(cq, wp, op, index, warnings, extras):
    mode = op.get("mode")
    if mode not in ("lip", "groove"):
        warnings.append(f"op[{index}] plastic_lip_groove bad mode {mode!r} (skipped)")
        return wp
    x0 = _require_finite_mm(op.get("xMinMm"), "plastic_lip_groove.xMinMm")
    x1 = _require_finite_mm(op.get("xMaxMm"), "plastic_lip_groove.xMaxMm")
    y0 = _require_finite_mm(op.get("yMinMm"), "plastic_lip_groove.yMinMm")
    y1 = _require_finite_mm(op.get("yMaxMm"), "plastic_lip_groove.yMaxMm")
    z_base = _require_finite_mm(op.get("zBaseMm"), "plastic_lip_groove.zBaseMm")
    depth = _require_finite_mm(op.get("depthMm"), "plastic_lip_groove.depthMm")
    if not (x1 > x0 and y1 > y0) or depth <= 0:
        warnings.append(f"op[{index}] plastic_lip_groove skipped: bad extents/depth")
        return wp
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bar = (
        cq.Workplane("XY")
        .workplane(offset=z_base)
        .moveTo(cx, cy)
        .rect(x1 - x0, y1 - y0)
        .extrude(depth)
    )
    work = _coerce_wp(cq, wp)
    return work.union(bar) if mode == "lip" else work.cut(bar)


def _sample_path(
    pts: List[Any], count: int, closed: bool
) -> List[Tuple[float, float]]:
    """Sample ``count`` evenly-spaced points along a polyline path by arc length."""
    poly = [(float(p[0]), float(p[1])) for p in pts]
    if closed and len(poly) >= 3 and (poly[0] != poly[-1]):
        poly = poly + [poly[0]]
    seglen = []
    total = 0.0
    for i in range(1, len(poly)):
        d = math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1])
        seglen.append(d)
        total += d
    if total <= 1e-9:
        return [poly[0]] * count
    out: List[Tuple[float, float]] = []
    for k in range(count):
        target = total * k / max(1, count - 1) if count > 1 else 0.0
        acc = 0.0
        placed = False
        for i in range(1, len(poly)):
            if acc + seglen[i - 1] >= target or i == len(poly) - 1:
                seg = seglen[i - 1] if seglen[i - 1] > 1e-12 else 1.0
                t = max(0.0, min(1.0, (target - acc) / seg))
                x = poly[i - 1][0] + t * (poly[i][0] - poly[i - 1][0])
                y = poly[i - 1][1] + t * (poly[i][1] - poly[i - 1][1])
                out.append((x, y))
                placed = True
                break
            acc += seglen[i - 1]
        if not placed:
            out.append(poly[-1])
    return out


# Dispatch table: op kind -> handler(cq, wp, op, index, warnings, extras).
# fillet_select / chamfer_select / shell_inward are handled inline in
# _apply_post_solid_ops via the validated appliers (different signature).
_OP_DISPATCH: Dict[str, Any] = {
    "fillet_all": _op_fillet_all,
    "chamfer_all": _op_chamfer_all,
    "boolean_union_box": _op_boolean_union_box,
    "boolean_subtract_box": _op_boolean_subtract_box,
    "boolean_intersect_box": _op_boolean_intersect_box,
    "boolean_subtract_cylinder": _op_boolean_subtract_cylinder,
    "boolean_combine_profile": _op_boolean_combine_profile,
    "split_keep_halfspace": _op_split_keep_halfspace,
    "hole_from_profile": _op_hole_from_profile,
    "press_pull_profile": _op_press_pull_profile,
    "transform_translate": _op_transform_translate,
    "mirror_union_plane": _op_mirror_union_plane,
    "pattern_rectangular": _op_pattern_rectangular,
    "pattern_circular": _op_pattern_circular,
    "pattern_linear_3d": _op_pattern_linear_3d,
    "pattern_path": _op_pattern_path,
    "thread_wizard": _op_thread_wizard,
    "coil_cut": _op_coil_cut,
    "thicken_offset": _op_thicken_offset,
    "sweep_profile_path_true": _op_sweep_profile_path_true,
    "pipe_path": _op_pipe_path,
    "sheet_tab_union": _op_sheet_tab_union,
    "sheet_fold": _op_sheet_fold,
    "sheet_flat_pattern": _op_sheet_flat_pattern,
    "loft_guide_rails": _op_loft_guide_rails,
    "plastic_rule_fillet": _op_plastic_rule_fillet,
    "plastic_boss": _op_plastic_boss,
    "plastic_lip_groove": _op_plastic_lip_groove,
    "datum_plane": _op_datum_plane,
    "datum_axis": _op_datum_axis,
    "datum_point": _op_datum_point,
}

# Profiles are needed by profile-index ops (hole/combine/press-pull/sweep). The
# dispatcher passes (cq, wp, op, index, warnings, extras); profiles ride in this
# per-build context dict set at the top of build_part(). (A module global keeps
# the handler signature small; build_part is single-threaded per process.)
_OP_CONTEXT: Dict[str, Any] = {}


# ── STEP + STL export ────────────────────────────────────────────────────────


def _export_step(cq: Any, wp: Any, out_path: Path) -> None:
    cq.exporters.export(wp, str(out_path))
    if not out_path.is_file() or out_path.stat().st_size == 0:
        raise _BuildError(f"STEP export produced no file at {out_path}")


def _export_stl(wp: Any, out_path: Path, tolerance_mm: float) -> int:
    """Tessellate + write a binary STL, reusing the validated writer. Returns
    the triangle count. Raises ``_BuildError`` on failure."""
    from engines.cad.cadquery_import import (  # noqa: PLC0415
        _binary_stl_size,
        _build_binary_stl,
    )

    try:
        solid = wp.findSolid()
        vertices, triangles = solid.tessellate(float(tolerance_mm))
    except Exception as exc:  # noqa: BLE001
        raise _BuildError(f"STL tessellation failed: {exc}", detail=str(exc))
    payload, triangle_count = _build_binary_stl(vertices, triangles)
    if triangle_count == 0:
        raise _BuildError("STL tessellation produced zero usable triangles")
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(payload)
    except OSError as exc:
        raise _BuildError(f"failed to write STL {out_path}: {exc}", detail=str(exc))
    on_disk = out_path.stat().st_size
    expected = _binary_stl_size(triangle_count)
    if on_disk != expected:
        raise _BuildError(
            f"STL short write: wrote {on_disk}, expected {expected} "
            f"({triangle_count} triangles)"
        )
    return triangle_count


# Default STL surface tolerance (mm) — matches the sidecar export default.
_DEFAULT_STL_TOLERANCE_MM = 0.1


def _stl_tolerance_from_payload(payload: Dict[str, Any]) -> float:
    """Map the optional ``stlMeshAngularToleranceDeg`` to a linear surface
    tolerance for ``solid.tessellate``. The schema field is angular (degrees);
    finer angle -> finer mesh, so we scale the linear default down for small
    angles. Bounded so a pathological value can't explode mesh size."""
    raw = payload.get("stlMeshAngularToleranceDeg")
    if not isinstance(raw, (int, float)) or not math.isfinite(float(raw)) or float(raw) <= 0:
        return _DEFAULT_STL_TOLERANCE_MM
    angle = float(raw)
    # Map ~30deg (coarse) -> 0.2mm, ~5deg (fine) -> ~0.05mm. Clamp [0.02, 0.3].
    scaled = _DEFAULT_STL_TOLERANCE_MM * (angle / 15.0)
    return max(0.02, min(0.3, scaled))


# ── Build orchestration ──────────────────────────────────────────────────────


def build_part(payload: Dict[str, Any], output_dir: str, base: str) -> Dict[str, Any]:
    """Pure build entry point (testable). Returns the OK manifest-extras dict
    (without the ``ok`` flag). Raises ``_PayloadError`` / ``_BuildError`` /
    ``_UnknownSolidKind`` / ``_CadQueryMissing`` for the caller to map."""
    try:
        import cadquery as cq  # noqa: PLC0415
    except ImportError as exc:  # pragma: no cover - exercised only without cadquery
        raise _CadQueryMissing(str(exc))

    version = payload.get("version")
    if version not in (1, 2, 3, 4):
        raise _BadPayloadVersion(f"unsupported payload version {version!r}")

    profiles = payload.get("profiles")
    _OP_CONTEXT["profiles"] = profiles if isinstance(profiles, list) else []

    warnings: List[str] = []

    # 1) BASE solid (canonical space).
    wp, extras = _build_base_solid(cq, payload)

    # 2) Post-solid ops, in array order (canonical space — placement comes last).
    ops = payload.get("postSolidOps")
    if isinstance(ops, list) and ops:
        wp, op_extras = _apply_post_solid_ops(cq, wp, ops, warnings)
        extras.update(op_extras)

    # 3) Confirm a solid survived before placement/export.
    try:
        wp.findSolid()
    except Exception as exc:  # noqa: BLE001
        raise _BuildError(f"no solid after post-ops: {exc}", detail=str(exc))

    # 4) Placement: canonical -> world (matches the renderer preview transform).
    plane = payload.get("sketchPlane")
    if isinstance(plane, dict):
        wp = _apply_placement(cq, wp, plane)

    # 5) Export STEP + STL into output_dir.
    out_dir = Path(output_dir)
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        raise _OutputDirError(str(exc))

    step_path = out_dir / f"{base}.step"
    stl_path = out_dir / f"{base}.stl"
    tolerance = _stl_tolerance_from_payload(payload)

    try:
        _export_step(cq, wp, step_path)
    except _BuildError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise _BuildError(f"STEP export failed: {exc}", detail=str(exc))

    _export_stl(wp, stl_path, tolerance)

    result: Dict[str, Any] = {
        "stepPath": str(step_path),
        "stlPath": str(stl_path),
    }
    # Surface manifest-relevant extras the TS reader looks for.
    if "loftStrategy" in extras:
        result["loftStrategy"] = extras["loftStrategy"]
    if "flatPatternStrategy" in extras:
        result["flatPatternStrategy"] = extras["flatPatternStrategy"]
    if "splitKeepHalfspace" in extras:
        result["splitKeepHalfspace"] = extras["splitKeepHalfspace"]
    if "loftGuideRailsKernelMode" in extras:
        result["loftGuideRailsKernelMode"] = extras["loftGuideRailsKernelMode"]
    # Construct datums (reference geometry markers) — surfaced so the TS reader
    # / a future browser can list them. Never affects geometry (Safety Rule 1).
    if extras.get("datums"):
        result["datums"] = extras["datums"]
    if warnings:
        result["warnings"] = warnings
    return result


class _CadQueryMissing(Exception):
    pass


class _BadPayloadVersion(Exception):
    pass


class _OutputDirError(Exception):
    pass


def main(argv: List[str]) -> None:
    if len(argv) < 4:
        _emit_fail(
            "usage",
            "build_part.py <payloadPath> <outputDir> <base>",
        )
    payload_path = argv[1]
    output_dir = argv[2]
    base = argv[3]

    payload = _load_payload(payload_path)

    try:
        result = build_part(payload, output_dir, base)
    except _CadQueryMissing as exc:
        _emit_fail(
            "cadquery_not_installed",
            f"CadQuery is not installed in the sidecar Python: {exc}",
        )
    except _BadPayloadVersion as exc:
        _emit_fail("bad_payload_version", str(exc))
    except _UnknownSolidKind as exc:
        _emit_fail("unknown_solid_kind", str(exc))
    except _PayloadError as exc:
        _emit_fail("invalid_payload", str(exc))
    except _OutputDirError as exc:
        _emit_fail("output_dir_failed", str(exc))
    except _BuildError as exc:
        _emit_fail("build_failed", getattr(exc, "detail", "") or str(exc))
    except Exception as exc:  # noqa: BLE001 - last-resort: never dump a traceback as the result line
        _emit_fail("build_failed", f"unexpected: {exc}")

    _emit_ok(result)


if __name__ == "__main__":
    main(sys.argv)
