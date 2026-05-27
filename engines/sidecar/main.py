"""WorkTrackCAM Python sidecar — JSON-RPC request loop.

Wire contract
=============
- One JSON object per line on stdin → one JSON object per line on stdout.
- stderr is reserved for human-readable logs (timestamps, tracebacks).
- Every request carries an ``id`` echoed in the response.
- Methods are dotted names: ``cad.<op>`` for CadQuery, ``cam.<op>`` for OCL.

Request shape::

    {"id": "<corr-id>", "method": "<name>", "params": {...}}

Success response::

    {"id": "<corr-id>", "ok": true, "result": {...}}

Error response::

    {"id": "<corr-id>", "ok": false,
     "error": {"code": "<machine-readable>", "message": "<human>",
               "detail": "<optional>"}}

Lifecycle
=========
The sidecar runs until either:
1. stdin closes (EOF) — graceful exit, code 0.
2. The ``shutdown`` method is invoked — graceful exit, code 0.
3. An uncaught exception in the dispatch loop — exit code 1 with a final
   error response on stdout when possible.

Single-instance assumption
==========================
This process is meant to be spawned per-job by the Electron main process.
It does not implement multi-client multiplexing or session isolation.
"""
from __future__ import annotations

import json
import sys
import traceback
from typing import Any, Callable

from . import __version__
from .cad_handlers import HANDLERS as CAD_HANDLERS
from .cad_handlers import _CadHandlerError
from .cam_handlers import HANDLERS as CAM_HANDLERS
from .cam_handlers import _SidecarHandlerError

# Tuple of structured-error types handled identically by the dispatch loop.
# Both expose ``code`` / ``detail`` attributes that map to the JSON-RPC
# ``error.code`` / ``error.detail`` envelope.
_STRUCTURED_ERRORS: tuple[type[Exception], ...] = (
    _SidecarHandlerError,
    _CadHandlerError,
)


HandlerFn = Callable[[dict[str, Any]], dict[str, Any]]


def _build_dispatch_table() -> dict[str, HandlerFn]:
    """Build the method dispatch table.

    Built once at startup so a typo in a handler module surfaces immediately
    rather than on first call.
    """
    table: dict[str, HandlerFn] = {
        "ping": _ping,
    }
    for name, fn in CAD_HANDLERS.items():
        table[f"cad.{name}"] = fn
    for name, fn in CAM_HANDLERS.items():
        table[f"cam.{name}"] = fn
    return table


def _ping(_params: dict[str, Any]) -> dict[str, Any]:
    return {"pong": True, "version": __version__}


def _ok(req_id: str, result: dict[str, Any]) -> str:
    return json.dumps({"id": req_id, "ok": True, "result": result}, separators=(",", ":"))


def _err(req_id: str, code: str, message: str, detail: str | None = None) -> str:
    payload: dict[str, Any] = {
        "id": req_id,
        "ok": False,
        "error": {"code": code, "message": message},
    }
    if detail is not None:
        payload["error"]["detail"] = detail
    return json.dumps(payload, separators=(",", ":"))


def _log(msg: str) -> None:
    """Human-readable diagnostic to stderr. Never blocks stdout framing."""
    print(f"[sidecar] {msg}", file=sys.stderr, flush=True)


def _dispatch(table: dict[str, HandlerFn], line: str) -> str | None:
    """Parse one input line, dispatch, return the response line.

    Returns None for the special ``shutdown`` method (caller exits the loop).
    """
    try:
        req = json.loads(line)
    except json.JSONDecodeError as exc:
        return _err("", "bad_json", "Request line is not valid JSON", str(exc))

    if not isinstance(req, dict):
        return _err("", "bad_envelope", "Request must be a JSON object")

    req_id = req.get("id")
    if not isinstance(req_id, str) or not req_id:
        return _err("", "bad_envelope", "Request 'id' must be a non-empty string")

    method = req.get("method")
    if not isinstance(method, str) or not method:
        return _err(req_id, "bad_envelope", "Request 'method' must be a non-empty string")

    params = req.get("params", {})
    if not isinstance(params, dict):
        return _err(req_id, "bad_envelope", "Request 'params' must be an object")

    if method == "shutdown":
        return None

    handler = table.get(method)
    if handler is None:
        return _err(req_id, "unknown_method", f"Unknown method: {method}")

    try:
        result = handler(params)
    except _STRUCTURED_ERRORS as exc:
        # Structured CAM / CAD error — preserve the machine-readable code so
        # the TS bridge can map to operator-facing fallback hints.
        _log(f"handler {method} returned structured error: {exc.code} {exc}")
        return _err(req_id, exc.code, str(exc), exc.detail)
    except Exception as exc:  # noqa: BLE001 - we want to surface ALL handler failures
        _log(f"handler {method} raised: {exc!r}")
        _log(traceback.format_exc())
        return _err(req_id, "handler_error", f"{method} failed: {exc}", traceback.format_exc())

    if not isinstance(result, dict):
        return _err(req_id, "bad_result", f"{method} returned a non-dict result")

    return _ok(req_id, result)


def main() -> int:
    table = _build_dispatch_table()
    _log(f"sidecar v{__version__} ready ({len(table)} methods)")
    for raw in sys.stdin:
        line = raw.rstrip("\r\n")
        if not line:
            continue
        out = _dispatch(table, line)
        if out is None:
            _log("shutdown requested")
            return 0
        print(out, flush=True)
    _log("stdin EOF, exiting")
    return 0


if __name__ == "__main__":
    sys.exit(main())
