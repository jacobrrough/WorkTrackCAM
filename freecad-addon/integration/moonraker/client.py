# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Jacob Rrough
#
# Moonraker REST API client for Creality K2 Plus.
# Ported from WorkTrackCAM src/main/moonraker-push.ts

import json
import urllib.request
import urllib.error
import urllib.parse
from dataclasses import dataclass
from typing import Optional


@dataclass
class MoonrakerConfig:
    base_url: str = "http://192.168.1.100:7125"
    connect_timeout_s: float = 5.0
    upload_timeout_s: float = 60.0


class MoonrakerClient:
    """HTTP client for the Moonraker API (Klipper print management)."""

    def __init__(self, config: Optional[MoonrakerConfig] = None):
        self.config = config or MoonrakerConfig()

    def _url(self, path: str) -> str:
        return f"{self.config.base_url.rstrip('/')}{path}"

    def server_info(self) -> dict:
        """GET /server/info — check connectivity and server state."""
        req = urllib.request.Request(self._url("/server/info"))
        with urllib.request.urlopen(req, timeout=self.config.connect_timeout_s) as resp:
            return json.loads(resp.read())

    def upload_gcode(self, filepath: str, filename: str) -> dict:
        """POST /server/files/upload — upload a G-code file for printing."""
        boundary = "----WorkTrackCAMBoundary"
        with open(filepath, "rb") as f:
            file_data = f.read()

        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(
            self._url("/server/files/upload"),
            data=body,
            method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        with urllib.request.urlopen(req, timeout=self.config.upload_timeout_s) as resp:
            return json.loads(resp.read())

    def start_print(self, filename: str) -> dict:
        """POST /printer/print/start — begin printing a previously uploaded file."""
        data = json.dumps({"filename": filename}).encode()
        req = urllib.request.Request(
            self._url("/printer/print/start"),
            data=data,
            method="POST",
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=self.config.connect_timeout_s) as resp:
            return json.loads(resp.read())

    def printer_status(self) -> dict:
        """GET /printer/objects/query — poll printer state."""
        params = urllib.parse.urlencode({
            "heater_bed": "",
            "extruder": "",
            "print_stats": "",
        })
        req = urllib.request.Request(self._url(f"/printer/objects/query?{params}"))
        with urllib.request.urlopen(req, timeout=self.config.connect_timeout_s) as resp:
            return json.loads(resp.read())
