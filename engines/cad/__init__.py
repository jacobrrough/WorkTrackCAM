"""CadQuery-backed CAD engines for WorkTrackCAM.

This package owns the pure functional core for STEP import + tessellation
that the sidecar handlers in ``engines/sidecar/cad_handlers.py`` call into.

Mirrors the split used by the CAM engine: pure numerics + side-effects (file
I/O, in-memory handle table) here; JSON-RPC envelope + param validation in the
sidecar handler. This keeps the cadquery dependency out of the import path
when callers only want the wire types or error codes.
"""
