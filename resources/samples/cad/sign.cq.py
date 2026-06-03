# WorkTrack3D CadQuery starter: engraved sign-board
#
# A 200 x 100 x 6 mm rectangular plate with "WorkTrack3D" text recessed
# into the front face. Sized for a Laguna Swift 5x10 v-carve or pocket
# operation on hardwood / plywood signage stock. The recess depth is
# small (1.2 mm) so the same model works for a 60-degree v-bit carve or
# a 3 mm flat-end pocket pass.
#
# Parameters are bare top-level names so the read-only FeatureTree
# surfaces them via cad.list_operations, and the renderer can override
# them via buildParameters on cad.execute_script.

import cadquery as cq

# ── Parameters (edit these or override from the FeatureTree) ──
plate_length = 200.0   # mm -- along X
plate_width = 100.0    # mm -- along Y
plate_thickness = 6.0  # mm -- along Z, raw stock thickness
text_string = "WorkTrack3D"
text_size = 24.0       # mm -- nominal cap height
text_depth = 1.2       # mm -- cut depth into the top face
text_font = "Arial"    # any system font; falls back to default if missing
corner_fillet = 4.0    # mm -- soft sign-board corner radius

# ── Geometry ──
# Plate centered on origin so the engrave operation lands on (0, 0)
# and the operator's CAM origin lines up with stock centerline.
plate = (
    cq.Workplane("XY")
    .box(plate_length, plate_width, plate_thickness)
    .edges("|Z")
    .fillet(corner_fillet)
)

# Engrave by extruding text downward from the top face.
engraved = (
    plate.faces(">Z")
    .workplane()
    .text(
        text_string,
        text_size,
        -text_depth,
        font=text_font,
        cut=True,
    )
)

result = engraved
show_object(result)
