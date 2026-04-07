#!/usr/bin/env python3
"""
Convert STEP (.step/.stp) and IGES (.iges/.igs) files to binary STL.

Uses CadQuery (which wraps OpenCASCADE/OCP) for BRep tessellation.
Falls back to OCP directly if CadQuery is not installed.

Usage:
    python step_to_stl.py <input_path> <output_stl_path> [--tolerance 0.1] [--angular 0.5]

Outputs a single JSON line on stdout:
    {"ok": true, "vertices": 1234, "faces": 5678}
    {"ok": false, "error": "...", "detail": "..."}
"""

import json
import os
import sys

DEFAULT_LINEAR_TOLERANCE = 0.1   # mm
DEFAULT_ANGULAR_TOLERANCE = 0.5  # degrees


def result_ok(vertices: int, faces: int) -> None:
    print(json.dumps({"ok": True, "vertices": vertices, "faces": faces}))
    sys.exit(0)


def result_fail(error: str, detail: str = "") -> None:
    print(json.dumps({"ok": False, "error": error, "detail": detail}))
    sys.exit(1)


def convert_with_cadquery(
    input_path: str,
    output_path: str,
    linear_tol: float,
    angular_tol: float,
) -> None:
    """Convert STEP or IGES to STL using CadQuery."""
    try:
        import cadquery as cq  # type: ignore
    except ImportError:
        raise ImportError("cadquery")

    ext = os.path.splitext(input_path)[1].lower()
    try:
        if ext in (".iges", ".igs"):
            shape = cq.importers.importStep(input_path)  # CadQuery uses importStep for IGES too via OCCT
            # If importStep doesn't work for IGES, try the OCP direct path
        else:
            shape = cq.importers.importStep(input_path)
    except Exception:
        # CadQuery's importStep may not handle IGES in all versions.
        # Fall back to OCP direct import for IGES.
        if ext in (".iges", ".igs"):
            raise ImportError("cadquery_iges_fallback")
        raise

    cq.exporters.export(
        shape,
        output_path,
        exportType=cq.exporters.ExportTypes.STL,
        tolerance=linear_tol,
        angularTolerance=angular_tol,
    )


def convert_with_ocp(
    input_path: str,
    output_path: str,
    linear_tol: float,
    angular_tol: float,
) -> None:
    """Convert STEP or IGES to STL using OCP (OpenCASCADE Python bindings) directly."""
    try:
        from OCP.STEPControl import STEPControl_Reader  # type: ignore
        from OCP.IGESControl import IGESControl_Reader  # type: ignore
        from OCP.StlAPI import StlAPI_Writer  # type: ignore
        from OCP.BRepMesh import BRepMesh_IncrementalMesh  # type: ignore
        from OCP.IFSelect import IFSelect_RetDone  # type: ignore
    except ImportError:
        raise ImportError("OCP")

    import math

    ext = os.path.splitext(input_path)[1].lower()

    if ext in (".iges", ".igs"):
        reader = IGESControl_Reader()
        status = reader.ReadFile(input_path)
    else:
        reader = STEPControl_Reader()
        status = reader.ReadFile(input_path)

    if status != IFSelect_RetDone:
        result_fail(
            "cad_read_failed",
            f"OpenCASCADE reader returned status {status} for {os.path.basename(input_path)}",
        )

    reader.TransferRoots()
    shape = reader.OneShape()

    angular_rad = math.radians(angular_tol)
    mesh = BRepMesh_IncrementalMesh(shape, linear_tol, False, angular_rad, True)
    mesh.Perform()
    if not mesh.IsDone():
        result_fail("tessellation_failed", "BRepMesh_IncrementalMesh did not complete")

    writer = StlAPI_Writer()
    writer.SetASCIIMode(False)  # binary STL
    success = writer.Write(shape, output_path)
    if not success:
        result_fail("stl_write_failed", f"StlAPI_Writer.Write returned False for {output_path}")


def count_stl_triangles(stl_path: str) -> tuple:
    """Read binary STL header to get face count, estimate vertex count."""
    with open(stl_path, "rb") as f:
        f.seek(80)  # skip header
        import struct
        count_bytes = f.read(4)
        if len(count_bytes) < 4:
            return (0, 0)
        faces = struct.unpack("<I", count_bytes)[0]
        vertices = faces * 3  # each triangle has 3 vertices (not deduplicated)
    return (vertices, faces)


def main() -> None:
    if len(sys.argv) < 3:
        result_fail("usage", "step_to_stl.py <input> <output.stl> [--tolerance N] [--angular N]")

    input_path = sys.argv[1]
    output_path = sys.argv[2]

    linear_tol = DEFAULT_LINEAR_TOLERANCE
    angular_tol = DEFAULT_ANGULAR_TOLERANCE

    # Parse optional flags
    args = sys.argv[3:]
    i = 0
    while i < len(args):
        if args[i] == "--tolerance" and i + 1 < len(args):
            linear_tol = float(args[i + 1])
            i += 2
        elif args[i] == "--angular" and i + 1 < len(args):
            angular_tol = float(args[i + 1])
            i += 2
        else:
            i += 1

    if not os.path.isfile(input_path):
        result_fail("file_not_found", f"Input file not found: {input_path}")

    ext = os.path.splitext(input_path)[1].lower()
    if ext not in (".step", ".stp", ".iges", ".igs"):
        result_fail(
            "unsupported_format",
            f"Expected .step, .stp, .iges, or .igs — got '{ext}'",
        )

    # Ensure output directory exists
    out_dir = os.path.dirname(output_path)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)

    # Strategy: try CadQuery first (common in CAM environments), then OCP directly
    errors = []

    # Attempt 1: CadQuery
    try:
        convert_with_cadquery(input_path, output_path, linear_tol, angular_tol)
        if os.path.isfile(output_path) and os.path.getsize(output_path) > 84:
            verts, faces = count_stl_triangles(output_path)
            result_ok(verts, faces)
    except ImportError as e:
        errors.append(f"CadQuery: {e}")
    except Exception as e:
        errors.append(f"CadQuery conversion: {e}")

    # Attempt 2: OCP direct
    try:
        convert_with_ocp(input_path, output_path, linear_tol, angular_tol)
        if os.path.isfile(output_path) and os.path.getsize(output_path) > 84:
            verts, faces = count_stl_triangles(output_path)
            result_ok(verts, faces)
    except ImportError as e:
        errors.append(f"OCP: {e}")
    except Exception as e:
        errors.append(f"OCP conversion: {e}")

    # Both failed
    detail_parts = []
    for err in errors:
        detail_parts.append(str(err))
    detail_parts.append(
        "Install CadQuery (pip install cadquery) or OCP (pip install cadquery-ocp) "
        "to enable STEP/IGES import."
    )
    result_fail("step_iges_deps_missing", " | ".join(detail_parts))


if __name__ == "__main__":
    main()
