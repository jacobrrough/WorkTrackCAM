# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Post-processor for Makera Carvera 3-axis (Smoothieware/GRBL).
# - M2 end (not M30)
# - G4 P2 dwell before program end
# - ATC M6/G43 sequences when enabled
#
# Phase 2 implementation stub.

try:
    from Path.Post.Processor import PostProcessor

    class MakeraCarvera(PostProcessor):
        """Makera Carvera 3-axis post-processor."""

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
            values["POSTPROCESSOR_FILE_NAME"] = __name__
            values["PARAMETER_ORDER"] = [
                "X", "Y", "Z", "I", "J", "F", "S", "T", "Q", "R", "L", "P",
            ]
            values["PREAMBLE"] = "G90 G21 G17"
            values["POSTAMBLE"] = "M5\nG4 P2\nG0 Z50\nM2"

except ImportError:
    pass
