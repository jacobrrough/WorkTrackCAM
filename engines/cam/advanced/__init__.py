"""
Advanced CNC toolpath engine for Unified Fab Studio.

Provides adaptive roughing, waterline finishing, raster finishing,
rest machining, feed optimization, and multi-controller post-processing.

IPC contract matches existing engines:
  python -m engines.cam.advanced <config.json>
  Output: {"ok": true, "toolpathLines": [...], "strategy": "..."} to toolpathJsonPath
"""
__version__ = "0.1.0"
