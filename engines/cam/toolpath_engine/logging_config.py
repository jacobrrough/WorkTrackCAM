"""
Centralized logging configuration for the toolpath engine.

Uses structlog when available for structured JSON logging,
falls back to stdlib logging with consistent formatting.

Log levels:
- DEBUG: Detailed algorithm internals (BVH construction, heightfield fill)
- INFO: Strategy selection, phase transitions, timing summaries
- WARNING: Clamped parameters, degraded fallbacks, near-limit conditions
- ERROR: Unrecoverable failures, safety violations
"""
from __future__ import annotations

import logging
import os
import sys

try:
    import structlog
    HAS_STRUCTLOG = True
except ImportError:
    HAS_STRUCTLOG = False


def get_logger(name: str = "toolpath_engine"):
    """
    Get a configured logger instance.

    Uses structlog for structured JSON output when available.
    Falls back to stdlib logging with a consistent format.
    """
    if HAS_STRUCTLOG:
        return structlog.get_logger(name)

    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stderr)
        level_str = os.environ.get("TOOLPATH_LOG_LEVEL", "WARNING").upper()
        level = getattr(logging, level_str, logging.WARNING)
        handler.setLevel(level)
        logger.setLevel(level)
        fmt = logging.Formatter(
            "[%(levelname)s] %(name)s: %(message)s"
        )
        handler.setFormatter(fmt)
        logger.addHandler(handler)
    return logger


def configure_structlog(verbose: bool = False) -> None:
    """Configure structlog with appropriate processors."""
    if not HAS_STRUCTLOG:
        return

    level = logging.DEBUG if verbose else logging.WARNING

    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.StackInfoRenderer(),
            structlog.dev.set_exc_info,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(level),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
        cache_logger_on_first_use=True,
    )
