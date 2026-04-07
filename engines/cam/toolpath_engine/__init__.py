"""
Production-grade CNC toolpath engine for Unified Fab Studio.

v4.0 — Full multi-axis rewrite with 14 strategies and production-grade algorithms.

3-axis strategies:
- Adaptive clearing with true constant-engagement and in-process stock tracking
- Waterline Z-level finishing with scallop-optimized stepdown and chain ordering
- Raster surface-following finishing
- Pencil trace concave cleanup
- Rest machining with dual-heightfield comparison
- Spiral finishing for smooth freeform surfaces
- Morphing finish (automatic Z-level/raster blend)
- Trochoidal HSM slot clearing
- Steep-and-shallow finishing (automatic region-based waterline/raster split)
- Constant-scallop-height finishing (adaptive stepover from surface angle)

4-axis strategies:
- Continuous 4-axis simultaneous (cylindrical heightmap + helical ramp entry)

5-axis strategies:
- 5-axis contour (normal-following with collision avoidance)
- 5-axis swarf cutting (flank milling for steep walls)
- 5-axis flowline (surface-following with angular rate limits)

Core engine:
- Drop-cutter algorithm for flat/ball/bull endmills (7 tests per triangle)
- Hash-based O(n) mesh slicing with robust contour offset
- Toolpath linking optimizer (TSP reordering, retract optimization, arc fitting)
- Douglas-Peucker path simplification
- Multi-controller G-code post-processing (Fanuc, GRBL, Siemens, Heidenhain)
  with RTCP/TCP support and inverse-time feed for 5-axis
- Auto-strategy selection based on mesh geometry analysis
- Multi-objective feed/speed optimization
- Enhanced simulation with vectorized heightfield-based material tracking
- Detailed machining report with cycle time, MRR, wear, and recommendations

IPC contract (compatible with existing engines):
  python -m engines.cam.toolpath_engine <config.json>
  Output: {"ok": true, "toolpathLines": [...], "strategy": "...", "report": {...}} to toolpathJsonPath
"""
__version__ = "4.0.0"
