# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Post-processor for Laguna Swift 5x10 (RichAuto A-series controller).
# Extends FreeCAD's Mach3/Mach4 post with Laguna-specific features:
# - Spindle warm-up dwell
# - Dust collection M-codes (M7 on / M9 off)
# - Safe retract sequences
# - M30 program end
#
# Phase 2 implementation — this stub shows the intended class structure.
# Full implementation requires FreeCAD's PostProcessor base class at runtime.

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
            values["POSTPROCESSOR_FILE_NAME"] = __name__
            values["PARAMETER_ORDER"] = [
                "X", "Y", "Z", "I", "J", "F", "S", "T", "Q", "R", "L", "P",
            ]
            values["PREAMBLE"] = (
                "G90 G21 G17\n"
                "(Spindle warm-up)\n"
                "M3 S{spindle_speed}\n"
                "G4 P3\n"
                "(Dust collection on)\n"
                "M7"
            )
            values["POSTAMBLE"] = (
                "M5\n"
                "G4 P2\n"
                "G0 Z25.0\n"
                "(Dust collection off)\n"
                "M9\n"
                "M30"
            )

except ImportError:
    pass
