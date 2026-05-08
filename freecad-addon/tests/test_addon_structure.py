# SPDX-License-Identifier: MIT
#
# Tests for addon structure integrity — verify all modules are importable,
# all integration packages have __init__.py, all expected files exist.

import importlib
import pathlib

import pytest

ADDON_ROOT = pathlib.Path(__file__).resolve().parent.parent


class TestPackageStructure:
    """Verify all Python packages have __init__.py."""

    EXPECTED_PACKAGES = [
        "integration",
        "integration/carvera",
        "integration/laguna",
        "integration/moonraker",
        "integration/safety",
        "integration/slicer",
        "workbench",
        "workbench/commands",
        "posts",
        "tests",
    ]

    @pytest.mark.parametrize("pkg_path", EXPECTED_PACKAGES)
    def test_init_exists(self, pkg_path):
        init_file = ADDON_ROOT / pkg_path / "__init__.py"
        assert init_file.exists(), f"Missing __init__.py in {pkg_path}"


class TestIntegrationModulesImportable:
    """Verify all integration modules can be imported."""

    MODULES = [
        "integration.carvera.atc_sequencer",
        "integration.carvera.rotary_collision",
        "integration.carvera.rotary_ops",
        "integration.carvera.wcs_probing",
        "integration.laguna.vacuum_allocator",
        "integration.laguna.vacuum_postlude",
        "integration.moonraker.client",
        "integration.moonraker.temp_validator",
        "integration.safety.gcode_guardrails",
        "integration.safety.validation_pipeline",
        "integration.slicer.cura_engine",
        "integration.slicer.k2_presets",
    ]

    @pytest.mark.parametrize("module_name", MODULES)
    def test_importable(self, module_name):
        mod = importlib.import_module(module_name)
        assert mod is not None


class TestPostProcessorModulesImportable:
    MODULES = [
        "posts.richauto_a_series",
        "posts.makera_carvera",
        "posts.makera_carvera_4axis",
        "posts.klipper_moonraker",
    ]

    @pytest.mark.parametrize("module_name", MODULES)
    def test_importable(self, module_name):
        mod = importlib.import_module(module_name)
        assert mod is not None


class TestResourceFiles:
    """Verify expected resource files exist."""

    def test_package_xml(self):
        assert (ADDON_ROOT / "package.xml").exists()

    def test_license(self):
        assert (ADDON_ROOT / "LICENSE").exists()

    def test_init_py(self):
        assert (ADDON_ROOT / "Init.py").exists()

    def test_initgui_py(self):
        assert (ADDON_ROOT / "InitGui.py").exists()

    def test_machine_profiles(self):
        machines_dir = ADDON_ROOT / "machines"
        expected = [
            "Creality_K2_Plus.fcm",
            "Laguna_Swift_5x10.fcm",
            "Makera_Carvera_3axis.fcm",
            "Makera_Carvera_4axis.fcm",
        ]
        for name in expected:
            assert (machines_dir / name).exists(), f"Missing machine: {name}"

    def test_post_processors(self):
        posts_dir = ADDON_ROOT / "posts"
        expected = [
            "richauto_a_series.py",
            "makera_carvera.py",
            "makera_carvera_4axis.py",
            "klipper_moonraker.py",
        ]
        for name in expected:
            assert (posts_dir / name).exists(), f"Missing post: {name}"

    def test_icons(self):
        icons_dir = ADDON_ROOT / "workbench" / "icons"
        expected = [
            "WorkTrackCAM.svg",
            "K2Plus.svg",
            "LagunaSwift.svg",
            "Carvera.svg",
        ]
        for name in expected:
            assert (icons_dir / name).exists(), f"Missing icon: {name}"

    def test_cura_machine_definition(self):
        assert (ADDON_ROOT / "resources" / "slicer" / "creality_k2_plus.def.json").exists()
