# SPDX-License-Identifier: MIT

import pytest
from integration.safety.gcode_guardrails import (
    check_header_invariants,
    check_end_program,
    check_safe_z_retract,
    validate_gcode,
)


GOOD_GCODE = """\
; WorkTrackCAM output
G90 G21 G17
G0 Z25.0
M3 S18000
G0 X0 Y0
G1 Z-5.0 F1000
G1 X100 F2000
G0 Z25.0
M5
M30
"""

BAD_HEADER = """\
G0 X0 Y0
G1 Z-5 F1000
"""

BAD_END = """\
G90 G21 G17
G1 X100 F2000
"""


class TestHeaderInvariants:
    def test_good_header_passes(self):
        report = check_header_invariants(GOOD_GCODE)
        assert report.passed

    def test_missing_declarations(self):
        report = check_header_invariants(BAD_HEADER)
        assert not report.passed
        assert len(report.violations) >= 1


class TestEndProgram:
    def test_good_end_passes(self):
        report = check_end_program(GOOD_GCODE, dialect="mach3")
        assert report.passed

    def test_missing_spindle_off(self):
        report = check_end_program(BAD_END)
        assert not report.passed

    def test_grbl_expects_m2(self):
        grbl_gcode = "G90 G21 G17\nG1 X10 F100\nM5\nM2\n"
        report = check_end_program(grbl_gcode, dialect="grbl")
        assert report.passed

    def test_grbl_rejects_m30(self):
        grbl_gcode = "G90 G21 G17\nG1 X10 F100\nM5\nM30\n"
        report = check_end_program(grbl_gcode, dialect="grbl")
        assert not report.passed


class TestSafeZRetract:
    def test_safe_rapids(self):
        report = check_safe_z_retract(GOOD_GCODE, safe_z_mm=25.0)
        assert report.passed

    def test_dangerous_rapid_warns(self):
        dangerous = "G0 Z2.0\nG1 X100 F1000\n"
        report = check_safe_z_retract(dangerous, safe_z_mm=25.0)
        assert len(report.violations) > 0


class TestCombinedValidation:
    def test_good_gcode_passes(self):
        report = validate_gcode(GOOD_GCODE, dialect="mach3", safe_z_mm=25.0)
        assert report.passed

    def test_empty_gcode_fails(self):
        report = validate_gcode("", dialect="mach3")
        assert not report.passed
