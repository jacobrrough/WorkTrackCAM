"""OCCT/CadQuery standalone engine scripts for WorkTrack3D.

Holds the file-path entry points the Electron main process spawns directly
(``step_to_stl.py`` for STEP/IGES import; ``build_part.py`` for the no-code
kernel-op build consumer). ``build_part.py`` reuses the validated CAD core in
``engines/cad`` (the apply_*_select_op appliers + the binary-STL writer) rather
than re-implementing geometry, so there is a single source of truth.

The package marker lets the test suite import the consumer as
``engines.occt.build_part`` from the repo root (matching how the other
``engines.*`` packages are imported in ``engines/sidecar/__tests__``).
"""
