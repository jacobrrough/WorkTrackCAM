# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Post-processor for Makera Carvera 4th Axis (GRBL with A-axis).
# - Y0 centering (rotary center)
# - A-axis parameter output
# - Rotary origin offset (X to headstock)
# - M2 end, G4 P2 dwell
#
# Phase 2 implementation stub.

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
            values["POSTPROCESSOR_FILE_NAME"] = __name__
            values["PARAMETER_ORDER"] = [
                "X", "Y", "Z", "A", "I", "J", "F", "S", "T", "Q", "R", "L", "P",
            ]
            values["PREAMBLE"] = "G90 G21 G17\nG0 Y0"
            values["POSTAMBLE"] = "M5\nA0\nG4 P2\nG0 Z46\nM2"

except ImportError:
    pass
