# WorkTrackCAM CadQuery starter: L-bracket
#
# A simple right-angle mounting bracket -- two perpendicular plates joined
# by a fillet, each plate carries a counterbored mounting hole. Geared at
# the Laguna Swift 5x10 (full-sheet plywood / aluminum plate) and the
# Makera Carvera 3-axis (desktop aluminum), so dimensions stay inside
# both work envelopes (60 x 40 x 40 mm).
#
# Parameters are bare top-level names so the read-only FeatureTree
# surfaces them via cad.list_operations, and the renderer can override
# them via buildParameters on cad.execute_script.

import cadquery as cq

# ── Parameters (edit these or override from the FeatureTree) ──
plate_length = 60.0    # mm -- along X, the "long" plate
plate_width = 40.0     # mm -- along Y
plate_thickness = 5.0  # mm -- material thickness for both plates
upright_height = 40.0  # mm -- along Z, the upright plate height
hole_diameter = 6.0    # mm -- mounting through-hole
hole_inset = 10.0      # mm -- distance from each plate edge to hole center
fillet_radius = 3.0    # mm -- outside edge fillet to remove sharp corners

# ── Geometry ──
# Base plate sits flat on XY, hole pair on its centerline.
base = (
    cq.Workplane("XY")
    .box(plate_length, plate_width, plate_thickness, centered=(False, True, False))
    .faces(">Z")
    .workplane()
    .pushPoints([
        (hole_inset, 0),
        (plate_length - hole_inset, 0),
    ])
    .hole(hole_diameter)
)

# Upright plate stands on the +X end of the base, full width in Y.
upright = (
    cq.Workplane("YZ")
    .workplane(offset=plate_length - plate_thickness)
    .box(plate_width, upright_height, plate_thickness, centered=(True, False, False))
    .faces(">X")
    .workplane()
    .pushPoints([
        (0, hole_inset),
        (0, upright_height - hole_inset),
    ])
    .hole(hole_diameter)
)

# Union the two plates and fillet the two long outside corners so the
# bracket is friendly to a 3 mm radius end mill on either machine.
result = (
    base.union(upright)
    .edges("|Y and (>X or >Z)")
    .fillet(fillet_radius)
)

show_object(result)
