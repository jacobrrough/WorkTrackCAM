"""WorkTrackCAM Python sidecar.

A per-job long-running subprocess the Electron main process spawns to drive
CAD operations (CadQuery / OpenCascade) and CAM operations (OpenCAMLib).
Communicates via JSON-RPC over stdin/stdout; one JSON object per line.

See `main.py` for the request loop and `src/shared/sidecar-protocol.ts` for
the TypeScript-side wire contract.
"""

__version__ = "0.1.0"
