# SPDX-License-Identifier: MIT

import json
import pathlib
import pytest

MACHINES_DIR = pathlib.Path(__file__).resolve().parent.parent / "machines"
EXPECTED_MACHINES = [
    "Laguna_Swift_5x10",
    "Makera_Carvera_3axis",
    "Makera_Carvera_4axis",
    "Creality_K2_Plus",
]


class TestMachineProfiles:
    @pytest.fixture(params=EXPECTED_MACHINES)
    def machine_data(self, request):
        path = MACHINES_DIR / f"{request.param}.fcm"
        assert path.exists(), f"Machine profile not found: {path}"
        with open(path) as f:
            return json.load(f)

    def test_has_name(self, machine_data):
        assert "name" in machine_data
        assert len(machine_data["name"]) > 0

    def test_has_manufacturer(self, machine_data):
        assert "manufacturer" in machine_data

    def test_has_linear_axes(self, machine_data):
        axes = machine_data.get("linear_axes", {})
        assert "X" in axes
        assert "Y" in axes
        assert "Z" in axes

    def test_axis_limits_valid(self, machine_data):
        for name, axis in machine_data["linear_axes"].items():
            assert axis["max_limit"] > axis["min_limit"], f"{name} axis limits inverted"
            assert axis["max_velocity"] > 0, f"{name} axis velocity must be positive"

    def test_has_postprocessor(self, machine_data):
        assert "postprocessor_file_name" in machine_data
        assert len(machine_data["postprocessor_file_name"]) > 0

    def test_has_worktrack_extensions(self, machine_data):
        ext = machine_data.get("worktrack_extensions", {})
        assert "kind" in ext
        assert ext["kind"] in ("cnc", "fdm")

    def test_metric_units(self, machine_data):
        assert machine_data.get("configuration_units") == "metric"


class TestLagunaSpecific:
    @pytest.fixture
    def laguna(self):
        with open(MACHINES_DIR / "Laguna_Swift_5x10.fcm") as f:
            return json.load(f)

    def test_work_area_5x10(self, laguna):
        assert laguna["linear_axes"]["X"]["max_limit"] == 1524
        assert laguna["linear_axes"]["Y"]["max_limit"] == 3048

    def test_vacuum_zones(self, laguna):
        assert laguna["worktrack_extensions"]["vacuum_zone_count"] == 6

    def test_spindle_range(self, laguna):
        th = laguna["toolheads"][0]
        assert th["min_rpm"] == 6000
        assert th["max_rpm"] == 24000


class TestCarvera4AxisSpecific:
    @pytest.fixture
    def carvera4(self):
        with open(MACHINES_DIR / "Makera_Carvera_4axis.fcm") as f:
            return json.load(f)

    def test_has_a_axis(self, carvera4):
        assert "A" in carvera4.get("rotary_axes", {})

    def test_a_axis_continuous(self, carvera4):
        a = carvera4["rotary_axes"]["A"]
        assert a["max_limit"] >= 360

    def test_chuck_radius(self, carvera4):
        ext = carvera4["worktrack_extensions"]
        assert ext["rotary_chuck_outer_radius_mm"] == 46


class TestK2PlusSpecific:
    @pytest.fixture
    def k2(self):
        with open(MACHINES_DIR / "Creality_K2_Plus.fcm") as f:
            return json.load(f)

    def test_fdm_kind(self, k2):
        assert k2["worktrack_extensions"]["kind"] == "fdm"

    def test_temp_ceilings(self, k2):
        ext = k2["worktrack_extensions"]
        assert ext["max_nozzle_temp_c"] == 350
        assert ext["max_bed_temp_c"] == 120

    def test_build_volume(self, k2):
        assert k2["linear_axes"]["X"]["max_limit"] == 350
        assert k2["linear_axes"]["Y"]["max_limit"] == 350
        assert k2["linear_axes"]["Z"]["max_limit"] == 350
