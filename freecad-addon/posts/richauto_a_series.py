# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Post-processor for Laguna Swift 5x10 (RichAuto A-series controller).
# Ported from WorkTrackCAM resources/posts/vcarve_mach3.hbs
#
# Key behaviors:
# - Mach3-compatible dialect (RichAuto A-series is a strict superset)
# - % tape markers on first/last lines
# - G21/G90/G17/G94 preamble
# - Spindle warm-up dwell (G4 P2.0) after M3
# - Dust collection M7/M9 (gated on flag)
# - Spindle cool-down ramp: M5 + G4 P3.0 before safe-Z retract
# - M30 program end (NOT M2)
# - Safe Z retract = machine.workAreaMm.z (203 mm)

SAFE_Z = 203.0
SPINDLE_WARMUP_S = 2.0
SPINDLE_COOLDOWN_S = 3.0

PREAMBLE = """\
%
; VCarve Pro post — Laguna Swift 5x10
; ---------------------------------------------------------------------------
; Work area (mm): 1524 x 3048 x 203
; Spindle: 6000-24000 RPM, 3 HP liquid-cooled
; ---------------------------------------------------------------------------
G21              ; millimeters
G90              ; absolute distance mode
G17              ; XY plane
G94              ; feed in units/min"""

POSTAMBLE = """\
M9               ; dust collection OFF
M5               ; spindle off
G4 P3.0          ; dwell 3s — spindle cool-down ramp
G0 Z203.0        ; safe Z retract
G0 X0 Y0         ; park at WCS origin
M30              ; program end + rewind
%"""

PREAMBLE_WITH_DUST = """\
M3 S{spindle_speed}
G4 P2.0          ; dwell 2s for spindle to reach RPM
M7               ; dust collection ON"""

PREAMBLE_WITHOUT_DUST = """\
M3 S{spindle_speed}
G4 P2.0          ; dwell 2s for spindle to reach RPM
; M7              ; dust collection OFF — set dustCollection flag to enable"""


try:
    from Path.Post.Processor import PostProcessor

    class RichAutoASeries(PostProcessor):
        """RichAuto A-series post-processor for Laguna Swift 5x10."""

        def __init__(self, job, **kwargs):
            super().__init__(
                job=job,
                tooltip="RichAuto A-series (Laguna Swift 5x10)",
                tooltipargs=[""],
                units="Metric",
                **kwargs,
            )

        def init_values(self, values):
            super().init_values(values)
            values["MACHINE_NAME"] = "Laguna Swift 5x10"
            values["ENABLE_COOLANT"] = True
            values["OUTPUT_TOOL_CHANGE"] = True
            values["USE_TLO"] = False
            values["SHOW_MACHINE_UNITS"] = True
            values["OUTPUT_PATH_LABELS"] = True
            values["POSTPROCESSOR_FILE_NAME"] = __name__
            values["PARAMETER_ORDER"] = [
                "X", "Y", "Z", "I", "J", "F", "S", "T", "Q", "R", "L", "P",
            ]
            values["PREAMBLE"] = (
                "G21 G90 G17 G94\n"
                "G0 Z203.0\n"
                "M3 S{spindle_speed}\n"
                "G4 P2.0\n"
                "M7"
            )
            values["POSTAMBLE"] = (
                "M9\n"
                "M5\n"
                "G4 P3.0\n"
                "G0 Z203.0\n"
                "G0 X0 Y0\n"
                "M30"
            )

        def init_argument_defaults(self, argument_defaults):
            super().init_argument_defaults(argument_defaults)
            argument_defaults["tlo"] = False
            argument_defaults["tool_change"] = True

        @property
        def tooltip(self):
            return (
                "Post-processor for Laguna Swift 5x10 CNC router.\n"
                "RichAuto A-series controller (Mach3-compatible dialect).\n"
                "Includes spindle warm-up/cool-down dwells and dust collection M-codes."
            )

except ImportError:
    pass
