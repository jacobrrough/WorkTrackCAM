# SPDX-License-Identifier: MIT
#
# Tests for the Moonraker client module.
# These test the client construction and URL building without requiring
# a live printer connection.

import pytest
from integration.moonraker.client import MoonrakerClient, MoonrakerConfig


class TestMoonrakerConfig:
    def test_default_url(self):
        config = MoonrakerConfig()
        assert config.base_url == "http://192.168.1.100:7125"

    def test_custom_url(self):
        config = MoonrakerConfig(base_url="http://10.0.0.5:7125")
        assert config.base_url == "http://10.0.0.5:7125"

    def test_default_timeouts(self):
        config = MoonrakerConfig()
        assert config.connect_timeout_s == 5.0
        assert config.upload_timeout_s == 60.0


class TestMoonrakerClientURLs:
    def test_url_building(self):
        client = MoonrakerClient(MoonrakerConfig(base_url="http://printer:7125"))
        assert client._url("/server/info") == "http://printer:7125/server/info"

    def test_url_strips_trailing_slash(self):
        client = MoonrakerClient(MoonrakerConfig(base_url="http://printer:7125/"))
        assert client._url("/server/info") == "http://printer:7125/server/info"

    def test_upload_endpoint(self):
        client = MoonrakerClient(MoonrakerConfig(base_url="http://192.168.1.100:7125"))
        assert client._url("/server/files/upload") == "http://192.168.1.100:7125/server/files/upload"

    def test_print_start_endpoint(self):
        client = MoonrakerClient(MoonrakerConfig(base_url="http://192.168.1.100:7125"))
        assert client._url("/printer/print/start") == "http://192.168.1.100:7125/printer/print/start"

    def test_status_endpoint(self):
        client = MoonrakerClient(MoonrakerConfig(base_url="http://192.168.1.100:7125"))
        url = client._url("/printer/objects/query")
        assert url == "http://192.168.1.100:7125/printer/objects/query"


class TestMoonrakerClientConstruction:
    def test_default_config(self):
        client = MoonrakerClient()
        assert client.config.base_url == "http://192.168.1.100:7125"

    def test_custom_config(self):
        config = MoonrakerConfig(
            base_url="http://k2.local:7125",
            connect_timeout_s=10.0,
            upload_timeout_s=120.0,
        )
        client = MoonrakerClient(config)
        assert client.config.base_url == "http://k2.local:7125"
        assert client.config.connect_timeout_s == 10.0
        assert client.config.upload_timeout_s == 120.0
