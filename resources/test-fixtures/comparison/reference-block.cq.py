# WorkTrack3D comparison reference part (3D) — for the Carvera 3-axis comparison.
#
# A small, deterministic stepped block: 60 x 40 x 15 mm with a 10 mm-wide step
# down one side and a centred circular pocket (diam 20, depth 5). Simple enough
# that a pocket + a profile + a facing pass produce predictable, comparable
# toolpaths across WorkTrack3D, the Carvera CAM app, and (optionally) VCarve.
#
# Build it in WorkTrack3D (Design -> Run), then "Export" -> STEP or STL and load
# that SAME export into the Carvera CAM app so both toolpath against identical
# geometry. See docs/COMPARISON-TEST.md for the op parameters to match.
#
# cqgi-compatible: assigns the final solid to `result` and calls show_object.

import cadquery as cq

LENGTH = 60.0   # X
WIDTH = 40.0    # Y
HEIGHT = 15.0   # Z
STEP_WIDTH = 10.0   # the lowered step along +X edge
STEP_DROP = 5.0     # how far the step is lowered from the top
POCKET_DIAM = 20.0
POCKET_DEPTH = 5.0

# Base block, origin at a bottom corner so X in [0,60], Y in [0,40], Z in [0,15]
# (matches the work-zero convention the comparison doc uses: WCS at the
# bottom-left-top of the stock, Z down into the material).
block = cq.Workplane("XY").box(LENGTH, WIDTH, HEIGHT, centered=False)

# A lowered step along the +X edge (a face the Carvera will surface/contour).
block = (
    block.faces(">Z")
    .workplane()
    .moveTo(LENGTH - STEP_WIDTH / 2.0, WIDTH / 2.0)
    .rect(STEP_WIDTH, WIDTH)
    .cutBlind(-STEP_DROP)
)

# A centred circular pocket in the top face (the v-carve / pocket target).
block = (
    block.faces(">Z")
    .workplane()
    .moveTo(LENGTH / 2.0 - 10.0, WIDTH / 2.0)
    .circle(POCKET_DIAM / 2.0)
    .cutBlind(-POCKET_DEPTH)
)

result = block
show_object(result, name="reference-block")
