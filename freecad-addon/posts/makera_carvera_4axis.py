# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Post-processor for Makera Carvera 4th Axis (GRBL with A-axis).
# Ported from WorkTrackCAM resources/posts/carvera_4axis.hbs
#
# Key behaviors:
# - Y0 centering (rotary axis center — Y MUST be 0 for 4-axis)
# - A-axis parameter output (XYZA in parameter order)
# - No ATC (rotary attachment occupies ATC bay — manual tool change only)
# - G93 inverse-time feed mode when simultaneous 4-axis is enabled
# - M2 end (NOT M30)
# - G4 P2 dwell after spindle start
# - Safe Z retract = 46 mm (machine.workAreaMm.z for rotary config)
# - A0 return before parking

SAFE_Z = 46.0

PREAMBLE = """\
; Makera Carvera — 4-Axis Rotary G-code
; ---------------------------------------------------------------------------
; Work area (mm): 240 x 92 x 46 (rotary config)
; A-axis: continuous, harmonic-drive rotary module
; Spindle range: 6000-15000 RPM
; ---------------------------------------------------------------------------
; SAFETY: Z=0 is at stock CENTER (rotation axis), NOT surface
; SAFETY: Y must be 0 (centered on rotation axis)
; ---------------------------------------------------------------------------
G21              ; millimeters
G90              ; absolute positioning
G17              ; XY plane"""

POSTAMBLE = """\
M5               ; spindle off
G0 Z46.0         ; retract Z
G0 A0            ; return A to zero
G0 X0 Y0         ; park X, re-center Y on rotation axis
M9               ; coolant/vacuum off
M2               ; program end (NOT M30)"""


try:
    from Path.Post.Processor import PostProcessor

    class MakeraCarvera4Axis(PostProcessor):
        """Makera Carvera 4-axis post-processor with rotary A-axis support."""

        def __init__(self, job, **kwargs):
            super().__init__(
                job=job,
                tooltip="Makera Carvera (4-axis rotary)",
                tooltipargs=[""],
                units="Metric",
                **kwargs,
            )

        def init_values(self, values):
            super().init_values(values)
            values["MACHINE_NAME"] = "Makera Carvera 4-Axis"
            values["ENABLE_COOLANT"] = False
            values["OUTPUT_TOOL_CHANGE"] = False
            values["USE_TLO"] = False
            values["SHOW_MACHINE_UNITS"] = False
            values["OUTPUT_PATH_LABELS"] = True
            values["POSTPROCESSOR_FILE_NAME"] = __name__
            values["PARAMETER_ORDER"] = [
                "X", "Y", "Z", "A", "I", "J", "F", "S", "T", "Q", "R", "L", "P",
            ]
            values["PREAMBLE"] = (
                "G21 G90 G17\n"
                "G0 Z46.0\n"
                "G0 Y0\n"
                "M3 S{spindle_speed}\n"
                "G4 P2"
            )
            values["POSTAMBLE"] = (
                "M5\n"
                "G0 Z46.0\n"
                "G0 A0\n"
                "G0 X0 Y0\n"
                "M9\n"
                "M2"
            )

        def init_argument_defaults(self, argument_defaults):
            super().init_argument_defaults(argument_defaults)
            argument_defaults["tlo"] = False
            argument_defaults["tool_change"] = False

        @property
        def tooltip(self):
            return (
                "Post-processor for Makera Carvera 4th Axis HD rotary.\n"
                "Y=0 centering, A-axis output, no ATC (rotary occupies bay).\n"
                "Uses M2 program end (NOT M30)."
            )

except ImportError:
    pass
