# SPDX-License-Identifier: MIT

import pytest
from integration.moonraker.temp_validator import (
    TempCeilings,
    validate_gcode_temps,
)


class TestTempValidator:
    def test_safe_temps_pass(self):
        gcode = "M104 S210\nM140 S60\nG28\n"
        violations = validate_gcode_temps(gcode)
        assert len(violations) == 0

    def test_nozzle_over_ceiling(self):
        gcode = "M109 S400\n"
        violations = validate_gcode_temps(gcode)
        assert len(violations) == 1
        assert violations[0].component == "nozzle"
        assert violations[0].requested_temp == 400
        assert violations[0].ceiling == 350

    def test_bed_over_ceiling(self):
        gcode = "M190 S150\n"
        violations = validate_gcode_temps(gcode)
        assert len(violations) == 1
        assert violations[0].component == "bed"

    def test_chamber_over_ceiling(self):
        gcode = "M141 S80\n"
        violations = validate_gcode_temps(gcode)
        assert len(violations) == 1
        assert violations[0].component == "chamber"

    def test_custom_ceilings(self):
        gcode = "M104 S250\n"
        ceilings = TempCeilings(max_nozzle_c=200)
        violations = validate_gcode_temps(gcode, ceilings)
        assert len(violations) == 1

    def test_comments_ignored(self):
        gcode = "; M104 S999\n"
        violations = validate_gcode_temps(gcode)
        assert len(violations) == 0
