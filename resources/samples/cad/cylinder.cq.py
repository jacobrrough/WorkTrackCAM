# WorkTrack3D CadQuery starter: rotary cylinder + helical groove
#
# A 30 mm OD x 80 mm cylindrical blank with a shallow helical groove cut
# into its outer surface. Geared at the Makera Carvera + 4th-axis HD
# rotary module: axis along +X (rotary headstock at X=0), Y=0, Z up.
# Mounts as a 4-axis indexed or simultaneous starter.
#
# Parameters are bare top-level names so the read-only FeatureTree
# surfaces them via cad.list_operations, and the renderer can override
# them via buildParameters on cad.execute_script.

import cadquery as cq
import math

# ── Parameters (edit these or override from the FeatureTree) ──
diameter = 30.0       # mm -- cylinder OD (max ~92 mm on the Carvera HD)
length = 80.0         # mm -- cylinder length along the rotary axis (+X)
groove_depth = 1.5    # mm -- radial depth of the helical groove
groove_width = 2.0    # mm -- helical groove width (along the axis)
helix_pitch = 20.0    # mm -- distance between consecutive turns along +X
helix_start = 5.0     # mm -- axial offset of the groove start from X=0
helix_end = 75.0      # mm -- axial offset of the groove end

# ── Cylinder blank ──
# Build the cylinder so its axis is +X. CadQuery's default cylinder
# axis is +Z, so we work on a YZ plane then orient by construction:
# create the cylinder with axis along +Z, then rotate -90 about Y so
# the axis aligns with +X. The rotated body's headstock end sits at
# X=0, free end at X=length -- matches the Carvera rotary fixture.
blank = (
    cq.Workplane("XY")
    .circle(diameter / 2.0)
    .extrude(length)
    .rotate((0, 0, 0), (0, 1, 0), -90)
    .translate((length, 0, 0))
)

# ── Helical groove polyline ──
# Approximate the helix as a polyline. CadQuery's makeHelix could
# produce a true spline but a sampled polyline keeps the starter
# script self-contained and easy to read.
turns = max(1, int((helix_end - helix_start) / helix_pitch))
samples_per_turn = 36
points = []
total_samples = turns * samples_per_turn + 1
for i in range(total_samples):
    t = i / samples_per_turn  # turn count, 0..turns
    x = helix_start + t * helix_pitch
    if x > helix_end:
        x = helix_end
    angle = 2.0 * math.pi * t
    y = (diameter / 2.0) * math.cos(angle)
    z = (diameter / 2.0) * math.sin(angle)
    points.append((x, y, z))
    if x >= helix_end:
        break

# Sweep a small square cross-section along the helix, then subtract.
# We approximate the sweep by drilling a row of overlapping radial
# pockets at each polyline sample -- avoids needing cq.makeHelix in
# the starter while still producing a recognizably helical groove.
result = blank
for x, y, z in points:
    # Skip degenerate / out-of-range pockets so the boolean stays clean.
    if x < 0 or x > length:
        continue
    # Direction from cylinder axis (y=0, z=0) outward through (y, z).
    radius = math.hypot(y, z)
    if radius < 1e-6:
        continue
    pocket = (
        cq.Workplane("YZ")
        .workplane(offset=x)
        .center(y * (1.0 - groove_depth / radius), z * (1.0 - groove_depth / radius))
        .rect(groove_width, groove_width)
        .extrude(groove_depth, both=True)
    )
    result = result.cut(pocket)

show_object(result)
