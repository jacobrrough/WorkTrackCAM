# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Post-processor for Makera Carvera 3-axis (Smoothieware/GRBL).
# Ported from WorkTrackCAM resources/posts/carvera_3axis.hbs
#
# Key behaviors:
# - M2 end (NOT M30 — M30 may delete file on Smoothieware SD card)
# - G4 P2 dwell after spindle start
# - ATC support: M6 T<n> + G43 H<n> for tool changes
# - G49 cancels tool length compensation at program end
# - Safe Z retract = 140 mm (machine.workAreaMm.z)
# - Spindle range: 6000-15000 RPM

SAFE_Z = 140.0

PREAMBLE = """\
; Makera Carvera — 3-Axis G-code
; ---------------------------------------------------------------------------
; Work area (mm): 360 x 240 x 140
; Spindle range: 6000-15000 RPM
; ATC: 6-slot (T1-T6), T0 = probe
; ---------------------------------------------------------------------------
G21              ; millimeters
G90              ; absolute positioning
G17              ; XY plane"""

POSTAMBLE = """\
M5               ; spindle off
G49              ; cancel tool length compensation
G0 Z140.0        ; retract Z
G0 X0 Y0         ; park X Y
M9               ; coolant/vacuum off
M2               ; program end (NOT M30)"""


try:
    from Path.Post.Processor import PostProcessor

    class MakeraCarvera(PostProcessor):
        """Makera Carvera 3-axis post-processor with ATC support."""

        def __init__(self, job, **kwargs):
            super().__init__(
                job=job,
                tooltip="Makera Carvera (3-axis)",
                tooltipargs=[""],
                units="Metric",
                **kwargs,
            )

        def init_values(self, values):
            super().init_values(values)
            values["MACHINE_NAME"] = "Makera Carvera"
            values["ENABLE_COOLANT"] = False
            values["OUTPUT_TOOL_CHANGE"] = True
            values["USE_TLO"] = True
            values["SHOW_MACHINE_UNITS"] = False
            values["OUTPUT_PATH_LABELS"] = True
            values["POSTPROCESSOR_FILE_NAME"] = __name__
            values["PARAMETER_ORDER"] = [
                "X", "Y", "Z", "I", "J", "F", "S", "T", "Q", "R", "L", "P",
            ]
            values["PREAMBLE"] = (
                "G21 G90 G17\n"
                "M6 T1\n"
                "G43 H1\n"
                "G0 Z140.0\n"
                "M3 S{spindle_speed}\n"
                "G4 P2"
            )
            values["POSTAMBLE"] = (
                "M5\n"
                "G49\n"
                "G0 Z140.0\n"
                "G0 X0 Y0\n"
                "M9\n"
                "M2"
            )

        def init_argument_defaults(self, argument_defaults):
            super().init_argument_defaults(argument_defaults)
            argument_defaults["tlo"] = True
            argument_defaults["tool_change"] = True

        @property
        def tooltip(self):
            return (
                "Post-processor for Makera Carvera desktop CNC.\n"
                "Smoothieware controller with 6-slot ATC.\n"
                "Uses M2 program end (NOT M30 — M30 deletes file on Smoothieware SD)."
            )

except ImportError:
    pass
